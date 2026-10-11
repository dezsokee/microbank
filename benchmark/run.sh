#!/usr/bin/env bash
# Resource benchmark orchestrator: baseline / istio / linkerd on the same minikube node.
#
# Usage:  benchmark/run.sh <stack>...       stack = istio | baseline | linkerd | restore-istio
# Env:    OUT_DIR    results directory (default: benchmark/results/<timestamp>)
#         BASE_URL   ingress address reachable from the minikube docker network (default: http://$(minikube ip))
#
# For every stack: reconfigure the mesh, restart all pods (postgres first → empty DB),
# 1 min warm-up (not reported), 2 min idle, then k6 normal → peak → burst with 1 min
# cool-downs. sampler.py runs alongside and tags each sample with the current phase.
set -uo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: don't rewrite /api/... or /scripts paths

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
# kubectl/helm/docker on Windows need C:/... paths; elsewhere this is a no-op.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
PYTHON=${PYTHON:-$(command -v python3 || command -v python)}

OUT="${OUT_DIR:-$HERE/results/$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"
NS=student-research
BASE_URL=${BASE_URL:-http://$(minikube ip 2>/dev/null)}
R=$(native "$REPO")
# Same for every stack: chart values as installed, plus raised CPU limits for the two
# bottleneck services (at 500m the transaction-service readiness probe times out under
# peak/burst and the pod drops out of the endpoints → 503s).
HELM_COMMON=(--set global.otel.enabled=true
             --set account-service.resources.limits.cpu=1500m
             --set transaction-service.resources.limits.cpu=1500m)
# api-gateway + transaction-service images with client_request_duration_seconds, built
# inside minikube's docker daemon (see README). Skipped if they are not present.
INSTRUMENTED=("api-gateway:microbank-api-gateway:test-instrumented"
              "transaction-service:microbank-transaction-service:test-instrumented")

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }
phase() { echo "$1" > "$OUT/phase.txt"; log "PHASE $1"; }

wait_ns_ready() {
  local ns=$1
  for _ in $(seq 1 90); do
    local notready
    notready=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | awk '$3!="Completed"{split($2,a,"/"); if (a[1]!=a[2] || $3!="Running") print $1}' | wc -l)
    [ "$notready" = "0" ] && return 0
    sleep 10
  done
  log "WARN: pods in $ns not all ready after 15m"; kubectl get pods -n "$ns" | tee -a "$OUT/run.log"
  return 1
}

patch_images() {
  local available
  available=$(minikube image ls 2>/dev/null)
  for pair in "${INSTRUMENTED[@]}"; do
    local svc=${pair%%:*} img=${pair#*:}
    if ! grep -q "$img" <<<"$available"; then
      log "instrumented image $img not in minikube — keeping chart image for $svc"; continue
    fi
    kubectl patch deploy "microbank-$svc" -n $NS --type=json -p "[
      {\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"$img\"},
      {\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/imagePullPolicy\",\"value\":\"Never\"}]" >/dev/null
  done
}

# Fresh pods everywhere: postgres first (emptyDir → DB reset + reseed), then the rest.
restart_all() {
  kubectl rollout restart deploy/microbank-postgres -n $NS >/dev/null
  kubectl rollout status deploy/microbank-postgres -n $NS --timeout=300s >/dev/null
  kubectl get deploy -n $NS -o name | grep -v postgres | xargs kubectl rollout restart -n $NS >/dev/null
  sleep 15
  wait_ns_ready $NS
}

helm_upgrade() {
  helm upgrade microbank "$R/helm/microbank" -n $NS --set global.serviceMesh.provider="$1" "${HELM_COMMON[@]}" >/dev/null
  helm upgrade monitoring "$R/helm/monitoring" -n $NS --set serviceMesh.provider="$1" --set kyverno.enabled=false >/dev/null
}

ns_clear_mesh() {
  kubectl label ns $NS istio-injection- >/dev/null 2>&1
  kubectl annotate ns $NS linkerd.io/inject- config.linkerd.io/default-inbound-policy- config.linkerd.io/skip-outbound-ports- >/dev/null 2>&1
  kubectl delete server --all -n $NS --ignore-not-found >/dev/null 2>&1
}

istio_policies() { kubectl "$1" -f "$R/k8s/istio/peer-authentication-strict.yaml" -f "$R/k8s/istio/destination-rules.yaml" ${2:-} >/dev/null; }

configure() {
  local stack=$1
  log "configuring $stack"
  case $stack in
    istio|restore-istio)
      kubectl scale deploy istiod -n istio-system --replicas=1 >/dev/null
      kubectl rollout status deploy/istiod -n istio-system --timeout=300s >/dev/null
      ns_clear_mesh
      kubectl label ns $NS istio-injection=enabled --overwrite >/dev/null
      istio_policies apply
      helm_upgrade istio ;;
    baseline)
      ns_clear_mesh
      istio_policies delete --ignore-not-found
      helm_upgrade none
      kubectl scale deploy istiod -n istio-system --replicas=0 >/dev/null ;;
    linkerd)
      if ! kubectl get deploy linkerd-proxy-injector -n linkerd >/dev/null 2>&1; then
        log "installing linkerd control plane"
        "$PYTHON" "$(native "$HERE/prepare_linkerd.py")" | tee -a "$OUT/run.log"
        kubectl apply -f "$(native "$HERE/.build/linkerd/linkerd-crds.yaml")" >/dev/null
        kubectl apply -f "$(native "$HERE/.build/linkerd/linkerd-control-plane.yaml")" >/dev/null
      fi
      wait_ns_ready linkerd
      ns_clear_mesh
      istio_policies delete --ignore-not-found
      kubectl apply -f "$R/k8s/linkerd/linkerd-ns.yaml" -f "$R/k8s/linkerd/authorization-policies-strict.yaml" >/dev/null
      helm_upgrade linkerd
      kubectl scale deploy istiod -n istio-system --replicas=0 >/dev/null ;;
    *) log "unknown stack $stack"; return 1 ;;
  esac
  patch_images
  restart_all
  kubectl get pods -n $NS -o custom-columns=POD:.metadata.name,CONTAINERS:.spec.containers[*].name --no-headers \
    | sed 's/^/    /' | tee -a "$OUT/run.log"
}

