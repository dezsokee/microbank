import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Per-service custom metrics visible in the k6 summary table
const svcAuth        = new Trend('svc_auth_service',         true);
const svcAccount     = new Trend('svc_account_service',      true);
const svcBalance     = new Trend('svc_account_balance',      true);
const svcExchange    = new Trend('svc_exchange_service',     true);
const svcTransaction = new Trend('svc_transaction_service',  true);
const svcTxHistory   = new Trend('svc_tx_history',           true);

// Max VUs must match user count: the auth service stores one token per user and
// overwrites it on each login. Multiple VUs sharing the same user invalidate each
// other's tokens every iteration, causing a 401 cascade that prevents the
// transaction service from ever being reached.
const users = ['alice', 'bob', 'charlie'];

export const options = {
  insecureSkipTLSVerify: true,
  stages: [
    { duration: '1m', target: 3 },
    { duration: '3m', target: 3 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration:        ['p(95)<500'],
    http_req_failed:          ['rate<0.05'],
    svc_auth_service:         ['p(95)<500'],
    svc_account_service:      ['p(95)<500'],
    svc_exchange_service:     ['p(95)<500'],
    svc_transaction_service:  ['p(95)<500'],
  },
};

// Pre-fetch account IDs for all users so each VU can transfer to a different
// user's account rather than self-transferring (which the transaction service rejects).
export function setup() {
  const accounts = {};
  for (const user of users) {
    const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username: user }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const t = loginRes.json('token');
    const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` },
    });
    const list = accountsRes.json();
    if (list && list.length > 0) {
      accounts[user] = list[0].id;
    }
  }
  return accounts;
}

// VU-local token — each VU owns one user exclusively (no sharing).
let token = null;

function username() {
  return users[(__VU - 1) % users.length];
}

function login() {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username: username() }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login success': (r) => r.status === 200 });
  svcAuth.add(res.timings.duration);
  token = res.json('token');
}

function authHeaders() {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
}

function handleUnauthorized() {
  token = null;
  login();
}

export default function (data) {
  if (!token) {
    login();
  }

  // GET /api/v1/accounts/me  →  api-gateway → account-service
  const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, authHeaders());
  if (accountsRes.status === 401) { handleUnauthorized(); return; }
  check(accountsRes, { 'get accounts': (r) => r.status === 200 });
  svcAccount.add(accountsRes.timings.duration);

  // GET /api/v1/accounts/me/balance  →  api-gateway → account-service
  const balanceRes = http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders());
  if (balanceRes.status === 401) { handleUnauthorized(); return; }
  check(balanceRes, { 'get balance': (r) => r.status === 200 });
  svcBalance.add(balanceRes.timings.duration);

  // GET /api/v1/exchange-rates  →  api-gateway → exchange-service
  const ratesRes = http.get(`${BASE_URL}/api/v1/exchange-rates`, authHeaders());
  if (ratesRes.status === 401) { handleUnauthorized(); return; }
  check(ratesRes, { 'get rates': (r) => r.status === 200 });
  svcExchange.add(ratesRes.timings.duration);

  // POST /api/v1/transactions/transfer  →  api-gateway → transaction-service → (account, fraud, exchange, notification, audit)
  const accounts = accountsRes.json();
  if (accounts && accounts.length > 0) {
    const fromAccountId = accounts[0].id;
    const nextUser = users[__VU % users.length];
    const toAccountId = data[nextUser] || fromAccountId;

    const transferRes = http.post(`${BASE_URL}/api/v1/transactions/transfer`, JSON.stringify({
      fromAccountId,
      toAccountId,
      amount:   1.00,
      currency: accounts[0].currency || 'EUR',
    }), authHeaders());
    svcTransaction.add(transferRes.timings.duration);
    if (transferRes.status === 401) { handleUnauthorized(); return; }
    check(transferRes, { 'transfer': (r) => r.status === 200 || r.status === 400 || r.status === 403 });

    // GET /api/v1/transactions  →  api-gateway → transaction-service
    const txRes = http.get(`${BASE_URL}/api/v1/transactions?accountId=${fromAccountId}`, authHeaders());
    svcTxHistory.add(txRes.timings.duration);
    if (txRes.status === 401) { handleUnauthorized(); return; }
    check(txRes, { 'get transactions': (r) => r.status === 200 });
  }

  sleep(1);
}
