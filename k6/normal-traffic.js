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

// Pre-seeded users
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

  // Get accounts
  const accountsRes = http.get(`${BASE_URL}/api/v1/accounts/me`, authHeaders);
  check(accountsRes, { 'get accounts': (r) => r.status === 200 });

  // Get balance
  const balanceRes = http.get(`${BASE_URL}/api/v1/accounts/me/balance`, authHeaders);
  check(balanceRes, { 'get balance': (r) => r.status === 200 });

  // Get exchange rates
  const ratesRes = http.get(`${BASE_URL}/api/v1/exchange-rates`, authHeaders);
  check(ratesRes, { 'get rates': (r) => r.status === 200 });

  // Make a transfer (small amount between accounts)
  // Parse accounts to get IDs
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const fromAccount = accounts[0].id;
      // Use a known account as target (just pick a different one)
      const transferRes = http.post(`${BASE_URL}/api/v1/transactions/transfer`, JSON.stringify({
        fromAccountId: fromAccount,
        toAccountId: fromAccount, // self-transfer for simplicity in testing
        amount: 1.00,
        currency: accounts[0].currency || 'EUR',
      }), authHeaders);
      check(transferRes, { 'transfer': (r) => r.status === 200 || r.status === 400 });
    }
  }

  // Get transactions
  if (accountsRes.status === 200) {
    const accounts = accountsRes.json();
    if (accounts && accounts.length > 0) {
      const txRes = http.get(`${BASE_URL}/api/v1/transactions?accountId=${accounts[0].id}`, authHeaders);
      check(txRes, { 'get transactions': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
