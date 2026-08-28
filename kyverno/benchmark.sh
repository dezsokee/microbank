#!/usr/bin/env bash
# ==============================================================================
# Kyverno admission-latency benchmark a MICROBANK futo podjain.
#
# Mit csinal: minden iteracioban ujrainditja a microbank deploymenteket
# (rollout restart -> uj podok -> friss Pod-admission, amit a Kyverno kiertekel),
# majd a Prometheusbol delta-modszerrel (sum/count kulonbseg a burst elott/utan)
# kiolvassa az admission-latency-t. Feltetelenkent CSV sort ir.
#
# Harom feltetel:
#   A = nincs policy          (baseline; a Kyverno webhook nem hivodik a podokra)
#   B = validate-policy.yaml  (tiszta policy-motor koltseg, halozat nelkul)
#   C = cosign-policy.yaml    (verifyImages: alairas-ellenorzes, halozattal)
#
# A mereshez a Kyvernot NEM allitjuk le; a feltételeket a policy-k
# fel-/letelepitese valtja. Igy az admission-metrikak vegig elerhetok.
#
# ELOFELTETELEK:
#   - kubectl a klaszterre konfiguralva
#   - Prometheus elerheto (pl. kulon terminalban):
#       kubectl -n student-research port-forward svc/<release>-monitoring-prometheus 9090:9090
#   - python (JSON parse-hoz) a PATH-on
#
# HASZNALAT:
#   PROM_URL=http://localhost:9090 ./kyverno/benchmark.sh
#   CONDITIONS="B C" REPEATS=5 ./kyverno/benchmark.sh
# ==============================================================================
set -euo pipefail

# ---- Konfiguracio (kornyezeti valtozoval felulirhato) ------------------------
NS="${NS:-student-research}"                       # microbank namespace
PROM_URL="${PROM_URL:-http://localhost:9090}"      # port-forwardolt Prometheus
CONDITIONS="${CONDITIONS:-A B C}"                  # mely feltetelek, sorrendben
REPEATS="${REPEATS:-5}"                            # iteracio / feltetel
SETTLE="${SETTLE:-25}"                             # var(mp) restart utan; > prom scrape_interval (15s)!
WEBHOOK_SETTLE="${WEBHOOK_SETTLE:-10}"             # var(mp) policy-valtas utan (Kyverno webhook reconcile)
DEPLOY_REGEX="${DEPLOY_REGEX:-microbank-}"         # mely deploymentek (a monitoringot kihagyjuk)
DEPLOY_EXCLUDE="${DEPLOY_EXCLUDE:-monitoring|prometheus|grafana}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATE_POLICY="${VALIDATE_POLICY:-$SCRIPT_DIR/validate-policy.yaml}"
COSIGN_POLICY="${COSIGN_POLICY:-$SCRIPT_DIR/cosign-policy.yaml}"
OUT="${OUT:-$SCRIPT_DIR/benchmark-results.csv}"

# A feltetelekhez tartozo policy-nev (a policy_execution_duration szureshez).
policy_name_for() {
  case "$1" in
    B) echo "validate-microbank-standards" ;;
    C) echo "verify-microbank-images" ;;
    *) echo "" ;;
  esac
}

# ---- Prometheus instant-query -> skalar ertek --------------------------------
promq() {
  local q="$1"
  curl -sf --get "$PROM_URL/api/v1/query" --data-urlencode "query=$q" \
    | python -c "import sys,json; d=json.load(sys.stdin); r=d['data']['result']; print(r[0]['value'][1] if r else 'nan')"
}

# Ket float osztasa ezredmasodpercben, nan-vedelemmel (delta_sum/delta_count*1000).
avg_ms() {
  awk -v s="$1" -v c="$2" 'BEGIN{
    if (s=="nan"||c=="nan"||c+0<=0){print "nan"} else {printf "%.3f", (s/c)*1000}
  }'
}
delta() { # a - b, nan-vedelemmel
  awk -v a="$1" -v b="$2" 'BEGIN{ if(a=="nan"||b=="nan"){print "nan"} else {printf "%.6f", a-b} }'
}

