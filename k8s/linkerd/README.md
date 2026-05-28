# Linkerd Service Mesh for MicroBank

This directory holds the Linkerd equivalents of the manifests in
`k8s/istio/`. The Helm chart toggle is `global.serviceMesh.provider` —
set it to `linkerd` (or `istio`, or `none`).

The five files here mirror the Istio layout one-for-one:

| Istio file                          | Linkerd file                              | Purpose |
|-------------------------------------|-------------------------------------------|---------|
| `isto-ns.yaml`                      | `linkerd-ns.yaml`                         | Namespace + inject annotation |
| `peer-authentication-strict.yaml`   | `authorization-policies-strict.yaml`      | Deny non-mTLS, with ingress carve-outs |
| `peer-authentication-disable.yaml`  | `authorization-policies-disable.yaml`     | Allow non-mTLS too (for dev/debug) |
| `destination-rules.yaml`            | *(none)*                                  | Linkerd does mTLS automatically; no rule needed |
| `telemetry-otel.yaml`               | `telemetry-otel.yaml` (comment-only)      | Proxy tracing is configured at install time, not via CRD |

## Install Linkerd

```sh
# 1. Install Linkerd control plane (cluster-scoped — CRDs + linkerd namespace).
linkerd install --crds | kubectl apply -f -
linkerd install | kubectl apply -f -
linkerd check

# 2. Apply MicroBank's Linkerd config + STRICT mTLS policies.
kubectl apply -f k8s/linkerd/linkerd-ns.yaml
kubectl apply -f k8s/linkerd/authorization-policies-strict.yaml
kubectl apply -f k8s/linkerd/telemetry-otel.yaml   # comment-only, no-op

# 3. Deploy MicroBank with Linkerd as the provider.
helm upgrade --install microbank ./helm/microbank \
  --set global.serviceMesh.provider=linkerd

# Also update the OTel and monitoring sub-charts so their opt-out annotations
# emit the linkerd variant:
helm upgrade --install otel ./helm/otel \
  --set serviceMesh.provider=linkerd
helm upgrade --install monitoring ./helm/monitoring \
  --set serviceMesh.provider=linkerd

# 4. Restart pods so the linkerd-proxy webhook injects sidecars.
kubectl rollout restart deployment -n student-research

# 5. Verify.
linkerd -n student-research check --proxy
kubectl get pods -n student-research
# expect every microbank-* pod 2/2 ready (app + linkerd-proxy)
# expect postgres, otel, prometheus, grafana to remain 1/1 (not injected)
```

## Switching from Istio → Linkerd

Run BOTH meshes' webhooks at once is technically possible but pollutes the
latency benchmark — uninstall Istio first.

```sh
# 1. Tear down Istio policies + control plane.
kubectl delete -f k8s/istio/
istioctl uninstall --purge -y
kubectl delete namespace istio-system

# 2. Drop the Istio namespace label — Linkerd uses an annotation instead.
kubectl label namespace student-research istio-injection-

# 3. Proceed with the Linkerd install above.
```

## Switching back to Istio

```sh
# 1. Tear down Linkerd policies + control plane.
kubectl delete -f k8s/linkerd/
linkerd uninstall | kubectl delete -f -

# 2. Apply Istio control plane + manifests.
istioctl install -y
kubectl apply -f k8s/istio/

# 3. Redeploy MicroBank with the istio provider.
helm upgrade microbank ./helm/microbank --set global.serviceMesh.provider=istio
helm upgrade otel ./helm/otel --set serviceMesh.provider=istio
helm upgrade monitoring ./helm/monitoring --set serviceMesh.provider=istio
kubectl rollout restart deployment -n student-research
```

## Cluster-impact note (for the dissertation)

Linkerd's install footprint is **cluster-scoped** — it adds CRDs
(`Server`, `AuthorizationPolicy`, `MeshTLSAuthentication`,
`NetworkAuthentication`, `HTTPRoute`, `ServiceProfile`), a
`MutatingWebhookConfiguration`, ClusterRoles, and its own `linkerd`
namespace. Same model as Istio.

The runtime impact is **namespace-scoped**: the inject webhook only
mutates pods that carry `linkerd.io/inject: enabled` (or live in a
namespace with that annotation). Workloads in `kube-system`, `default`,
or any other unannotated namespace are unaffected. The webhook's
`failurePolicy` is `Ignore`, so a Linkerd outage cannot block pod
creation elsewhere in the cluster.
