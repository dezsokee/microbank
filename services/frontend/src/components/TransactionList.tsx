import CopyButton from './CopyButton';

interface Transaction {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  originalAmount?: number;
  originalCurrency?: string;
  exchangeRate?: number;
}

interface Props {
  transactions: Transaction[];
  currentAccountId?: string;
}

const statusStyles: Record<string, string> = {
  COMPLETED: 'bg-green-50 text-green-700',
  FAILED: 'bg-red-50 text-red-700',
  REJECTED: 'bg-red-50 text-red-700',
  PENDING: 'bg-yellow-50 text-yellow-700',
  PROCESSING: 'bg-blue-50 text-blue-700',
  FRAUD_CHECKED: 'bg-blue-50 text-blue-700',
};

export default function TransactionList({ transactions, currentAccountId }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-10 text-gray-400 text-sm">
        No transactions found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-100">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Date</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">From</th>
            <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">To</th>
            <th className="px-6 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Amount</th>
            <th className="px-6 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {transactions.map((tx) => {
            const isOutgoing = currentAccountId && tx.fromAccountId === currentAccountId;
            return (
              <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(tx.createdAt).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <CopyButton text={tx.fromAccountId} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <CopyButton text={tx.toAccountId} />
                </td>
                <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-semibold ${
                  isOutgoing ? 'text-red-600' : 'text-green-600'
                }`}>
                  {isOutgoing ? '−' : '+'}{tx.amount.toFixed(2)} {tx.currency}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <span className={`inline-flex px-2.5 py-0.5 text-xs font-semibold rounded-full ${statusStyles[tx.status] || 'bg-gray-100 text-gray-600'}`}>
                    {tx.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
