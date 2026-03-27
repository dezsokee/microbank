import { useState, useEffect } from 'react';
import { api } from '../api/client';
import CopyButton from '../components/CopyButton';

interface Account {
  id: string;
  currency: string;
  balance: number;
}

const currencySymbols: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', HUF: 'Ft', RON: 'lei', CHF: 'Fr', JPY: '¥',
};

export default function TransferPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingAccounts, setFetchingAccounts] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<any>(null);

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const accs = await api.getAccounts();
        const accountList = Array.isArray(accs) ? accs : accs.accounts || [];
        setAccounts(accountList);
        if (accountList.length > 0) {
          setFromAccountId(accountList[0].id);
          setCurrency(accountList[0].currency);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setFetchingAccounts(false);
      }
    };
    fetchAccounts();
  }, []);

  const selectedAccount = accounts.find((a) => a.id === fromAccountId);

  const handleFromChange = (id: string) => {
    setFromAccountId(id);
    const acc = accounts.find((a) => a.id === id);
    if (acc) setCurrency(acc.currency);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(null);

    if (!fromAccountId || !toAccountId || !amount || !currency) {
      setError('All fields are required');
      return;
    }

    if (fromAccountId === toAccountId) {
      setError('Cannot transfer to the same account');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Amount must be a positive number');
      return;
    }

    if (selectedAccount && numAmount > selectedAccount.balance) {
      setError(`Insufficient balance. Available: ${selectedAccount.balance.toFixed(2)} ${selectedAccount.currency}`);
      return;
    }

    setLoading(true);
    try {
      const result = await api.transfer(fromAccountId, toAccountId, numAmount, currency);
      setSuccess(result);
      setToAccountId('');
      setAmount('');
      // Refresh balances
      const accs = await api.getAccounts();
      const accountList = Array.isArray(accs) ? accs : accs.accounts || [];
      setAccounts(accountList);
    } catch (err: any) {
      setError(err.message || 'Transfer failed');
    } finally {
      setLoading(false);
    }
  };

  if (fetchingAccounts) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Transfer Funds</h1>
        <p className="text-gray-500 text-sm mt-1">Send money between accounts</p>
      </div>

      {/* My Accounts - quick reference */}
      {accounts.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Your Accounts (click ID to copy)
          </h3>
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                <div className="flex items-center space-x-3">
                  <span className="text-sm font-semibold text-gray-900 w-10">{acc.currency}</span>
                  <span className="text-sm text-gray-500">
                    {currencySymbols[acc.currency]}{acc.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <CopyButton text={acc.id} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transfer form */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {error && (
          <div className="bg-red-50 border-b border-red-100 text-red-600 px-6 py-3 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border-b border-green-100 px-6 py-4">
            <div className="flex items-center space-x-2">
              <span className="text-green-600 text-lg">✓</span>
              <div>
                <p className="text-green-800 font-semibold text-sm">Transfer completed!</p>
                <p className="text-green-600 text-xs mt-0.5">
                  {success.amount} {success.currency} sent · Status: {success.status}
                </p>
              </div>
            </div>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500">You need at least one account to make a transfer.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* From Account */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">From Account</label>
              <select
                value={fromAccountId}
                onChange={(e) => handleFromChange(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-gray-50 text-sm"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.currency} · {currencySymbols[acc.currency]}{acc.balance.toFixed(2)} · {acc.id}
                  </option>
                ))}
              </select>
              {selectedAccount && (
                <p className="mt-1.5 text-xs text-gray-400">
                  Available: <span className="font-semibold text-gray-600">{currencySymbols[selectedAccount.currency]}{selectedAccount.balance.toFixed(2)}</span>
                </p>
              )}
            </div>

            {/* To Account */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Recipient Account ID</label>
              <input
                type="text"
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-gray-50 text-sm font-mono"
                placeholder="Paste recipient account UUID"
              />
            </div>

            {/* Amount and Currency */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Amount</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  min="0.01"
                  step="0.01"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-gray-50 text-sm"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none bg-gray-50 text-sm"
                >
                  {['EUR', 'USD', 'GBP', 'HUF', 'RON', 'CHF', 'JPY'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white py-3 px-4 rounded-xl font-semibold hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? 'Processing...' : 'Send Transfer'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
