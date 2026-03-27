import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '30s', target: 100 },  // spike to 100 users
    { duration: '1m', target: 100 },   // stay at 100
    { duration: '30s', target: 0 },    // drop to 0
    { duration: '30s', target: 100 },  // spike again
    { duration: '1m', target: 100 },   // stay at 100
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.2'],
  },
};

const users = ['alice', 'bob', 'charlie'];

function login(username) {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ username }), {
    headers: { 'Content-Type': 'application/json' },
  });
  return res.status === 200 ? res.json().token : null;
}

export default function () {
  const username = users[Math.floor(Math.random() * users.length)];
  const token = login(username);
  if (!token) return;

  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };

  // Rapid-fire requests simulating burst
  http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders);
  http.get(`${BASE_URL}/api/v1/exchange-rates`, authHeaders);

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

      http.get(`${BASE_URL}/api/v1/transactions?accountId=${accounts[0].id}`, authHeaders);
    }
  }

  sleep(0.2);
}
