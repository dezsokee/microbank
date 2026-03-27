# MicroBank

A microservice-based fintech mock application simulating a simplified banking system. Built as the test workload for a master's dissertation researching **Software Supply Chain Security** and **Zero Trust (mTLS) architecture** in Kubernetes environments.

**Current scope:** Local development and testing with Docker Compose.
**Future scope:** Kubernetes deployment with service mesh (Istio/Linkerd/Cilium), SPIFFE/SPIRE workload identity, Sigstore image signing, and Prometheus/Grafana monitoring.

---

## Architecture

```
                        ┌──────────────┐
                        │    React     │
                        │   Frontend   │
                        │  (Nginx:80)  │
                        └──────┬───────┘
                               │
                               ▼
                        ┌──────────────┐
                        │  API Gateway │
                        │   (Go:8080)  │
                        └──────┬───────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
         ┌────────────┐ ┌───────────┐ ┌─────────────┐
         │Auth Service│ │  Account  │ │ Transaction │
         │ (Go:8081)  │ │  Service  │ │   Service   │
         └────────────┘ │(Kotlin:   │ │(Kotlin:     │
                        │ 8082)     │ │ 8083)       │
                        └───────────┘ └──────┬──────┘
                               ▲             │
                               │    ┌────────┼────────┬──────────┐
                               │    │        │        │          │
                               │    ▼        ▼        ▼          ▼
                               │ ┌──────┐┌────────┐┌──────┐┌─────────┐
                               └─┤Fraud ││Exchange││Notif.││Audit Log│
                                 │(Go:  ││(Python:││(Py:  ││(Java:   │
                                 │ 8084)││ 8085)  ││ 8086)││ 8087)   │
                                 └──────┘└────────┘└──────┘└─────────┘

                        ┌──────────────────────────────┐
                        │     PostgreSQL (port 5432)    │
                        │  auth_db | account_db |       │
                        │  transaction_db | audit_db    │
                        └──────────────────────────────┘
```

A single money transfer generates **6–8 internal service-to-service HTTP calls**, making it ideal for measuring mTLS overhead:

```
Client (browser or k6)
  │
  POST /api/v1/transactions/transfer
  │
  ▼
API Gateway
  ├── GET → Auth Service         (token validation)
  └── POST → Transaction Service (proxy)
                ├── GET  → Account Service    (sender balance check)
                ├── GET  → Account Service    (recipient exists?)
                ├── POST → Fraud Service      (fraud check)
                ├── GET  → Exchange Service   (rate, if cross-currency)
                ├── PUT  → Account Service    (debit sender)
                ├── PUT  → Account Service    (credit recipient)
                ├── POST → Notification Svc   (send alert)
                └── POST → Audit Log Service  (log the event)
```

---

## Technology Stack

| Service | Language / Framework | Port | Database |
|---------|---------------------|------|----------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS (served by Nginx) | 3000 → 80 | — |
| API Gateway | Go 1.22 + chi router | 8080 | — |
| Auth Service | Go 1.22 + chi router | 8081 | PostgreSQL (`auth_db`) |
| Account Service | Kotlin + Spring Boot 3.2.5 + Spring Data JPA | 8082 | PostgreSQL (`account_db`) |
| Transaction Service | Kotlin + Spring Boot 3.2.5 + Spring Data JPA + RestTemplate | 8083 | PostgreSQL (`transaction_db`) |
| Fraud Detection Service | Go 1.22 + chi router | 8084 | — (stateless) |
| Exchange Rate Service | Python 3.12 + FastAPI | 8085 | — (stateless) |
| Notification Service | Python 3.12 + FastAPI | 8086 | — (stateless) |
| Audit Log Service | Java 21 + Spring Boot 3.2.5 + Spring Data JPA | 8087 | PostgreSQL (`audit_db`) |
| PostgreSQL | postgres:16-alpine | 5432 | — |

