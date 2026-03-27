import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '2m', target: 50 },   // ramp up to 50 users
    { duration: '5m', target: 50 },   // stay at 50 users
    { duration: '2m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.15'],
  },
};

const users = ['alice', 'bob', 'charlie'];

function login(username) {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'login success': (r) => r.status === 200 });
  return res.json().token;
}

export default function () {
  const username = users[Math.floor(Math.random() * users.length)];
  const token = login(username);
  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };

  // Get balance
  http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders);

  // Get accounts and make transfer
  const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, authHeaders);
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      http.post(`${BASE_URL}/api/v1/transactions/transfer`, JSON.stringify({
        fromAccountId: accounts[0].id,
        toAccountId: accounts[0].id,
        amount: 0.01,
        currency: accounts[0].currency || 'EUR',
      }), authHeaders);
    }
  }

  sleep(0.5);
}
