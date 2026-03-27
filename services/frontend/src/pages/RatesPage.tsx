import { useState, useEffect } from 'react';
import { api } from '../api/client';

const currencySymbols: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', HUF: 'Ft', RON: 'lei', CHF: 'Fr', JPY: '¥',
};

const currencyNames: Record<string, string> = {
  EUR: 'Euro', USD: 'US Dollar', GBP: 'British Pound', HUF: 'Hungarian Forint',
  RON: 'Romanian Leu', CHF: 'Swiss Franc', JPY: 'Japanese Yen',
};

export default function RatesPage() {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [base, setBase] = useState('EUR');
  const [timestamp, setTimestamp] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [convertFrom, setConvertFrom] = useState('EUR');
  const [convertTo, setConvertTo] = useState('USD');
  const [convertAmount, setConvertAmount] = useState('100');
  const [convertResult, setConvertResult] = useState<number | null>(null);

  const fetchRates = async () => {
    try {
      setLoading(true);
      const data = await api.getRates();
      // API returns { base: "EUR", rates: { USD: 1.08, ... }, timestamp: "..." }
      if (data.rates && typeof data.rates === 'object' && !Array.isArray(data.rates)) {
        setRates(data.rates);
        setBase(data.base || 'EUR');
        setTimestamp(data.timestamp || '');
      } else if (Array.isArray(data)) {
        // fallback for array format
        const rateMap: Record<string, number> = {};
        data.forEach((r: any) => { rateMap[r.toCurrency || r.currency] = r.rate; });
        setRates(rateMap);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRates(); }, []);

  const handleConvert = () => {
    const amt = parseFloat(convertAmount);
    if (isNaN(amt)) return;

    const fromRate = convertFrom === base ? 1 : rates[convertFrom];
    const toRate = convertTo === base ? 1 : rates[convertTo];

    if (fromRate && toRate) {
      const eurAmount = amt / fromRate;
      setConvertResult(eurAmount * toRate);
    }
  };

  useEffect(() => { handleConvert(); }, [convertFrom, convertTo, convertAmount, rates]);

  const allCurrencies = [base, ...Object.keys(rates)].filter((v, i, a) => a.indexOf(v) === i);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Exchange Rates</h1>
          <p className="text-gray-500 text-sm mt-1">
            Base: {base} · {timestamp ? `Updated: ${new Date(timestamp).toLocaleString()}` : 'Live rates with ±0.5% fluctuation'}
          </p>
        </div>
        <button
          onClick={fetchRates}
          className="text-indigo-600 hover:text-indigo-800 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-all"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Quick converter */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Currency Converter</h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
            <input
              type="number"
              value={convertAmount}
              onChange={(e) => setConvertAmount(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 text-sm"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <select
              value={convertFrom}
              onChange={(e) => setConvertFrom(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 text-sm"
            >
              {allCurrencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-center py-2">
            <span className="text-gray-300 text-lg">→</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <select
              value={convertTo}
              onChange={(e) => setConvertTo(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-gray-50 text-sm"
            >
              {allCurrencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          {convertResult !== null && (
            <div className="bg-indigo-50 rounded-xl px-5 py-3 text-center sm:text-left">
              <p className="text-xs text-indigo-400 font-medium">Result</p>
              <p className="text-lg font-bold text-indigo-700">
                {currencySymbols[convertTo] || ''}{convertResult.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Rates table */}
      {Object.keys(rates).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
          No exchange rates available.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-100">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Currency</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">Rate (1 {base} =)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {Object.entries(rates).map(([currency, rate]) => (
                <tr key={currency} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">{currencySymbols[currency] || '¤'}</span>
                      <span className="text-sm font-semibold text-gray-900">{currency}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {currencyNames[currency] || currency}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="text-sm font-mono font-semibold text-gray-900">
                      {rate.toFixed(rate >= 100 ? 2 : 4)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
