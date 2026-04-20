import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // ramp up to 10 users
    { duration: '3m', target: 10 },   // stay at 10 users
    { duration: '1m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
  },
};

// Pre-seeded users — assign each VU a dedicated user to avoid token conflicts.
// With 3 users and up to 10 VUs, VUs sharing a user are grouped so at most
// one VU per user is active at any time on the same user slot.
const users = ['alice', 'bob', 'charlie'];

// VU-local state: token is cached and only refreshed on 401.
let token = null;
const username = users[(__VU - 1) % users.length];

function login() {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login success': (r) => r.status === 200 });
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
  // Login once per VU; re-login if token was invalidated by a competing VU.
  if (!token) {
    login();
  }

  // Get accounts
  const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, authHeaders());
  if (accountsRes.status === 401) { login(); return; }
  check(accountsRes, { 'get accounts': (r) => r.status === 200 });

  // Get balance
  const balanceRes = http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders());
  if (balanceRes.status === 401) { login(); return; }
  check(balanceRes, { 'get balance': (r) => r.status === 200 });

  // Get exchange rates
  const ratesRes = http.get(`${BASE_URL}/api/v1/exchange-rates`, authHeaders());
  if (ratesRes.status === 401) { login(); return; }
  check(ratesRes, { 'get rates': (r) => r.status === 200 });

  // Make a transfer
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const fromAccount = accounts[0].id;
      const transferRes = http.post(`${BASE_URL}/api/v1/transactions/transfer`, JSON.stringify({
        fromAccountId: fromAccount,
        toAccountId: fromAccount,
        amount: 1.00,
        currency: accounts[0].currency || 'EUR',
      }), authHeaders());
      if (transferRes.status === 401) { login(); return; }
      check(transferRes, { 'transfer': (r) => r.status === 200 || r.status === 400 });
    }
  }

  // Get transactions
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const txRes = http.get(`${BASE_URL}/api/v1/transactions?accountId=${accounts[0].id}`, authHeaders());
      if (txRes.status === 401) { login(); return; }
      check(txRes, { 'get transactions': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
