import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import CopyButton from '../components/CopyButton';
import TransactionList from '../components/TransactionList';

interface Account {
  id: string;
  userId: string;
  currency: string;
  balance: number;
  status: string;
}

const currencySymbols: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', HUF: 'Ft', RON: 'lei', CHF: 'Fr', JPY: '¥',
};

const currencyColors: Record<string, string> = {
  EUR: 'from-blue-500 to-blue-600',
  USD: 'from-green-500 to-green-600',
  GBP: 'from-purple-500 to-purple-600',
  HUF: 'from-orange-500 to-orange-600',
  RON: 'from-yellow-500 to-yellow-600',
  CHF: 'from-red-500 to-red-600',
  JPY: 'from-pink-500 to-pink-600',
};

export default function DashboardPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newCurrency, setNewCurrency] = useState('USD');
  const [newBalance, setNewBalance] = useState('1000');
  const [creating, setCreating] = useState(false);
  const username = localStorage.getItem('username') || 'User';

  const fetchData = async () => {
    try {
      setLoading(true);
      const accs = await api.getAccounts();
      const accountList = Array.isArray(accs) ? accs : accs.accounts || [];
      setAccounts(accountList);

      if (accountList.length > 0) {
        try {
          const txs = await api.getTransactions(accountList[0].id);
          setTransactions(Array.isArray(txs) ? txs.slice(0, 5) : txs.transactions?.slice(0, 5) || []);
        } catch {
          setTransactions([]);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      await api.createAccount(newCurrency, parseFloat(newBalance) || 0);
      setShowCreate(false);
      setNewBalance('1000');
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const totalBalance = accounts.reduce((sum, a) => {
    if (a.currency === 'EUR') return sum + a.balance;
    if (a.currency === 'USD') return sum + a.balance / 1.08;
    if (a.currency === 'HUF') return sum + a.balance / 395.5;
    if (a.currency === 'GBP') return sum + a.balance / 0.86;
    return sum + a.balance;
  }, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {username}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {accounts.length} account{accounts.length !== 1 ? 's' : ''} ·
            ≈ €{totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/transfer"
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all"
          >
            New Transfer
          </Link>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="bg-white text-gray-700 border border-gray-200 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-all"
          >
            {showCreate ? 'Cancel' : '+ Account'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Create account form */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Create New Account</h2>
          <form onSubmit={handleCreateAccount} className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
              <select
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value)}
                className="px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 text-sm"
              >
                {['EUR', 'USD', 'GBP', 'HUF', 'RON', 'CHF', 'JPY'].map((c) => (
                  <option key={c} value={c}>{c} ({currencySymbols[c] || c})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Initial Balance</label>
              <input
                type="number"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                min="0"
                step="0.01"
                className="px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none w-40 bg-gray-50 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-indigo-700 transition-all disabled:opacity-50 text-sm"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </form>
        </div>
      )}

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="text-4xl mb-3">🏦</div>
          <h3 className="text-lg font-semibold text-gray-900">No accounts yet</h3>
          <p className="text-gray-500 text-sm mt-1">Create your first account to get started.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all"
          >
            Create Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="relative overflow-hidden rounded-xl border border-gray-200 bg-white hover:shadow-md transition-all"
            >
              <div className={`h-1.5 bg-gradient-to-r ${currencyColors[account.currency] || 'from-gray-400 to-gray-500'}`} />
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {account.currency} Account
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    account.status === 'ACTIVE' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {account.status || 'ACTIVE'}
                  </span>
                </div>
                <div className="text-2xl font-bold text-gray-900 mb-1">
                  {currencySymbols[account.currency] || ''}{' '}
                  {account.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <CopyButton text={account.id} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Recent Transactions</h2>
          {transactions.length > 0 && (
            <Link to="/transactions" className="text-indigo-600 text-sm font-medium hover:text-indigo-700">
              View all
            </Link>
          )}
        </div>
        {transactions.length > 0 ? (
          <TransactionList transactions={transactions} currentAccountId={accounts[0]?.id} />
        ) : (
          <div className="py-10 text-center text-gray-400 text-sm">
            No transactions yet. Make your first transfer!
          </div>
        )}
      </div>
    </div>
  );
}