k6_run() {
  local stack=$1 scenario=$2; shift 2
  docker run --rm --network minikube \
    -v "$R/k6:/scripts" -v "$(native "$OUT"):/out" -w /scripts grafana/k6 run --quiet \
    -e BASE_URL="$BASE_URL" --summary-trend-stats "avg,min,med,max,p(90),p(95),p(99)" \
    --summary-export "/out/k6-$stack-$scenario.json" "$@" > "$OUT/k6-$stack-$scenario.log" 2>&1
  log "k6 $scenario exit=$? $(grep -E 'http_req_failed\.\.|http_reqs\.\.' "$OUT/k6-$stack-$scenario.log" | tr -s ' ' | tr '\n' ' ')"
}

measure() {
  local stack=$1
  phase "$stack/warmup"
  k6_run "$stack" warmup --stage 15s:10 --stage 45s:10 --stage 5s:0 normal-traffic.js
  phase "$stack/idle";   sleep 120
  phase "$stack/normal"; k6_run "$stack" normal normal-traffic.js
  phase "$stack/cool1";  sleep 60
  phase "$stack/peak";   k6_run "$stack" peak peak-traffic.js
  phase "$stack/cool2";  sleep 60
  phase "$stack/burst";  k6_run "$stack" burst burst-traffic.js
  phase "$stack/cool3";  sleep 60
}

[ $# -gt 0 ] || { echo "usage: $0 <istio|baseline|linkerd|restore-istio>..."; exit 1; }

# Refuse to run twice into the same results dir: two orchestrators share the k6-vu-*
# users, invalidate each other's tokens and both rewrite phase.txt.
LOCK="$OUT/run.lock"
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "another run.sh (pid $(cat "$LOCK")) is writing to $OUT — aborting"; exit 1
fi
echo $$ > "$LOCK"
rm -f "$OUT/stop"
"$PYTHON" "$(native "$HERE/sampler.py")" "$(native "$OUT")" 2>> "$OUT/sampler.err" &
SAMPLER=$!
trap 'touch "$OUT/stop"; wait $SAMPLER 2>/dev/null; rm -f "$LOCK"' EXIT

log "results → $OUT (BASE_URL=$BASE_URL)"
for stack in "$@"; do
  phase "$stack/configure"
  configure "$stack" || log "WARN: configure $stack reported problems, measuring anyway"
  [ "$stack" = "restore-istio" ] || measure "$stack"
  log "DONE $stack"
done
phase "finished"
log "ALL DONE — report: $PYTHON benchmark/build_xlsx.py $OUT <file>.xlsx"
