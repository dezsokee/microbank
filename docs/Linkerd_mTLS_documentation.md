# Linkerd mTLS, Workload Identity & Authorization
## Comprehensive Technical Documentation
*Service-to-Service Security in Kubernetes with Linkerd Service Mesh*

---

## 1. Overview

This document mirrors `Istio_mTLS_documentation.md` and explains how
service-to-service communication security works under Linkerd. The two meshes
solve the same problem (Zero Trust east-west traffic) but with very different
engineering trade-offs. The three pillars are still:

- **mTLS (mutual TLS)** — encrypted and mutually authenticated communication
- **PKI (Public Key Infrastructure)** — the trust framework for identity
- **linkerd-proxy** — the data-plane component that enforces policy

Where Istio uses a general-purpose Envoy sidecar (~50 MB RAM, written in C++),
Linkerd uses a purpose-built **micro-proxy** written in Rust (~10 MB RAM) that
implements only HTTP/1, HTTP/2, gRPC, and opaque TCP. The smaller surface area
is why Linkerd is consistently the lower-latency option in published benchmarks
— and is the basis for the comparison this dissertation measures.

---

## 2. Core Concepts

### 2.1 PKI in Linkerd

Linkerd's trust model is a layered CA hierarchy similar to Istio's:

```
Trust Anchor (Root CA)   (validity: ~1 year, operator-managed)
  └─ Issuer CA           (validity: ~1 year, rotated automatically)
       └─ Workload Cert  (validity: 24 hours, rotated by the proxy)
```

The Trust Anchor lives on disk (typically `linkerd-trust-anchor` secret) and
is the only cluster-wide trust root. The Issuer CA is held in the
`linkerd-identity` control-plane component and signs short-lived workload
certificates on demand.

### 2.2 Workload Identity

Linkerd identifies workloads by their Kubernetes **ServiceAccount** plus
**namespace**, expressed as a DNS-style identity string:

```
{serviceaccount}.{namespace}.serviceaccount.identity.linkerd.cluster.local
```

This is functionally equivalent to Istio's SPIFFE ID — same building blocks
(ServiceAccount + namespace), different encoding. Linkerd does not use the
SPIFFE URI scheme but embeds the identity in the certificate's Subject
Alternative Name (SAN), just like Istio does.

### 2.3 mTLS

Identical to the definition in the Istio doc — both parties present X.509
certificates, both validate, both negotiate a session key. The wire format is
standard TLS 1.3. The only difference is **which control-plane component
issues the cert** and **which proxy terminates the connection**.

---

## 3. Linkerd CA Infrastructure

| Component | Lifetime | Role |
|---|---|---|
| Trust Anchor | ~1 year (recommended) | Root of trust, signs the Issuer CA. Lives only in the `linkerd-identity-trust-roots` ConfigMap and on operator workstations. |
| Issuer CA | ~1 year | Signs workload certs. Held by the `linkerd-identity` Deployment. Auto-rotated if cert-manager integration is enabled. |
| Workload Cert | 24 hours | Issued to each meshed pod. Rotated by the proxy itself before expiry. |

> **Note:** Unlike Istio, where istiod is a single binary handling discovery,
> config, **and** CA duties, Linkerd splits these across separate
> control-plane deployments: `linkerd-destination` (discovery + policy),
> `linkerd-identity` (CA), and `linkerd-proxy-injector` (webhook). This
> separation is a deliberate operational-safety choice — a CA compromise
> doesn't take down service discovery.

---

## 4. Certificate Lifecycle

### 4.1 Certificate Issuance on Pod Startup

| Step | Actor | Action |
|---|---|---|
| 1 | Kubernetes | Schedules Pod; `linkerd-proxy-injector` webhook injects the proxy + init container |
| 2 | linkerd-init | Configures iptables to redirect inbound/outbound traffic to the proxy |
| 3 | linkerd-proxy | Generates an Ed25519 private key locally inside the Pod |
| 4 | linkerd-proxy | Builds a CSR carrying the workload identity, signs it with the Pod's ServiceAccount JWT |
| 5 | linkerd-identity | Validates the JWT against the Kubernetes API, then signs the CSR with the Issuer CA |
| 6 | linkerd-proxy | Receives the signed certificate; begins accepting/initiating mTLS connections |

> **Note:** Like Istio, the workload private key never leaves the Pod.
> The novelty in Linkerd's flow is using the **Kubernetes ServiceAccount
> JWT** as proof-of-identity to the CA — meaning Linkerd's identity
> assertion is rooted in the same trust the kubelet uses.

### 4.2 Certificate Rotation

- Workload certificates valid for 24 hours.
- linkerd-proxy proactively renews ~10 minutes before expiry.
- Rotation is transparent — no connection drops, no application restart.
- Connections survive rotation: the new cert takes effect on the next
  handshake; in-flight connections keep using their negotiated session key.

