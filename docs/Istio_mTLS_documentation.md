# Istio mTLS, SPIFFE & PKI
## Comprehensive Technical Documentation
*Service-to-Service Security in Kubernetes with Istio Service Mesh*

---

## 1. Overview

This document provides a comprehensive explanation of how service-to-service communication security works within an Istio service mesh. It focuses on three interconnected pillars:

- **mTLS (mutual TLS)** — encrypted and mutually authenticated communication between services
- **PKI (Public Key Infrastructure)** — the trust framework underpinning certificate-based identity
- **Envoy Proxy configuration** — the data-plane component that enforces security policies

Together, these components implement a Zero Trust networking model in Kubernetes, ensuring every connection is authenticated and encrypted regardless of network location.

---

## 2. Core Concepts

### 2.1 PKI — Public Key Infrastructure

PKI is the system that enables mutual authentication and trust establishment between services using certificates. It is the foundation upon which Istio's security model is built.

**Key components:**
- **Key pair** — each workload generates a public/private key pair
- **X.509 certificate** — binds a public key to an identity
- **Certificate Authority (CA)** — the trusted entity that signs certificates
- **Trust chain** — Root CA → Intermediate CA → Workload certificate

> **Note:** PKI provides identity and trust. It does not directly perform data encryption — that is the role of TLS.

---

### 2.2 SPIFFE — Secure Production Identity Framework For Everyone

SPIFFE is an open standard that defines a workload identity format using URIs. In Istio, every workload receives a SPIFFE identity that is embedded in the certificate's Subject Alternative Name (SAN) field.

**SPIFFE ID format:**
```
spiffe://cluster.local/ns/{namespace}/sa/{serviceaccount}
```

This identity uniquely represents a workload by its Kubernetes namespace and service account, enabling cryptographically verifiable service-level authorization.

---

### 2.3 mTLS — Mutual TLS

Standard TLS only authenticates the server to the client. mTLS extends this by requiring both parties to present and validate certificates, establishing bidirectional trust.

**In an mTLS handshake:**
- Both the client and server present an X.509 certificate
- Both parties validate the peer's certificate against a trusted CA
- A shared symmetric encryption key is negotiated
- All subsequent communication is encrypted over the established channel

---

## 3. Istio CA Infrastructure

Istio uses a layered certificate hierarchy to balance security, operational flexibility, and blast-radius minimization:

```
Root CA                 (validity: ~10 years)
  └─ Intermediate CA    (validity: ~1 year)
       └─ Workload Cert (validity: ~24 hours)
```

**Why this hierarchy matters:**
- The Root CA private key is kept offline and protected — it is never directly exposed to the network
- The Intermediate CA handles day-to-day signing, limiting the impact of a compromise
- Short-lived workload certificates (24h) drastically reduce the risk from key exposure — even if a certificate leaks, it expires quickly
- Automatic rotation ensures continuity without manual intervention

---

## 4. Certificate Lifecycle

### 4.1 Certificate Issuance on Pod Startup

When a Pod starts, the following sequence occurs automatically:

| Step | Actor | Action |
|------|-------|--------|
| 1 | Kubernetes | Schedules Pod; Envoy sidecar injected by Istio mutating webhook |
| 2 | Envoy Sidecar | Generates a private key locally inside the Pod |
| 3 | Envoy Sidecar | Creates a Certificate Signing Request (CSR) with the SPIFFE ID |
| 4 | istiod (Citadel) | Validates the CSR and signs it using the Intermediate CA |
| 5 | Envoy Sidecar | Receives the signed certificate; begins accepting/initiating mTLS connections |

> **Note:** The private key is generated inside the Pod and never transmitted over the network. istiod only receives the CSR, not the private key.

### 4.2 Certificate Rotation

- Workload certificates are valid for approximately 24 hours
- Envoy proactively renews certificates before expiry — no service restart is required
- Rotation is fully automatic and transparent to the application

---

## 5. mTLS Handshake Process

### 5.1 When Does It Occur?

The TLS handshake happens once per TCP connection, not per HTTP request. Istio's Envoy proxies maintain connection pools, so a single handshake can cover many subsequent requests on that connection.

### 5.2 Handshake Step-by-Step

