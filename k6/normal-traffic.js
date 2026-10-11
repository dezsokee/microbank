import http from 'k6/http';
import { check, sleep } from 'k6';
import { provisionUsers, vuUser, transferTarget } from './lib/users.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const MAX_VUS = 10;

export const options = {
  setupTimeout: '5m',
  stages: [
    { duration: '1m', target: MAX_VUS },   // ramp up to 10 users
    { duration: '3m', target: MAX_VUS },   // stay at 10 users
    { duration: '1m', target: 0 },         // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.1'],
  },
};

// One dedicated user per VU — with 10 VUs over alice/bob/charlie, a re-login by
// one VU invalidated the token of every other VU on the same user (see lib/users.js).
export function setup() {
  return provisionUsers(BASE_URL, MAX_VUS);
}

// VU-local state: token is cached and only refreshed on 401.
let token = null;

function login(username) {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login success': (r) => r.status === 200 });
  token = res.status === 200 ? res.json('token') : null;
}

function authHeaders() {
  return {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
}

export default function (users) {
  const me = vuUser(users);

  // Login once per VU; re-login only if the token was rejected.
  if (!token) {
    login(me.username);
    if (!token) return;
  }

  // Get accounts
  const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, authHeaders());
  if (accountsRes.status === 401) { login(me.username); return; }
  check(accountsRes, { 'get accounts': (r) => r.status === 200 });

  // Get balance
  const balanceRes = http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders());
  if (balanceRes.status === 401) { login(me.username); return; }
  check(balanceRes, { 'get balance': (r) => r.status === 200 });

  // Get exchange rates
  const ratesRes = http.get(`${BASE_URL}/api/v1/exchange-rates`, authHeaders());
  if (ratesRes.status === 401) { login(me.username); return; }
  check(ratesRes, { 'get rates': (r) => r.status === 200 });

  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const fromAccount = accounts[0].id;

      // Make a transfer to another VU's account
      const transferRes = http.post(`${BASE_URL}/api/v1/transactions/transfer`, JSON.stringify({
        fromAccountId: fromAccount,
        toAccountId: transferTarget(users),
        amount: 1.00,
        currency: accounts[0].currency || 'EUR',
      }), authHeaders());
      if (transferRes.status === 401) { login(me.username); return; }
      check(transferRes, { 'transfer': (r) => r.status === 200 });

      // Get transactions
      const txRes = http.get(`${BASE_URL}/api/v1/transactions?accountId=${fromAccount}`, authHeaders());
      if (txRes.status === 401) { login(me.username); return; }
      check(txRes, { 'get transactions': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
