import http from 'k6/http';

// The auth service stores ONE token per user and overwrites it on every login.
// If several VUs share a user (e.g. 50 VUs over alice/bob/charlie), each login
// invalidates the other VUs' tokens and the run degrades into a 401 cascade that
// never reaches the transaction service. To keep high-VU scenarios valid, every
// VU gets its own dedicated user + funded account, provisioned once in setup().

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const BATCH_SIZE = 20;
const INITIAL_BALANCE = 1000000;

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function params(token, expected = [200, 201]) {
  const headers = token ? { ...JSON_HEADERS, Authorization: `Bearer ${token}` } : JSON_HEADERS;
  return { headers, tags: { phase: 'setup' }, responseCallback: http.expectedStatuses(...expected) };
}

// Registers (or, if already registered, logs in) `count` users named
// k6-vu-1..k6-vu-<count>, ensures each has a funded EUR account, and returns
// [{ username, accountId }] indexed by VU number - 1.
export function provisionUsers(baseUrl, count) {
  const names = Array.from({ length: count }, (_, i) => `k6-vu-${i + 1}`);
  const tokens = {};

  for (const chunk of chunks(names, BATCH_SIZE)) {
    // 409 = user left over from a previous run; not a failure, we just log in instead.
    const reg = http.batch(chunk.map((u) => ['POST', `${baseUrl}/api/v1/auth/register`, JSON.stringify({ username: u }), params(null, [201, 409])]));
    const existing = chunk.filter((u, i) => {
      if (reg[i].status === 201) { tokens[u] = reg[i].json('token'); return false; }
      return true;
    });
    if (existing.length === 0) continue;
    const login = http.batch(existing.map((u) => ['POST', `${baseUrl}/api/v1/auth/login`, JSON.stringify({ username: u }), params()]));
    existing.forEach((u, i) => {
      if (login[i].status !== 200) throw new Error(`setup: login failed for ${u}: ${login[i].status}`);
      tokens[u] = login[i].json('token');
    });
  }

  const accounts = {};
  for (const chunk of chunks(names, BATCH_SIZE)) {
    const mine = http.batch(chunk.map((u) => ['GET', `${baseUrl}/api/v1/accounts/me`, null, params(tokens[u])]));
    const missing = chunk.filter((u, i) => {
      const list = mine[i].status === 200 ? mine[i].json() : [];
      if (list && list.length > 0) { accounts[u] = list[0].id; return false; }
      return true;
    });
    if (missing.length === 0) continue;
    const created = http.batch(missing.map((u) => ['POST', `${baseUrl}/api/v1/accounts`,
      JSON.stringify({ currency: 'EUR', initialBalance: INITIAL_BALANCE }), params(tokens[u])]));
    missing.forEach((u, i) => {
      if (created[i].status !== 200 && created[i].status !== 201) {
        throw new Error(`setup: account creation failed for ${u}: ${created[i].status} ${created[i].body}`);
      }
      accounts[u] = created[i].json('id');
    });
  }

  return names.map((u) => ({ username: u, accountId: accounts[u] }));
}

// The user owned by the current VU, and a different user's account to transfer
// to (so transfers exercise debit + credit on two accounts, not a self-transfer).
export function vuUser(users) {
  return users[(__VU - 1) % users.length];
}

export function transferTarget(users) {
  return users[__VU % users.length].accountId;
}