# ---- Egy pillanatkep a kumulativ szamlalokrol --------------------------------
# Kimenet: "ar_sum ar_cnt pe_sum pe_cnt aw_sum aw_cnt"
capture() {
  local pol="$1"
  local ar_sum ar_cnt pe_sum pe_cnt aw_sum aw_cnt
  # Megj.: a kyverno_admission_review_* metrikanak NINCS namespace label-je,
  # csak resource_kind. A restart-burst amugy is a mi Pod-jainkat dominalja.
  ar_sum=$(promq "sum(kyverno_admission_review_duration_seconds_sum{resource_kind=\"Pod\"})")
  ar_cnt=$(promq "sum(kyverno_admission_review_duration_seconds_count{resource_kind=\"Pod\"})")
  if [[ -n "$pol" ]]; then
    pe_sum=$(promq "sum(kyverno_policy_execution_duration_seconds_sum{policy_name=\"$pol\"})")
    pe_cnt=$(promq "sum(kyverno_policy_execution_duration_seconds_count{policy_name=\"$pol\"})")
  else
    pe_sum="nan"; pe_cnt="nan"
  fi
  aw_sum=$(promq "sum(apiserver_admission_webhook_admission_duration_seconds_sum{name=~\".*kyverno.*\"})")
  aw_cnt=$(promq "sum(apiserver_admission_webhook_admission_duration_seconds_count{name=~\".*kyverno.*\"})")
  echo "$ar_sum $ar_cnt $pe_sum $pe_cnt $aw_sum $aw_cnt"
}

# ---- A feltetelhez tartozo policy-allapot beallitasa -------------------------
apply_condition() {
  local cond="$1"
  case "$cond" in
    A) kubectl delete -f "$VALIDATE_POLICY" --ignore-not-found >/dev/null 2>&1 || true
       kubectl delete -f "$COSIGN_POLICY"   --ignore-not-found >/dev/null 2>&1 || true ;;
    B) kubectl apply  -f "$VALIDATE_POLICY" >/dev/null
       kubectl delete -f "$COSIGN_POLICY"   --ignore-not-found >/dev/null 2>&1 || true ;;
    C) kubectl apply  -f "$COSIGN_POLICY"   >/dev/null
       kubectl delete -f "$VALIDATE_POLICY" --ignore-not-found >/dev/null 2>&1 || true ;;
    *) echo "Ismeretlen feltetel: $cond" >&2; exit 1 ;;
  esac
  # A Kyverno a policy-valtas utan ujragyartja a webhook-configot -> varunk.
  sleep "$WEBHOOK_SETTLE"
}

# ---- A microbank deploymentek ujrainditasa -----------------------------------
restart_workload() {
  local deploys
  deploys=$(kubectl get deploy -n "$NS" -o name \
            | grep -E "$DEPLOY_REGEX" | grep -vE "$DEPLOY_EXCLUDE" || true)
  if [[ -z "$deploys" ]]; then
    echo "Nincs illeszkedo deployment ($DEPLOY_REGEX) a(z) $NS namespace-ben." >&2
    exit 1
  fi
  echo "$deploys" | xargs -r kubectl rollout restart -n "$NS" >/dev/null
}

# ---- Fociklus ----------------------------------------------------------------
echo "condition,iteration,timestamp,pods_admitted,admission_review_avg_ms,policy_exec_avg_ms,apiserver_webhook_avg_ms" > "$OUT"
echo ">> Eredmeny: $OUT"
echo ">> Prometheus: $PROM_URL | namespace: $NS | ismetles/feltetel: $REPEATS"

for cond in $CONDITIONS; do
  pol="$(policy_name_for "$cond")"
  echo ""
  echo "=== Feltetel $cond ${pol:+(policy: $pol)} ==="
  apply_condition "$cond"

  for i in $(seq 1 "$REPEATS"); do
    read -r b_arS b_arC b_peS b_peC b_awS b_awC <<< "$(capture "$pol")"
    restart_workload
    sleep "$SETTLE"
    read -r a_arS a_arC a_peS a_peC a_awS a_awC <<< "$(capture "$pol")"

    d_arC=$(delta "$a_arC" "$b_arC")
    ar_ms=$(avg_ms "$(delta "$a_arS" "$b_arS")" "$d_arC")
    pe_ms=$(avg_ms "$(delta "$a_peS" "$b_peS")" "$(delta "$a_peC" "$b_peC")")
    aw_ms=$(avg_ms "$(delta "$a_awS" "$b_awS")" "$(delta "$a_awC" "$b_awC")")
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    echo "$cond,$i,$ts,$d_arC,$ar_ms,$pe_ms,$aw_ms" | tee -a "$OUT"
    if [[ "$cond" == "C" && "$i" == "1" ]]; then
      echo "   (C/1 = cache-MISS: elso alairas-ellenorzes; a tobbi iteracio cache-HIT)"
    fi
  done
done

echo ""
echo ">> Kesz. CSV: $OUT"