---

## 5. mTLS Handshake Process

### 5.1 When Does It Occur?

Once per TCP connection. linkerd-proxy maintains long-lived HTTP/2
connections to upstream peers, so a single handshake amortizes across
thousands of requests — the same pattern as Envoy.

### 5.2 Handshake Step-by-Step

Identical to Istio's handshake (steps 1–8 in the Istio doc) — both meshes
speak standard TLS 1.3. The only Linkerd-specific bit is the certificate
SAN: it contains the `…serviceaccount.identity.linkerd.cluster.local`
identity instead of a `spiffe://` URI.

### 5.3 Cryptographic Primitives

| Primitive | Linkerd Choice | Istio Equivalent |
|---|---|---|
| Workload key type | **Ed25519** (default) | RSA-2048 / ECDSA P-256 |
| Key Exchange | ECDHE (X25519) | ECDHE |
| Symmetric Encryption | **AES-128-GCM** (TLS 1.3 default) | AES-128/256-GCM |
| MAC / Integrity | AEAD (built into GCM) | AEAD |

Ed25519 keys + X25519 key exchange are notably faster to generate and verify
than RSA — one of several reasons Linkerd's handshakes are cheaper than
Istio's default RSA pipeline. Istio can be configured to use ECDSA, but
defaults are what's compared in the benchmark.

---

## 6. Connection Reuse & Performance

- TLS handshake amortized over many requests via HTTP/2 multiplexing,
  identical to Envoy.
- linkerd-proxy is **Rust + Tokio**, async I/O, single-process per pod.
  Memory: ~10 MB resident vs ~50 MB for envoy.
- No Lua filters, no WASM, no general-purpose extensibility — Linkerd's
  proxy intentionally does **only** the things it has to do.
- This is the central performance hypothesis the benchmark tests: the same
  workload, same mTLS guarantee, but lower p99 latency and lower CPU/RSS
  per meshed pod under Linkerd.

---

## 7. Linkerd Control Plane

Unlike Istio's monolithic `istiod`, Linkerd's control plane is split into
single-purpose Deployments running in the `linkerd` namespace:

| Component | Role |
|---|---|
| `linkerd-destination` | Watches Kubernetes for Endpoints, EndpointSlices, ServiceProfiles, and policy CRDs. Serves discovery + policy data to proxies over a gRPC API. |
| `linkerd-identity` | The Certificate Authority. Validates ServiceAccount tokens via TokenReview, signs CSRs with the Issuer CA. |
| `linkerd-proxy-injector` | MutatingWebhook that adds the `linkerd-proxy` and `linkerd-init` containers to annotated pods. |
| `linkerd-policy-controller` | Reconciles policy CRDs (Server, AuthorizationPolicy) into the destination service's policy view. |

The control plane talks to proxies via a custom **gRPC API**, not the xDS
protocol family. This is a deliberate divergence from the Envoy/Istio
ecosystem — Linkerd's proxy was designed for Linkerd specifically.

---

## 8. linkerd-proxy — Data Plane

### 8.1 What It Does (and Doesn't)

| Capability | Supported? |
|---|---|
| HTTP/1.1, HTTP/2, gRPC | Yes |
| Opaque TCP forwarding | Yes |
| mTLS (origination + termination) | Yes |
| Retries, timeouts, circuit breaking | Yes (per-route, via ServiceProfile / HTTPRoute) |
| Traffic splitting (canary) | Yes (via HTTPRoute) |
| Arbitrary WASM / Lua filters | **No** |
| L4 raw socket access | **No** |
| TCP-only protocols requiring inspection (MySQL, etc.) | Tunneled as opaque TCP, no L7 features |

The "things it doesn't do" list is **the point**. Istio's Envoy is a
Swiss-army-knife proxy that powers many other products (AWS App Mesh,
Gloo, Consul Connect). Linkerd's proxy is purpose-built — every feature
removed reduces attack surface and latency.

### 8.2 Proxy Configuration API

| Linkerd API | Istio xDS Equivalent |
|---|---|
| `destination.linkerd.io/Get` (gRPC) | EDS + CDS |
| Policy gRPC service | RDS + LDS |
| Identity gRPC service | SDS |

There is no Listener/Cluster/Route abstraction exposed to operators —
proxy config is generated implicitly from the Linkerd policy CRDs +
Kubernetes objects.

---

## 9. Inbound vs. Outbound Behavior

### 9.1 Outbound (proxy is initiating connections)

- iptables redirects all outbound TCP to the proxy.
- The proxy queries `linkerd-destination` for the target host.
- If the destination is a meshed pod (has a known identity), the proxy
  initiates mTLS automatically — no DestinationRule equivalent needed.
