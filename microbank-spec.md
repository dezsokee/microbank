# MicroBank — FinTech Mock Application Specification

## Overview

MicroBank is a microservice-based fintech mock application that simulates a simplified banking system. Its purpose is to serve as the test workload for a master's dissertation researching **Software Supply Chain Security** and **Zero Trust (mTLS) architecture** in Kubernetes environments.

**Current scope:** Local development and testing with Docker Compose.
**Future scope:** Deployment to Kubernetes with service mesh (Istio/Linkerd/Cilium), SPIFFE/SPIRE workload identity, Sigstore image signing, and Prometheus/Grafana monitoring. The application is designed with Kubernetes deployment in mind — all services are stateless (except via their databases), use environment variables for configuration, expose health check endpoints, and communicate over HTTP REST.

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

### Request Flow — Single Transfer

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
| Account Service | Kotlin + Spring Boot 3 + Spring Data JPA | 8082 | PostgreSQL (`account_db`) |
| Transaction Service | Kotlin + Spring Boot 3 + Spring Data JPA + RestTemplate | 8083 | PostgreSQL (`transaction_db`) |
| Fraud Detection Service | Go 1.22 + chi router | 8084 | — (stateless) |
| Exchange Rate Service | Python 3.12 + FastAPI | 8085 | — (stateless) |
| Notification Service | Python 3.12 + FastAPI | 8086 | — (stateless) |
| Audit Log Service | Java 21 + Spring Boot 3 + Spring Data JPA | 8087 | PostgreSQL (`audit_db`) |
| PostgreSQL | postgres:16-alpine | 5432 | — |

---

## Service Specifications

---

### 1. Frontend (React)

A minimal single-page application for interacting with the banking system. This is a convenience UI — the primary testing tool is k6, which calls the API Gateway directly.

**Pages:**

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Enter username to get a token (mock auth, no password) |
| Dashboard | `/` | Display account balance and recent transactions |
| Transfer | `/transfer` | Transfer form: recipient account, amount, currency |
| Transactions | `/transactions` | Transaction history list |
| Rates | `/rates` | Current exchange rates table |

**API calls (all go through the API Gateway):**

```
POST   /api/v1/auth/login                → login, receive token
GET    /api/v1/accounts/me               → get own accounts
GET    /api/v1/accounts/me/balance       → get balance
POST   /api/v1/transactions/transfer     → initiate transfer
GET    /api/v1/transactions?accountId=X  → list transactions
GET    /api/v1/exchange-rates            → list all rates
```

**Auth handling:** Store the token in localStorage. Send it as `Authorization: Bearer <token>` on every request. Redirect to `/login` on 401 responses.

**Nginx config:** Proxy `/api/*` requests to the API Gateway container (`http://api-gateway:8080`). Serve static files for everything else. Handle client-side routing with `try_files $uri /index.html`.

**Dockerfile:**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

---

### 2. API Gateway (Go)

Single entry point for all external requests. Routes requests to the appropriate backend service and validates authentication tokens.

**Endpoints:**

| Method | Path | Routes to | Auth required |
|--------|------|-----------|---------------|
| POST | `/api/v1/auth/login` | Auth Service | No |
| POST | `/api/v1/auth/register` | Auth Service | No |
| GET | `/api/v1/accounts/*` | Account Service | Yes |
| POST | `/api/v1/accounts/*` | Account Service | Yes |
| GET | `/api/v1/transactions/*` | Transaction Service | Yes |
| POST | `/api/v1/transactions/*` | Transaction Service | Yes |
| GET | `/api/v1/exchange-rates/*` | Exchange Rate Service | Yes |
| GET | `/healthz` | self | No |

**Auth middleware logic:**

```
For every request (except /auth/login and /auth/register):
  1. Extract token from "Authorization: Bearer <token>" header
  2. Call Auth Service: GET http://auth-service:8081/internal/validate?token=<token>
  3. If invalid or unreachable → respond 401 Unauthorized
  4. If valid → set "X-User-Id" header from response, forward request to target service
```

**Reverse proxy logic:** Forward the full path as-is to the target service. Copy all headers. Return the target service's response directly.

**Environment variables:**

```
AUTH_SERVICE_URL=http://auth-service:8081
ACCOUNT_SERVICE_URL=http://account-service:8082
TRANSACTION_SERVICE_URL=http://transaction-service:8083
EXCHANGE_SERVICE_URL=http://exchange-service:8085
PORT=8080
```