| Step | Direction | Description |
|------|-----------|-------------|
| 1 | — | TCP connection established between client Envoy and server Envoy |
| 2 | Client → Server | ClientHello: proposes TLS version and cipher suites |
| 3 | Server → Client | ServerHello + server certificate (containing SPIFFE ID) |
| 4 | Client | Validates server certificate against trusted CA bundle |
| 5 | Client → Server | Client certificate (containing client's SPIFFE ID) |
| 6 | Server | Validates client certificate against trusted CA bundle |
| 7 | Both | ECDHE key exchange to derive shared symmetric session key |
| 8 | Both | Encrypted communication begins |

### 5.3 Cryptographic Primitives

| Primitive | Role | Example Algorithm |
|-----------|------|-------------------|
| PKI / X.509 | Identity verification | RSA-2048 / ECDSA P-256 |
| Key Exchange | Session key negotiation | ECDHE (Diffie-Hellman) |
| Symmetric Encryption | Data confidentiality | AES-128-GCM / AES-256-GCM |
| MAC / Integrity | Data authenticity | SHA-256 / SHA-384 |

---

## 6. Connection Reuse & Performance

A common concern with mTLS is performance overhead from repeated handshakes. Istio addresses this efficiently:

- The TLS handshake occurs only once per TCP connection — not per HTTP request
- Envoy maintains a connection pool for each upstream cluster, reusing established TLS sessions
- HTTP/2 multiplexing allows many concurrent requests to share a single connection, further amortizing handshake cost
- The operational overhead of mTLS in Istio is minimal for most workloads

---

## 7. Istio Control Plane — istiod

istiod is the single control-plane binary that consolidates three previously separate Istio components: Pilot, Citadel, and Galley.

**Responsibilities:**
- Watches Kubernetes API for Services, Endpoints, and configuration objects
- Acts as the Certificate Authority (CA) — issues and renews workload certificates via the SDS (Secret Discovery Service) API
- Generates Envoy configurations (listeners, routes, clusters) for every sidecar
- Pushes configuration to Envoy proxies via the xDS protocol

---

## 8. Envoy Proxy — Data Plane

### 8.1 Core Abstractions

| Concept | Description |
|---------|-------------|
| Listener | Network endpoint that accepts incoming connections (IP:port) |
| Filter Chain | Ordered set of filters applied to traffic on a listener |
| Cluster | Group of upstream endpoints (a logical backend service) |
| Endpoint | A specific host:port within a cluster |
| Route | Rules that map requests to clusters based on headers, path, etc. |

### 8.2 xDS Discovery APIs

istiod uses the xDS protocol family to dynamically push configuration to Envoy without restart:

| API | Full Name | Manages |
|-----|-----------|---------|
| LDS | Listener Discovery Service | Listeners and filter chains |
| CDS | Cluster Discovery Service | Upstream clusters |
| EDS | Endpoint Discovery Service | Cluster member endpoints |
| RDS | Route Discovery Service | HTTP routing rules |
| SDS | Secret Discovery Service | TLS certificates and keys |

---

## 9. Inbound vs. Outbound Listeners

### 9.1 Outbound Listener

Handles traffic leaving the application container toward other services.

- Intercepts all outgoing TCP connections from the application
- Applies routing rules (DestinationRule, VirtualService)
- Initiates mTLS if the target service has a valid certificate
- Adds telemetry (metrics, traces, access logs)

### 9.2 Inbound Listener

Handles traffic arriving at the application container from other services.

- Intercepts all incoming connections before the application receives them
- Validates the client's mTLS certificate
- Enforces PeerAuthentication and AuthorizationPolicy rules
- Forwards validated traffic to the local application port

---

## 10. PeerAuthentication

PeerAuthentication is an Istio CRD that controls the mTLS policy for inbound traffic to a workload or namespace.

| Mode | Behavior | Use Case |
|------|----------|----------|
| `PERMISSIVE` | Accepts both mTLS and plain-text traffic | Migration phase; onboarding legacy services |
| `STRICT` | Accepts only mTLS traffic; rejects plain-text | Production Zero Trust enforcement |
| `DISABLE` | Disables mTLS entirely; accepts only plain-text | Debugging; external load balancer integration |

> **Note:** PeerAuthentication does not create new Envoy listeners. It modifies the filter chain configuration of the existing inbound listener.

**Example — namespace-wide STRICT mode:**
```yaml
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT
```

---

## 11. DestinationRule

DestinationRule configures the outbound TLS behavior when a service calls another service. It is the client-side counterpart to PeerAuthentication.

| TLS Mode | Description |
|----------|-------------|
| `ISTIO_MUTUAL` | Istio automatically provides certificates; full mTLS (most common) |
| `MUTUAL` | User-supplied client certificates for mTLS (BYO-cert scenarios) |
| `SIMPLE` | One-way TLS; server authenticates only |
| `DISABLE` | Plain-text; no TLS |

**Example — ISTIO_MUTUAL for a service:**
```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: payment-service
spec:
  host: payment-service.production.svc.cluster.local
  trafficPolicy:
    tls:
      mode: ISTIO_MUTUAL
```

---

## 12. Full Request Flow

The following illustrates a complete service-to-service request in an Istio mesh with STRICT mTLS:

```
┌──────────────────────────────────────────────────────────┐
│  Service A Pod                    Service B Pod           │
│                                                           │
│  [App A]                              [App B]             │
│     │ HTTP (localhost)                    ▲               │
│     ▼                                    │ HTTP           │
│  [Envoy A]  ──── mTLS (TCP) ────>  [Envoy B]            │
│  Outbound Listener                Inbound Listener        │
│  - Route lookup                   - Cert validation       │
│  - TLS handshake                  - Policy enforcement    │
│  - Encrypt traffic                - Decrypt traffic       │
└──────────────────────────────────────────────────────────┘
```

**Step-by-step:**
1. App A sends an HTTP request to localhost (Envoy intercepts via iptables)
2. Envoy A's outbound listener matches the destination and applies routing rules
3. Envoy A performs a TLS handshake with Envoy B, presenting its SPIFFE certificate
4. Envoy B validates Envoy A's certificate, then presents its own certificate
5. Envoy A validates Envoy B's certificate — mutual authentication complete
6. The request is sent encrypted over the established mTLS connection
7. Envoy B decrypts the request, enforces inbound policies, and forwards to App B

---

## 13. Security Benefits

| Property | How Istio Achieves It |
|----------|-----------------------|
| Zero Trust Networking | Every connection requires mutual certificate authentication; no implicit trust based on IP |
| Automatic Identity Management | Certificates issued and rotated automatically via istiod — no manual PKI ops |
| Short-Lived Credentials | 24-hour workload certificates limit exposure window from key compromise |
| Encryption in Transit | All mesh traffic encrypted by default with AES-GCM |
| Workload Isolation | SPIFFE IDs enable fine-grained AuthorizationPolicy per service account |
| Audit & Observability | mTLS identity available in access logs, metrics, and distributed traces |

---

## 14. Common Pitfalls & Troubleshooting

| Issue | Cause | Resolution |
|-------|-------|------------|
| Connection refused with STRICT mode | PeerAuthentication set to STRICT but calling service has no sidecar or DestinationRule missing | Ensure all callers have Envoy injected; add DestinationRule with ISTIO_MUTUAL |
| Certificate mismatch | Clock skew between nodes causes certificate validity window mismatch | Synchronize NTP across all cluster nodes |
| 503 upstream connect error | Sidecar not injected on target Pod; plain-text hits STRICT listener | Check injection label on namespace/pod; verify istio-proxy container is present |
| Handshake timeout | Network policy blocking Envoy-to-Envoy port (15006/15001) | Allow Envoy traffic ports in NetworkPolicy rules |
| SAN mismatch | DestinationRule host does not match the certificate's SPIFFE SAN | Use the full Kubernetes DNS name as the DestinationRule host |

---

## 15. Mental Model

```
┌─────────────────────────────────────────┐
│            istiod (Control Plane)        │
│  • Kubernetes state watcher              │
│  • Certificate Authority (CA)            │
│  • xDS config generator & pusher         │
└───────────────┬─────────────────────────┘
                │  certificates + xDS config
                ▼
┌─────────────────────────────────────────┐
│         Envoy Sidecar (Data Plane)       │
│  • Listener/Cluster/Route enforcement    │
│  • mTLS handshake & policy check         │
│  • Telemetry collection                  │
└───────────────┬─────────────────────────┘
                │  encrypted mTLS traffic
                ▼
┌─────────────────────────────────────────┐
│           Network (Data Path)            │
│  • TLS 1.3 encrypted TCP streams         │
│  • SPIFFE identity in every connection   │
└─────────────────────────────────────────┘
```

---

## 16. Summary

Istio's security architecture is built on the composition of four complementary systems:

| System | Role |
|--------|------|
| PKI | Provides identity and trust — *who are you?* |
| SPIFFE / X.509 | Encodes workload identity into verifiable certificates |
| TLS / mTLS | Provides encryption and mutual authentication — *prove it* |
| Envoy Proxy | Enforces policies transparently — without changing application code |
| istiod | Orchestrates the entire system — configuration, certificates, and observability |

Together, they implement a production-grade Zero Trust security posture for microservices on Kubernetes — where every connection is authenticated, every byte is encrypted, and access is controlled at the workload identity level.