- If the destination is NOT meshed (e.g. Postgres, external service),
  the proxy passes plain TCP through. `skip-outbound-ports` annotations
  can bypass the proxy entirely for known plain-TCP destinations like
  databases — which is what `k8s/linkerd/linkerd-ns.yaml` does for port 5432.

### 9.2 Inbound (proxy is receiving connections)

- iptables redirects all inbound to the proxy.
- The proxy validates the client's mTLS certificate against the trust
  anchor.
- Authorization decisions follow the policy hierarchy:
  1. If a `Server` resource matches this pod + port, its `accessPolicy`
     and any matching `AuthorizationPolicy` apply.
  2. Otherwise, the namespace's `config.linkerd.io/default-inbound-policy`
     annotation applies.
  3. Otherwise, the cluster-wide default (set at `linkerd install` time)
     applies.
- Validated traffic is forwarded to the local application port.

---

## 10. Authorization — Linkerd's Policy CRDs

This section is the Linkerd analogue of the Istio doc's
PeerAuthentication / DestinationRule sections.

### 10.1 The Four Policy CRDs

| CRD | Role |
|---|---|
| `Server` | Identifies a pod-selector + port. Says "this port is policy-managed". |
| `AuthorizationPolicy` | Binds a Server (or HTTPRoute) to one or more authentications. |
| `MeshTLSAuthentication` | "Anyone presenting one of these identities" (= any meshed pod, or specific SAs). |
| `NetworkAuthentication` | "Anyone from one of these CIDRs" (= the ingress controller, the cluster nodes, anywhere). |

### 10.2 Default Policy Modes

Set via namespace annotation `config.linkerd.io/default-inbound-policy`:

| Mode | Behavior | Istio Equivalent |
|---|---|---|
| `all-unauthenticated` | Accept any traffic (mTLS still happens automatically between meshed pods, just not enforced). | `PeerAuthentication PERMISSIVE` |
| `all-authenticated` | Reject anything without a valid mTLS identity. | `PeerAuthentication STRICT` |
| `cluster-authenticated` | Like `all-authenticated`, but also accept unauthenticated callers from inside the cluster pod network. | (no exact Istio equivalent) |
| `cluster-unauthenticated` | Reject only callers from outside the cluster. | (no exact Istio equivalent) |
| `deny` | Reject all inbound. | (would require AuthorizationPolicy `action: DENY` globally) |

> **Important:** Linkerd's mTLS encryption is **always on** between meshed
> pods, regardless of which mode is set. The mode controls *authorization*
> (whether non-mTLS callers are rejected), not encryption.

### 10.3 Example — namespace-wide STRICT

`k8s/linkerd/authorization-policies-strict.yaml` sets:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: student-research
  annotations:
    config.linkerd.io/default-inbound-policy: all-authenticated
```

…and adds a per-port carve-out for ingress entry points:

```yaml
apiVersion: policy.linkerd.io/v1beta3
kind: Server
metadata:
  name: api-gateway-ingress
  namespace: student-research
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: api-gateway
  port: 8080
  proxyProtocol: HTTP/1
  accessPolicy: all-unauthenticated
