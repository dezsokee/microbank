const API_BASE = '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Request failed');
  }
  return res.json();
}

export const api = {
  login: (username: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username }) }),
  register: (username: string) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username }) }),
  getAccounts: () => request('/accounts/me'),
  getBalance: () => request('/accounts/me/balance'),
  createAccount: (currency: string, initialBalance: number) =>
    request('/accounts', { method: 'POST', body: JSON.stringify({ currency, initialBalance }) }),
  transfer: (fromAccountId: string, toAccountId: string, amount: number, currency: string) =>
    request('/transactions/transfer', {
      method: 'POST',
      body: JSON.stringify({ fromAccountId, toAccountId, amount, currency }),
    }),
  getTransactions: (accountId: string) => request(`/transactions?accountId=${accountId}`),
  getRates: () => request('/exchange-rates'),
};
