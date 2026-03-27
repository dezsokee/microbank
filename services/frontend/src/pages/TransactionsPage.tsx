import { useState, useEffect } from 'react';
import { api } from '../api/client';
import TransactionList from '../components/TransactionList';
import CopyButton from '../components/CopyButton';

interface Account {
  id: string;
  currency: string;
  balance: number;
}

const currencySymbols: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', HUF: 'Ft', RON: 'lei', CHF: 'Fr', JPY: '¥',
};

export default function TransactionsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const accs = await api.getAccounts();
        const accountList = Array.isArray(accs) ? accs : accs.accounts || [];
        setAccounts(accountList);
        if (accountList.length > 0) {
          setSelectedAccountId(accountList[0].id);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (!selectedAccountId) return;

    const fetchTransactions = async () => {
      setLoading(true);
      try {
        const txs = await api.getTransactions(selectedAccountId);
        setTransactions(Array.isArray(txs) ? txs : txs.transactions || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTransactions();
  }, [selectedAccountId]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Transaction History</h1>
          <p className="text-gray-500 text-sm mt-1">
            {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} found
          </p>
        </div>

        {accounts.length > 0 && (
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.currency} · {currencySymbols[acc.currency]}{acc.balance.toFixed(2)} · {acc.id.substring(0, 8)}...
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedAccount && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
              <span className="text-indigo-700 font-bold text-sm">{selectedAccount.currency}</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {currencySymbols[selectedAccount.currency]}{selectedAccount.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs text-gray-400">Current balance</p>
            </div>
          </div>
          <CopyButton text={selectedAccount.id} />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          No accounts found. Create an account on the Dashboard first.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <TransactionList
            transactions={transactions}
            currentAccountId={selectedAccountId}
          />
        </div>
      )}
    </div>
  );
}
