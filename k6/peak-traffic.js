import http from 'k6/http';
import { check, sleep } from 'k6';
import { provisionUsers, vuUser, transferTarget } from './lib/users.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const MAX_VUS = 50;

export const options = {
  setupTimeout: '5m',
  stages: [
    { duration: '2m', target: MAX_VUS },   // ramp up to 50 users
    { duration: '5m', target: MAX_VUS },   // stay at 50 users
    { duration: '2m', target: 0 },         // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.15'],
  },
};

// One dedicated user per VU — see lib/users.js for why sharing alice/bob/charlie
// across 50 VUs breaks authentication.
export function setup() {
  return provisionUsers(BASE_URL, MAX_VUS);
}

function login(username) {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login success': (r) => r.status === 200 });
  return res.status === 200 ? res.json('token') : null;
}

export default function (users) {
  const me = vuUser(users);
  const token = login(me.username);
  if (!token) return;

  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };

  // Get balance
  const balanceRes = http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders);
  check(balanceRes, { 'get balance': (r) => r.status === 200 });

  // Get accounts and make transfer
  const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, authHeaders);
  check(accountsRes, { 'get accounts': (r) => r.status === 200 });
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const transferRes = http.post(`${BASE_URL}/api/v1/transactions/transfer`, JSON.stringify({
        fromAccountId: accounts[0].id,
        toAccountId: transferTarget(users),
        amount: 0.01,
        currency: accounts[0].currency || 'EUR',
      }), authHeaders);
      check(transferRes, { 'transfer': (r) => r.status === 200 });
    }
  }

  sleep(0.5);
}