**Dockerfile:**

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /gateway ./cmd/main.go

FROM alpine:3.19
COPY --from=builder /gateway /gateway
EXPOSE 8080
CMD ["/gateway"]
```

---

### 3. Auth Service (Go)

Simplified authentication service. No passwords, no JWT — just a username-to-token mapping. This is intentionally minimal because the dissertation's security focus is on mTLS (service-to-service), not on user authentication.

**Database — table `users`:**

```sql
CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username   VARCHAR(100) UNIQUE NOT NULL,
    token      VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Create user, return token |
| POST | `/api/v1/auth/login` | Find user by username, generate new token, return it |
| GET | `/internal/validate` | Validate token (query param: `?token=X`; called by API Gateway only) |
| GET | `/healthz` | Health check |

**Request/Response:**

```
POST /api/v1/auth/register
Request:  {"username": "john.doe"}
Response: {"userId": "uuid-1", "username": "john.doe", "token": "uuid-token-1"}

POST /api/v1/auth/login
Request:  {"username": "john.doe"}
Response: {"userId": "uuid-1", "username": "john.doe", "token": "uuid-token-2"}

GET /internal/validate?token=uuid-token-2
Response (valid):   {"valid": true, "userId": "uuid-1", "username": "john.doe"}
Response (invalid): {"valid": false}
```

**Token generation:** Use Go's `uuid.New()` (google/uuid package). No expiration, no refresh.

**Environment variables:**

```
DB_HOST=postgres
DB_PORT=5432
DB_USER=microbank
DB_PASSWORD=microbank
DB_NAME=auth_db
PORT=8081
```

**Dockerfile:** Same pattern as API Gateway (Go multi-stage).

---

### 4. Account Service (Kotlin / Spring Boot)

Manages bank accounts and balances. Provides both external endpoints (via API Gateway) and internal endpoints (called by Transaction Service).

**Database — table `accounts`:**

```sql
CREATE TABLE accounts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL,
    currency   VARCHAR(3) NOT NULL DEFAULT 'EUR',
    balance    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    status     VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**Endpoints:**

| Method | Path | Description | Called by |
|--------|------|-------------|----------|
| POST | `/api/v1/accounts` | Create account | API Gateway |
| GET | `/api/v1/accounts/me` | List own accounts (by X-User-Id header) | API Gateway |
| GET | `/api/v1/accounts/me/balance` | Get balances for own accounts | API Gateway |
| GET | `/api/v1/accounts/{id}` | Get account details | Transaction Service |
| GET | `/api/v1/accounts/{id}/exists` | Check if account exists | Transaction Service |
| PUT | `/api/v1/accounts/{id}/balance` | Update balance (internal) | Transaction Service |
| GET | `/healthz` | Health check | Docker / Kubernetes |

**Request/Response:**

```
POST /api/v1/accounts
Headers: X-User-Id: uuid-1
Request:  {"currency": "EUR", "initialBalance": 1000.00}
Response: {"id": "acc-1", "userId": "uuid-1", "currency": "EUR", "balance": 1000.00, "status": "ACTIVE"}

GET /api/v1/accounts/me/balance
Headers: X-User-Id: uuid-1
Response: {
  "accounts": [
    {"id": "acc-1", "currency": "EUR", "balance": 1000.00},
    {"id": "acc-2", "currency": "USD", "balance": 500.00}
  ]
}

GET /api/v1/accounts/{id}
Response: {"id": "acc-1", "userId": "uuid-1", "currency": "EUR", "balance": 1000.00, "status": "ACTIVE"}

GET /api/v1/accounts/{id}/exists
Response: {"exists": true, "id": "acc-1", "currency": "EUR"}

PUT /api/v1/accounts/{id}/balance
Request:  {"amount": -100.00, "transactionId": "tx-uuid"}
Response: {"id": "acc-1", "newBalance": 900.00}
```

**Spring Boot config (application.yml):**

```yaml
server:
  port: 8082
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:postgres}:${DB_PORT:5432}/${DB_NAME:account_db}
    username: ${DB_USER:microbank}
    password: ${DB_PASSWORD:microbank}
  jpa:
    hibernate:
      ddl-auto: update
```

**Dockerfile:**

```dockerfile
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /app
COPY . .
RUN ./gradlew bootJar

