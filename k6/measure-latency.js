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

export const options = {
  insecureSkipTLSVerify: true,
  stages: [
    { duration: '1m', target: 10 },
    { duration: '3m', target: 10 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration:        ['p(95)<500'],
    http_req_failed:          ['rate<0.1'],
    svc_auth_service:         ['p(95)<500'],
    svc_account_service:      ['p(95)<500'],
    svc_exchange_service:     ['p(95)<500'],
    svc_transaction_service:  ['p(95)<500'],
  },
};

const users = ['alice', 'bob', 'charlie'];
let token = null;
const username = users[(__VU - 1) % users.length];

function login() {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username }), {
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

export default function () {
  if (!token) {
    login();
  }

  // GET /api/v1/accounts/me  →  api-gateway → account-service
  const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, authHeaders());
  if (accountsRes.status === 401) { token = null; return; }
  check(accountsRes, { 'get accounts': (r) => r.status === 200 });
  svcAccount.add(accountsRes.timings.duration);

  // GET /api/v1/accounts/me/balance  →  api-gateway → account-service
  const balanceRes = http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders());
  if (balanceRes.status === 401) { token = null; return; }
  check(balanceRes, { 'get balance': (r) => r.status === 200 });
  svcBalance.add(balanceRes.timings.duration);

  // GET /api/v1/exchange-rates  →  api-gateway → exchange-service
  const ratesRes = http.get(`${BASE_URL}/api/v1/exchange-rates`, authHeaders());
  if (ratesRes.status === 401) { token = null; return; }
  check(ratesRes, { 'get rates': (r) => r.status === 200 });
  svcExchange.add(ratesRes.timings.duration);

  // POST /api/v1/transactions/transfer  →  api-gateway → transaction-service → (account, fraud, exchange, notification, audit)
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const transferRes = http.post(`${BASE_URL}/api/v1/transactions/transfer`, JSON.stringify({
        fromAccountId: accounts[0].id,
        toAccountId:   accounts[0].id,
        amount:        1.00,
        currency:      accounts[0].currency || 'EUR',
      }), authHeaders());
      if (transferRes.status === 401) { token = null; return; }
      check(transferRes, { 'transfer': (r) => r.status === 200 || r.status === 400 });
      svcTransaction.add(transferRes.timings.duration);
    }
  }

  // GET /api/v1/transactions  →  api-gateway → transaction-service
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const txRes = http.get(`${BASE_URL}/api/v1/transactions?accountId=${accounts[0].id}`, authHeaders());
      if (txRes.status === 401) { token = null; return; }
      check(txRes, { 'get transactions': (r) => r.status === 200 });
      svcTxHistory.add(txRes.timings.duration);
    }
  }

  sleep(1);
}