```

The `accessPolicy: all-unauthenticated` on the Server overrides the
namespace default — equivalent to Istio's `portLevelMtls: PERMISSIVE`.

### 10.4 No DestinationRule Equivalent

Linkerd does not need a client-side TLS-mode configuration. The proxy
inspects the destination, sees whether it's meshed (i.e. has a discoverable
identity), and initiates mTLS automatically. This is one less CRD to
maintain compared to Istio.

---

## 11. Full Request Flow

```
┌──────────────────────────────────────────────────────────┐
│  Service A Pod                    Service B Pod           │
│                                                           │
│  [App A]                              [App B]             │
│     │ HTTP (localhost)                    ▲               │
│     ▼                                    │ HTTP           │
│  [linkerd-proxy A] ── mTLS (TCP) ── [linkerd-proxy B]    │
│  Outbound iptables                Inbound iptables        │
│  - Destination lookup             - Cert validation       │
│  - TLS handshake                  - Policy check          │
│  - Encrypt traffic                - Decrypt traffic       │
└──────────────────────────────────────────────────────────┘
```

Step-by-step is identical to the Istio flow with one substitution:
"Envoy" → "linkerd-proxy", "istiod" → "linkerd-identity +
linkerd-destination". Same wire protocol, same security guarantee,
different implementation.

---

## 12. Security Benefits

Same matrix as the Istio doc — Linkerd achieves all five Zero Trust
properties:

| Property | How Linkerd Achieves It |
|---|---|
| Zero Trust Networking | Every connection requires mutual certificate authentication; no implicit trust based on IP. |
| Automatic Identity Management | Certificates issued and rotated automatically via linkerd-identity — no manual PKI ops. |
| Short-Lived Credentials | 24-hour workload certificates limit exposure window from key compromise. |
| Encryption in Transit | All meshed traffic encrypted automatically with TLS 1.3 (AES-128-GCM). |
| Workload Isolation | ServiceAccount-based identity enables fine-grained AuthorizationPolicy. |

---

## 13. Common Pitfalls & Troubleshooting

| Issue | Cause | Resolution |
|---|---|---|
| App pod stays `1/1 Ready` instead of `2/2` after install | Pod has no `linkerd.io/inject: enabled` annotation (namespace or pod) | Check namespace annotation; `kubectl rollout restart deployment` after applying `linkerd-ns.yaml` |
| Connections refused with default-inbound-policy `all-authenticated` | Caller is not meshed (e.g. NGINX ingress controller) | Add `Server` + `accessPolicy: all-unauthenticated` for the ingress port |
| Postgres connections fail under Linkerd | Proxy intercepting port 5432 but Postgres expects raw TCP | Set `config.linkerd.io/skip-outbound-ports: "5432"` on the namespace (already done in `linkerd-ns.yaml`) |
| OTel collector traffic blocked | Collector is meshed but receives plain-text from unmeshed sources | Either inject the collector (and accept its traffic via AuthorizationPolicy) or opt-out of injection (current setup) |
| `linkerd check --proxy` reports "could not establish profile" | Pod has the proxy but `linkerd-destination` cannot reach it (RBAC / network policy) | Check ClusterRole bindings, NetworkPolicy in the namespace |
| Certs expire / "no trust anchor" | Trust Anchor mismatch — e.g. `linkerd install` was run twice with different secrets | Reinstall the control plane reusing the original trust anchor secret |

---

## 14. Mental Model

```
┌─────────────────────────────────────────┐
│       Linkerd Control Plane              │
│  • linkerd-destination (discovery)       │
│  • linkerd-identity (CA, mTLS certs)     │
│  • linkerd-proxy-injector (webhook)      │
│  • linkerd-policy-controller (policy)    │
└───────────────┬─────────────────────────┘
                │  certs + policy (gRPC)
                ▼
┌─────────────────────────────────────────┐
│       linkerd-proxy (Data Plane)         │
│  • Rust micro-proxy (~10MB)              │
│  • Automatic mTLS                        │
│  • Server / AuthorizationPolicy gates    │
│  • Per-route retries, timeouts           │
└───────────────┬─────────────────────────┘
                │  encrypted mTLS traffic
                ▼
┌─────────────────────────────────────────┐
│        Network (Data Path)               │
│  • TLS 1.3 (X25519 + AES-128-GCM)        │
│  • Workload identity in every cert SAN   │
└─────────────────────────────────────────┘
```

---

## 15. Why Linkerd vs Istio (for this dissertation)

| Dimension | Istio | Linkerd |
|---|---|---|
| Data-plane proxy | Envoy (C++, ~50 MB RSS) | linkerd-proxy (Rust, ~10 MB RSS) |
| Control-plane shape | Monolithic `istiod` | Several single-purpose deployments |
| Wire protocol to proxy | xDS (Envoy-compat) | Custom gRPC |
| Workload identity scheme | SPIFFE URI | Kubernetes-style DNS |
| Cert key type (default) | RSA-2048 | Ed25519 |
| mTLS posture | Configurable per port (PeerAuthentication) | Always-on for meshed pods; authorization separate |
| Feature surface | Very large (egress, WASM filters, multicluster, virtual services, gateways, …) | Small and opinionated |
| Expected latency overhead | Higher | Lower |

The hypothesis under test is that the smaller feature surface and Rust
implementation give Linkerd a measurable advantage on **p99 latency**,
**RSS per pod**, and **CPU per request**, while delivering the same
Zero-Trust mTLS security guarantee. The k6 traffic profiles in `k6/`
exercise the same money-transfer flow against both meshes and against
a no-mesh baseline.

---

## 16. Summary

Linkerd's security architecture is built on the same four pillars as
Istio's, with different implementation choices that prioritize
operational simplicity and proxy efficiency over feature breadth:

| System | Role | Implementation |
|---|---|---|
| PKI | Identity & trust — *who are you?* | Trust Anchor → Issuer CA → 24h workload certs |
| Workload Identity | Encodes identity into verifiable certs | `{sa}.{ns}.serviceaccount.identity.linkerd.cluster.local` SAN |
| TLS / mTLS | Encryption + mutual authentication — *prove it* | TLS 1.3, Ed25519 keys, automatic for all meshed pods |
| linkerd-proxy | Enforces policy transparently | Rust micro-proxy, gRPC config from control plane |
| Linkerd Control Plane | Orchestrates the system | Split into destination / identity / injector / policy |

Together, they deliver the same production-grade Zero Trust posture as
Istio — every connection authenticated, every byte encrypted — with
substantially less per-pod overhead.