FROM eclipse-temurin:21-jre
COPY --from=builder /app/build/libs/*.jar app.jar
EXPOSE 8082
CMD ["java", "-jar", "app.jar"]
```

---

### 5. Transaction Service (Kotlin / Spring Boot)

The most complex service — orchestrates the entire transfer flow by calling 5–7 other services.

**Database — table `transactions`:**

```sql
CREATE TABLE transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_account_id   UUID NOT NULL,
    to_account_id     UUID NOT NULL,
    amount            DECIMAL(15,2) NOT NULL,
    currency          VARCHAR(3) NOT NULL,
    original_amount   DECIMAL(15,2),
    original_currency VARCHAR(3),
    exchange_rate     DECIMAL(10,6),
    status            VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    fraud_check       VARCHAR(20) DEFAULT 'PENDING',
    failure_reason    VARCHAR(500),
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);
```

**Status flow:** `PENDING` → `FRAUD_CHECKED` → `PROCESSING` → `COMPLETED` | `FAILED` | `REJECTED`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/transactions/transfer` | Initiate a transfer |
| GET | `/api/v1/transactions` | List transactions (query: `?accountId=X`) |
| GET | `/api/v1/transactions/{id}` | Get transaction details |
| GET | `/healthz` | Health check |

**Transfer orchestration (pseudocode):**

```
Transfer(fromAccountId, toAccountId, amount, currency):

  1. Save transaction to DB with status = PENDING

  2. GET → Account Service: /api/v1/accounts/{fromAccountId}
     Check: does the sender account exist? Is the balance sufficient?
     If not → status = FAILED, return error

  3. GET → Account Service: /api/v1/accounts/{toAccountId}/exists
     Check: does the recipient account exist?
     If not → status = FAILED, return error

  4. POST → Fraud Service: /api/v1/fraud/check
     Body: {transactionId, fromAccountId, toAccountId, amount, currency}
     If result = REJECTED → status = REJECTED, return error
     Update: status = FRAUD_CHECKED

  5. If sender currency != recipient currency:
     GET → Exchange Rate Service: /api/v1/exchange-rates/{from}/{to}
     Calculate converted amount
     Store: original_amount, original_currency, exchange_rate

  6. PUT → Account Service: /api/v1/accounts/{fromAccountId}/balance
     Body: {amount: -amount, transactionId}
     (debit sender)

     PUT → Account Service: /api/v1/accounts/{toAccountId}/balance
     Body: {amount: +amount (or converted amount), transactionId}
     (credit recipient)

     Update: status = COMPLETED

  7. POST → Notification Service: /api/v1/notifications
     Body: {type: "TRANSFER_COMPLETED", userId, transactionId, message}
     (fire-and-forget — failure here does NOT fail the transaction)

  8. POST → Audit Log Service: /api/v1/audit
     Body: {action: "TRANSFER_COMPLETED", entityType: "TRANSACTION",
            entityId: transactionId, userId, details: {...}}
     (fire-and-forget — failure here does NOT fail the transaction)

  9. Return transaction with status = COMPLETED
```

**Transfer request/response:**

```
POST /api/v1/transactions/transfer
Headers: X-User-Id: uuid-1
Request: {
  "fromAccountId": "acc-1",
  "toAccountId": "acc-2",
  "amount": 100.00,
  "currency": "EUR"
}

Response (success): {
  "id": "tx-uuid",
  "fromAccountId": "acc-1",
  "toAccountId": "acc-2",
  "amount": 100.00,
  "currency": "EUR",
  "status": "COMPLETED",
  "createdAt": "2025-03-23T10:00:00Z"
}

Response (fraud rejected): {
  "id": "tx-uuid",
  "status": "REJECTED",
  "failureReason": "Fraud check failed: risk score 75"
}
```

**HTTP clients:** Create a separate client class for each downstream service (AccountClient, FraudClient, ExchangeClient, NotificationClient, AuditClient) using Spring's RestTemplate. Each client reads the target service URL from environment variables.

**Environment variables:**

```
DB_HOST=postgres
DB_PORT=5432
DB_USER=microbank
DB_PASSWORD=microbank
DB_NAME=transaction_db
ACCOUNT_SERVICE_URL=http://account-service:8082
FRAUD_SERVICE_URL=http://fraud-service:8084
EXCHANGE_SERVICE_URL=http://exchange-service:8085
NOTIFICATION_SERVICE_URL=http://notification-service:8086
AUDIT_SERVICE_URL=http://audit-service:8087
PORT=8083
```

**Dockerfile:** Same pattern as Account Service (Kotlin/Spring Boot multi-stage).

---

### 6. Fraud Detection Service (Go)

Stateless, rule-based fraud detection. No database — evaluates each transaction against a fixed set of rules and returns a risk score.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/fraud/check` | Check a transaction |
| GET | `/healthz` | Health check |

**Request/Response:**

```
POST /api/v1/fraud/check
Request: {
  "transactionId": "tx-uuid",
  "fromAccountId": "acc-1",
  "toAccountId": "acc-2",
  "amount": 100.00,
  "currency": "EUR"
}

Response: {
  "transactionId": "tx-uuid",
  "result": "APPROVED",
  "riskScore": 15,
  "rules": [
    {"rule": "AMOUNT_LIMIT", "passed": true, "detail": "Amount under 10000 limit"},
    {"rule": "FREQUENCY", "passed": true, "detail": "Normal frequency"}
  ]
}
```

**Rules (pseudocode):**

```
FraudCheck(request):
  riskScore = 0
  rules = []

  if amount > 10000:
    riskScore += 50
    rules.add("AMOUNT_LIMIT: FAILED")
  else:
    rules.add("AMOUNT_LIMIT: PASSED")

  if amount > 5000:
    riskScore += 20
    rules.add("HIGH_AMOUNT: WARNING")

  if random() < 0.05:   // 5% chance — simulated frequency anomaly
    riskScore += 30
    rules.add("FREQUENCY: WARNING — simulated high frequency")

  if random() < 0.02:   // 2% chance — simulated suspicious account
    riskScore += 40
    rules.add("SUSPICIOUS_ACCOUNT: WARNING")

  if riskScore >= 70 → result = "REJECTED"
  else if riskScore >= 40 → result = "REVIEW"
  else → result = "APPROVED"

  return {transactionId, result, riskScore, rules}
```

**Note:** The `REVIEW` result is treated as `APPROVED` by the Transaction Service for simplicity.

**Environment variables:**

```
PORT=8084
```

**Dockerfile:** Same pattern as API Gateway (Go multi-stage).

---

### 7. Exchange Rate Service (Python / FastAPI)

Stateless service returning mock exchange rates with a small random fluctuation to simulate market conditions.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/exchange-rates` | List all rates (base: EUR) |
| GET | `/api/v1/exchange-rates/{from}/{to}` | Get specific rate |
| POST | `/api/v1/exchange-rates/convert` | Convert an amount |
| GET | `/healthz` | Health check |

**Mock rates (base: EUR, ±0.5% random fluctuation per call):**

```python
BASE_RATES = {
    "EUR": 1.0,
    "USD": 1.08,
    "GBP": 0.86,
    "HUF": 395.50,
    "RON": 4.97,
    "CHF": 0.94,
    "JPY": 162.30,
}
```

**Request/Response:**

```
GET /api/v1/exchange-rates
Response: {
  "base": "EUR",
  "rates": {"USD": 1.0812, "GBP": 0.8587, "HUF": 396.22, ...},
  "timestamp": "2025-03-23T10:00:00Z"
}

GET /api/v1/exchange-rates/EUR/HUF
Response: {"from": "EUR", "to": "HUF", "rate": 395.87, "timestamp": "..."}

POST /api/v1/exchange-rates/convert
Request:  {"from": "EUR", "to": "HUF", "amount": 100.00}
Response: {"from": "EUR", "to": "HUF", "originalAmount": 100.00, "convertedAmount": 39587.00, "rate": 395.87}
```

**requirements.txt:**

```
fastapi==0.111.0
uvicorn==0.30.0
```

**Environment variables:**

```
PORT=8085
```

**Dockerfile:**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8085
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8085"]
```

---

### 8. Notification Service (Python / FastAPI)

Mock notification service. Does not send real emails — logs the notification to stdout and stores it in an in-memory list.

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/notifications` | "Send" a notification (logs to stdout) |
| GET | `/api/v1/notifications` | List recent notifications (query: `?userId=X`) |
| GET | `/healthz` | Health check |

**Request/Response:**

```
POST /api/v1/notifications
Request: {
  "type": "TRANSFER_COMPLETED",
  "userId": "uuid-1",
  "transactionId": "tx-uuid",
  "message": "Transfer of 100.00 EUR to acc-2 completed successfully"
}
Response: {"id": "notif-uuid", "status": "SENT", "channel": "EMAIL", "timestamp": "..."}

GET /api/v1/notifications?userId=uuid-1
Response: {
  "notifications": [
    {"id": "notif-uuid", "type": "TRANSFER_COMPLETED", "message": "...", "timestamp": "..."}
  ]
}
```

**Implementation:** Store notifications in a Python list (in-memory). The list resets on container restart — this is fine for a mock.

**requirements.txt:**

```
fastapi==0.111.0
uvicorn==0.30.0
```

**Environment variables:**

```
PORT=8086
```

**Dockerfile:** Same pattern as Exchange Rate Service.

---

### 9. Audit Log Service (Java / Spring Boot)

Persists audit trail entries for all significant operations.

**Database — table `audit_logs`:**

```sql
CREATE TABLE audit_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action         VARCHAR(50) NOT NULL,
    entity_type    VARCHAR(50) NOT NULL,
    entity_id      UUID,
    user_id        UUID,
    details        JSONB,
    source_service VARCHAR(100),
    created_at     TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at);
```

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/audit` | Create audit log entry |
| GET | `/api/v1/audit` | Query logs (query params: `userId`, `action`, `from`, `to`) |
| GET | `/healthz` | Health check |

**Request/Response:**

```
POST /api/v1/audit
Request: {
  "action": "TRANSFER_COMPLETED",
  "entityType": "TRANSACTION",
  "entityId": "tx-uuid",
  "userId": "uuid-1",
  "details": {"fromAccount": "acc-1", "toAccount": "acc-2", "amount": 100.00, "currency": "EUR"},
  "sourceService": "transaction-service"
}
Response: {"id": "audit-uuid", "action": "TRANSFER_COMPLETED", "createdAt": "..."}

GET /api/v1/audit?userId=uuid-1&from=2025-03-01&to=2025-03-31
Response: {
  "logs": [
    {"id": "audit-uuid", "action": "TRANSFER_COMPLETED", "entityType": "TRANSACTION",
     "entityId": "tx-uuid", "sourceService": "transaction-service", "createdAt": "..."}
  ]
}
```

**Note:** The `details` field uses PostgreSQL's `JSONB` type. In the JPA entity, map it with a JSON converter or `@Type(JsonType.class)` with Hibernate Types.

**Spring Boot config (application.yml):**

```yaml
server:
  port: 8087
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:postgres}:${DB_PORT:5432}/${DB_NAME:audit_db}
    username: ${DB_USER:microbank}
    password: ${DB_PASSWORD:microbank}
  jpa:
    hibernate:
      ddl-auto: update
```

**Dockerfile:**

```dockerfile
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /app
COPY . .
RUN ./gradlew bootJar

FROM eclipse-temurin:21-jre
COPY --from=builder /app/build/libs/*.jar app.jar
EXPOSE 8087
CMD ["java", "-jar", "app.jar"]
```

---

## Cross-Cutting Concerns

### Health Check Endpoints

Every service must expose:

```
GET /healthz → {"status": "UP", "service": "<service-name>"}
```

For services with a database, also expose:

```
GET /readyz → {"status": "READY", "service": "<service-name>"}
  (returns 503 if DB is unreachable)
```

### Logging

All services log in JSON format to stdout:

```json
{"timestamp": "2025-03-23T10:00:00Z", "level": "INFO", "service": "transaction-service", "message": "Transfer initiated", "details": {"fromAccount": "acc-1", "amount": 100.00}}
```

### Error Response Format

All services return errors consistently:

```json
{"error": "INSUFFICIENT_BALANCE", "message": "Account acc-1 has insufficient balance", "timestamp": "2025-03-23T10:00:00Z"}
```

HTTP status codes: `400` bad request, `401` unauthorized, `404` not found, `409` conflict, `500` internal error, `503` service unavailable.

### Prometheus Metrics (prepared for Kubernetes phase)

Every service should expose `GET /metrics` in Prometheus format. Not consumed locally, but prepared for Kubernetes.

Minimum metrics:

```
http_requests_total{method, path, status}
http_request_duration_seconds{method, path}
```

Per language:
- **Go:** `prometheus/client_golang`
- **Kotlin/Java (Spring Boot):** Spring Actuator + Micrometer (`/actuator/prometheus`)
- **Python (FastAPI):** `prometheus-fastapi-instrumentator`

---

## Database Setup

Single PostgreSQL container with four databases. Init script runs on first startup.

**init.sql:**

```sql
CREATE DATABASE auth_db;
CREATE DATABASE account_db;
CREATE DATABASE transaction_db;
CREATE DATABASE audit_db;
```

Table creation is handled by each service:
- **Spring Boot** (Account, Transaction, Audit): JPA `ddl-auto: update`
- **Go** (Auth): `CREATE TABLE IF NOT EXISTS` on startup

**Seed data (inserted by services on startup if tables are empty):**

```
User: "alice"   → Account: EUR, balance 10000.00
                → Account: USD, balance 5000.00
User: "bob"     → Account: EUR, balance 5000.00
User: "charlie" → Account: HUF, balance 2000000.00
```

---

## Docker Compose

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: microbank
      POSTGRES_PASSWORD: microbank
      POSTGRES_DB: microbank
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U microbank"]
      interval: 5s
      timeout: 5s
      retries: 5

  auth-service:
    build: ./services/auth-service
    ports:
      - "8081:8081"
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_USER: microbank
      DB_PASSWORD: microbank
      DB_NAME: auth_db
      PORT: "8081"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8081/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  account-service:
    build: ./services/account-service
    ports:
      - "8082:8082"
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_USER: microbank
      DB_PASSWORD: microbank
      DB_NAME: account_db
      PORT: "8082"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8082/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  fraud-service:
    build: ./services/fraud-service
    ports:
      - "8084:8084"
    environment:
      PORT: "8084"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8084/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  exchange-service:
    build: ./services/exchange-service
    ports:
      - "8085:8085"
    environment:
      PORT: "8085"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8085/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  notification-service:
    build: ./services/notification-service
    ports:
      - "8086:8086"
    environment:
      PORT: "8086"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8086/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  audit-service:
    build: ./services/audit-service
    ports:
      - "8087:8087"
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_USER: microbank
      DB_PASSWORD: microbank
      DB_NAME: audit_db
      PORT: "8087"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8087/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  transaction-service:
    build: ./services/transaction-service
    ports:
      - "8083:8083"
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_USER: microbank
      DB_PASSWORD: microbank
      DB_NAME: transaction_db
      ACCOUNT_SERVICE_URL: http://account-service:8082
      FRAUD_SERVICE_URL: http://fraud-service:8084
      EXCHANGE_SERVICE_URL: http://exchange-service:8085
      NOTIFICATION_SERVICE_URL: http://notification-service:8086
      AUDIT_SERVICE_URL: http://audit-service:8087
      PORT: "8083"
    depends_on:
      account-service:
        condition: service_healthy
      fraud-service:
        condition: service_healthy
      exchange-service:
        condition: service_healthy
      notification-service:
        condition: service_healthy
      audit-service:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8083/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  api-gateway:
    build: ./services/api-gateway
    ports:
      - "8080:8080"
    environment:
      AUTH_SERVICE_URL: http://auth-service:8081
      ACCOUNT_SERVICE_URL: http://account-service:8082
      TRANSACTION_SERVICE_URL: http://transaction-service:8083
      EXCHANGE_SERVICE_URL: http://exchange-service:8085
      PORT: "8080"
    depends_on:
      auth-service:
        condition: service_healthy
      account-service:
        condition: service_healthy
      transaction-service:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3

  frontend:
    build: ./services/frontend
    ports:
      - "3000:80"
    depends_on:
      api-gateway:
        condition: service_healthy

volumes:
  postgres_data:
```

---

## Project Directory Structure

```
microbank/
├── docker-compose.yml
├── init.sql
├── README.md
├── services/
│   ├── frontend/
│   │   ├── Dockerfile
│   │   ├── nginx.conf
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── api/
│   │       │   └── client.ts
│   │       ├── pages/
│   │       │   ├── LoginPage.tsx
│   │       │   ├── DashboardPage.tsx
│   │       │   ├── TransferPage.tsx
│   │       │   ├── TransactionsPage.tsx
│   │       │   └── RatesPage.tsx
│   │       └── components/
│   │           ├── Layout.tsx
│   │           ├── Navbar.tsx
│   │           └── TransactionList.tsx
│   ├── api-gateway/
│   │   ├── Dockerfile
│   │   ├── go.mod
│   │   └── cmd/
│   │       └── main.go
│   ├── auth-service/
│   │   ├── Dockerfile
│   │   ├── go.mod
│   │   └── cmd/
│   │       └── main.go
│   ├── account-service/
│   │   ├── Dockerfile
│   │   ├── build.gradle.kts
│   │   ├── settings.gradle.kts
│   │   └── src/main/kotlin/com/microbank/account/
│   │       ├── AccountApplication.kt
│   │       ├── controller/AccountController.kt
│   │       ├── service/AccountService.kt
│   │       ├── repository/AccountRepository.kt
│   │       ├── model/Account.kt
│   │       └── dto/
│   │           ├── CreateAccountRequest.kt
│   │           ├── AccountResponse.kt
│   │           ├── BalanceResponse.kt
│   │           └── BalanceUpdateRequest.kt
│   ├── transaction-service/
│   │   ├── Dockerfile
│   │   ├── build.gradle.kts
│   │   ├── settings.gradle.kts
│   │   └── src/main/kotlin/com/microbank/transaction/
│   │       ├── TransactionApplication.kt
│   │       ├── controller/TransactionController.kt
│   │       ├── service/TransferService.kt
│   │       ├── client/
│   │       │   ├── AccountClient.kt
│   │       │   ├── FraudClient.kt
│   │       │   ├── ExchangeClient.kt
│   │       │   ├── NotificationClient.kt
│   │       │   └── AuditClient.kt
│   │       ├── repository/TransactionRepository.kt
│   │       ├── model/Transaction.kt
│   │       └── dto/
│   │           ├── TransferRequest.kt
│   │           └── TransferResponse.kt
│   ├── fraud-service/
│   │   ├── Dockerfile
│   │   ├── go.mod
│   │   └── cmd/
│   │       └── main.go
│   ├── exchange-service/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── main.py
│   ├── notification-service/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── main.py
│   └── audit-service/
│       ├── Dockerfile
│       ├── build.gradle
│       ├── settings.gradle
│       └── src/main/java/com/microbank/audit/
│           ├── AuditApplication.java
│           ├── controller/AuditController.java
│           ├── service/AuditService.java
│           ├── repository/AuditLogRepository.java
│           ├── model/AuditLog.java
│           └── dto/
│               ├── AuditRequest.java
│               └── AuditResponse.java
└── k6/
    ├── normal-traffic.js
    ├── peak-traffic.js
    └── burst-traffic.js
```

---

## Implementation Order

| Phase | What to build | Why this order |
|-------|--------------|----------------|
| 1 | `init.sql` + PostgreSQL in docker-compose | Everything depends on the database |
| 2 | Auth Service (Go) | No dependencies besides DB; simplest service |
| 3 | Account Service (Kotlin/Spring) | Simple CRUD; testable with direct HTTP calls |
| 4 | Fraud Detection Service (Go) | Stateless, no dependencies |
| 5 | Exchange Rate Service (Python) | Stateless, no dependencies |
| 6 | Notification Service (Python) | Stateless, no dependencies |
| 7 | Audit Log Service (Java/Spring) | Simple CRUD, depends only on DB |
| 8 | API Gateway (Go) | Auth + Account exist to proxy to |
| 9 | Transaction Service (Kotlin/Spring) | Last — calls everything; all dependencies must be running |
| 10 | Frontend (React) | API Gateway is ready; build the UI last |
| 11 | docker-compose.yml finalization | All services exist; wire them together |
| 12 | k6 test scripts | Everything runs; start load testing |

---

## Service-to-Service Call Matrix

```
                  Called ──────────────────────────────────────────
                  │ Auth │ Account │ Tx  │ Fraud │ Exch │ Notif │ Audit │
Caller            │      │         │     │       │      │       │       │
──────────────────┼──────┼─────────┼─────┼───────┼──────┼───────┼───────┤
API Gateway       │  ✅   │   ✅     │ ✅   │       │  ✅   │       │       │
Transaction Svc   │      │   ✅     │     │  ✅    │  ✅   │  ✅    │  ✅    │

✅ = calls this service
```

**Per transfer: 6–8 internal HTTP calls.**

---

## Quick Start

```bash
git clone <repo>
cd microbank
docker-compose up --build

# Frontend:    http://localhost:3000
# API Gateway: http://localhost:8080

# Pre-seeded users: alice, bob, charlie
# Login as "alice" to start making transfers

# Load testing:
k6 run k6/normal-traffic.js
```