The polyglot design (Go, Kotlin, Java, Python, TypeScript) is intentional — it represents a realistic heterogeneous microservice environment.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [k6](https://k6.io/docs/getting-started/installation/) (for load testing)

---

## Getting Started

### Start All Services

```bash
docker-compose up -d
```

This will build all service images and start them with proper dependency ordering. Spring Boot services (account, transaction, audit) have a ~30s startup time.

### Verify Everything Is Running

```bash
docker-compose ps
```

Check individual health endpoints:

```bash
curl http://localhost:8080/healthz    # API Gateway
curl http://localhost:8081/healthz    # Auth Service
curl http://localhost:8082/healthz    # Account Service
curl http://localhost:8083/healthz    # Transaction Service
curl http://localhost:8084/healthz    # Fraud Service
curl http://localhost:8085/healthz    # Exchange Service
curl http://localhost:8086/healthz    # Notification Service
curl http://localhost:8087/healthz    # Audit Service
```

### Access the Frontend

Open [http://localhost:3000](http://localhost:3000) in a browser. Login as `alice`, `bob`, or `charlie` (no password required — auth is intentionally simplified since the research focus is on mTLS, not user authentication).

### Stop All Services

```bash
docker-compose down        # Stop containers (keep data)
docker-compose down -v     # Stop and delete all data volumes
```

---

## API Reference

All requests go through the **API Gateway** at `http://localhost:8080`. Authenticated endpoints require `Authorization: Bearer <token>` header.

### Authentication

```bash
# Register a new user
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "john"}'

# Login (returns token)
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice"}'
```

### Accounts

```bash
# Get your accounts
curl http://localhost:8080/api/v1/accounts/me \
  -H "Authorization: Bearer <token>"

# Get balances
curl http://localhost:8080/api/v1/accounts/me/balance \
  -H "Authorization: Bearer <token>"

# Create a new account
curl -X POST http://localhost:8080/api/v1/accounts \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"currency": "USD", "initialBalance": 500.00}'
```

### Transfers

```bash
# Execute a transfer
curl -X POST http://localhost:8080/api/v1/transactions/transfer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAccountId": "<sender-account-uuid>",
    "toAccountId": "<recipient-account-uuid>",
    "amount": 100.00,
    "currency": "EUR"
  }'

# Get transaction history
curl "http://localhost:8080/api/v1/transactions?accountId=<account-uuid>" \
  -H "Authorization: Bearer <token>"
```

### Exchange Rates

```bash
# Get all rates (base: EUR)
curl http://localhost:8080/api/v1/exchange-rates \
  -H "Authorization: Bearer <token>"

# Get specific rate
curl http://localhost:8085/api/v1/exchange-rates/EUR/USD

# Convert amount
curl -X POST http://localhost:8085/api/v1/exchange-rates/convert \
  -H "Content-Type: application/json" \
  -d '{"from": "EUR", "to": "USD", "amount": 100.00}'
```

Supported currencies: EUR, USD, GBP, HUF, RON, CHF, JPY.

---

## Service Details

### API Gateway (Go)

Single entry point for all external requests. Validates Bearer tokens by calling the Auth Service's `/internal/validate` endpoint, then proxies requests to the appropriate backend service with the `X-User-Id` header injected.

### Auth Service (Go)

Simplified authentication — username-to-token mapping without passwords or JWT. Tokens are UUIDs generated on each login. This is intentional: the dissertation's security focus is on mTLS (service-to-service), not user authentication.

### Account Service (Kotlin/Spring Boot)

Manages bank accounts and balances. Seeds sample accounts for `alice`, `bob`, and `charlie` on startup via a `CommandLineRunner`. Provides both external endpoints (via API Gateway) and internal endpoints called by the Transaction Service for balance updates.

### Transaction Service (Kotlin/Spring Boot)

The most complex service — orchestrates the entire transfer flow:
1. Validates sender balance and recipient existence (Account Service)
2. Runs fraud detection (Fraud Service)
3. Looks up exchange rates for cross-currency transfers (Exchange Service)
4. Debits sender and credits recipient (Account Service)
5. Sends notification (Notification Service) — fire-and-forget
6. Creates audit log entry (Audit Service) — fire-and-forget

Transaction status flow: `PENDING` → `FRAUD_CHECKED` → `PROCESSING` → `COMPLETED` | `FAILED` | `REJECTED`

### Fraud Detection Service (Go)

Stateless fraud rule engine. Evaluates transactions against configurable rules (amount thresholds, self-transfer detection, etc.) and returns `APPROVED`, `REVIEW`, or `REJECTED` with a risk score.

### Exchange Rate Service (Python/FastAPI)

Serves hard-coded exchange rates with EUR as the base currency. Supports rate lookup and amount conversion.

### Notification Service (Python/FastAPI)

Receives notification requests and logs them (simulated email delivery). In-memory storage — stateless and ephemeral.

### Audit Log Service (Java/Spring Boot)

Persists audit trail entries to PostgreSQL with JSONB detail storage. Supports querying by userId, action, and date range.

---

## Database

PostgreSQL 16 runs on port `5432` with credentials `microbank:microbank`. Four isolated databases:

| Database | Used by | Tables |
|----------|---------|--------|
| `auth_db` | Auth Service | `users` |
| `account_db` | Account Service | `accounts` |
| `transaction_db` | Transaction Service | `transactions` |
| `audit_db` | Audit Service | `audit_logs` |

Databases are created by `init.sql`. Schemas are auto-managed by Hibernate (`ddl-auto: update`) for Spring Boot services and by Go migrations for the Auth Service.

```bash
# Connect to a database
docker exec -it microbank-postgres-1 psql -U microbank -d account_db

# Run a quick query
docker exec microbank-postgres-1 psql -U microbank -d account_db \
  -c "SELECT id, user_id, currency, balance FROM accounts"
```

---

## Load Testing (k6)

Three k6 test scripts are included in the `k6/` directory:

| Script | VUs | Duration | Thresholds |
|--------|-----|----------|------------|
| `normal-traffic.js` | 10 | 5 min (ramp 1m → hold 3m → down 1m) | p95 < 500ms, fail rate < 10% |
| `peak-traffic.js` | 50 | 9 min (ramp 2m → hold 5m → down 2m) | p95 < 1s, fail rate < 15% |
| `burst-traffic.js` | 100 | Spike pattern (30s bursts) | p95 < 2s, fail rate < 20% |

```bash
# Run normal traffic test
k6 run k6/normal-traffic.js

# Run against a custom target
k6 run -e BASE_URL=http://localhost:8080 k6/normal-traffic.js

# Quick smoke test
k6 run --vus 2 --duration 30s k6/normal-traffic.js
```

The tests exercise the full transfer chain: login → get accounts → check balance → get rates → execute transfer → list transactions.

---

## Observability

### Health Checks

All services expose `/healthz`. Spring Boot services additionally expose `/actuator/health` and `/readyz` (where applicable) for readiness probes.

### Prometheus Metrics

Every service is instrumented for Prometheus scraping:

| Service Type | Metrics Endpoint | Instrumentation |
|-------------|-----------------|-----------------|
| Go services | `/metrics` | Manual `prometheus/client_golang` (counters + histograms) |
| Spring Boot services | `/actuator/prometheus` | Micrometer auto-instrumentation |
| Python/FastAPI services | `/metrics` | `prometheus-fastapi-instrumentator` |

Key metrics:
- `http_requests_total{method, path, status}` — request counter
- `http_request_duration_seconds{method, path}` — latency histogram

### Structured Logging

All services emit JSON-structured logs to stdout with fields: `timestamp`, `level`, `message`, and service-specific context.

```bash
# View logs for a specific service
docker-compose logs -f transaction-service

# View all logs since 5 minutes ago
docker-compose logs --since=5m

# Search for errors
docker-compose logs | grep -i error
```

---

## Project Structure

```
microbank/
├── docker-compose.yml          # Service orchestration
├── init.sql                    # Database creation script
├── k6/                         # Load test scripts
│   ├── normal-traffic.js
│   ├── peak-traffic.js
│   └── burst-traffic.js
└── services/
    ├── frontend/               # React + TypeScript + Vite + Tailwind
    ├── api-gateway/            # Go — reverse proxy + auth middleware
    ├── auth-service/           # Go — user authentication + token management
    ├── account-service/        # Kotlin/Spring Boot — account + balance management
    ├── transaction-service/    # Kotlin/Spring Boot — transfer orchestration
    ├── fraud-service/          # Go — fraud detection rule engine
    ├── exchange-service/       # Python/FastAPI — currency exchange rates
    ├── notification-service/   # Python/FastAPI — notification delivery (simulated)
    └── audit-service/          # Java/Spring Boot — audit trail persistence
```

---

## Development

### Rebuild a Single Service

```bash
docker-compose up --build -d <service-name>
```

### Rebuild by Stack

```bash
# Go services
docker-compose up --build -d auth-service fraud-service api-gateway

# Kotlin services
docker-compose up --build -d account-service transaction-service

# Python services
docker-compose up --build -d exchange-service notification-service

# Java service
docker-compose up --build -d audit-service
```

### Local Development (Without Docker)

**Go services:**
```bash
cd services/api-gateway
go mod tidy
go run ./cmd/main.go
```

**Kotlin/Java services:**
```bash
cd services/account-service
gradle bootRun
```

**Python services:**
```bash
cd services/exchange-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8085
```

**Frontend:**
```bash
cd services/frontend
npm install
npm run dev    # Vite dev server on :5173, proxies /api → localhost:8080
```

---

## Environment Variables

All services are configured via environment variables, making them ready for Kubernetes deployment.

### Database Services

| Variable | Default | Used by |
|----------|---------|---------|
| `DB_HOST` | `postgres` | auth, account, transaction, audit |
| `DB_PORT` | `5432` | auth, account, transaction, audit |
| `DB_USER` | `microbank` | auth, account, transaction, audit |
| `DB_PASSWORD` | `microbank` | auth, account, transaction, audit |
| `DB_NAME` | (per service) | auth, account, transaction, audit |

### Service Discovery

| Variable | Value | Used by |
|----------|-------|---------|
| `AUTH_SERVICE_URL` | `http://auth-service:8081` | api-gateway |
| `ACCOUNT_SERVICE_URL` | `http://account-service:8082` | api-gateway, transaction-service |
| `TRANSACTION_SERVICE_URL` | `http://transaction-service:8083` | api-gateway |
| `FRAUD_SERVICE_URL` | `http://fraud-service:8084` | transaction-service |
| `EXCHANGE_SERVICE_URL` | `http://exchange-service:8085` | api-gateway, transaction-service |
| `NOTIFICATION_SERVICE_URL` | `http://notification-service:8086` | transaction-service |
| `AUDIT_SERVICE_URL` | `http://audit-service:8087` | transaction-service |

---

## Design Decisions

- **Polyglot stack:** Intentionally uses 5 different languages/frameworks to represent a realistic heterogeneous microservice environment for security research.
- **Simplified auth:** No passwords or JWT — token-based only. The dissertation focuses on mTLS (service-to-service security), not user authentication mechanisms.
- **Database-per-service:** Each stateful service has its own isolated database, following microservices best practices. No cross-service database access.
- **Fire-and-forget side effects:** Notification and audit calls from the Transaction Service are non-blocking — their failure does not fail the transfer.
- **Kubernetes-ready:** All services are stateless (except via their databases), configured via environment variables, expose health endpoints, and run in minimal Docker images via multi-stage builds.
