'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import DateInput from '../inputs/DateInput.jsx';
import LoadingSpinner from '../LoadingSpinner.jsx';
import ErrorBanner from '../ErrorBanner.jsx';
import { EmptyState, SearchField } from '../ScreenControls.jsx';
import { apiGet } from '../../lib/apiClient.js';
import { isoDateToday } from '../../lib/dates.js';
import { buildConsumptionReport } from '../../lib/admin.js';

const quantity = (value) => value.toLocaleString('en-PH', { maximumFractionDigits: 3 });
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export default function InventoryUsagePanel() {
  const today = isoDateToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const report = useMemo(() => buildConsumptionReport(rows, from, to), [rows, from, to]);
  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? report.items.filter((item) => item.product.toLowerCase().includes(term)) : report.items;
  }, [report.items, search]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const data = await apiGet('inventory.consumption', { from, to });
      if (id !== request.current) return;
      setRows(data.rows || []);
      setReady(true);
    } catch (reason) {
      if (id === request.current) setError(reason.message || 'Unable to load inventory usage.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="section-title">Inventory usage</h2>
        <p className="mt-1 text-sm text-slate-500">See how much of each item was used between two dates.</p>
      </div>
      <div className="md-card grid max-w-lg grid-cols-2 gap-3 p-4">
        <DateInput
          label="From"
          value={from}
          onChange={(value) => {
            if (value) {
              setFrom(value);
              if (value > to) setTo(value);
            }
          }}
        />
        <DateInput
          label="To"
          value={to}
          min={from}
          onChange={(value) => {
            if (value) setTo(value);
          }}
        />
      </div>
      <ErrorBanner message={error} onRetry={!loading ? load : undefined} />
      {loading ? (
        <div className="md-card p-10">
          <LoadingSpinner label="Loading inventory usage…" />
        </div>
      ) : !ready ? (
        <div className="md-card">
          <EmptyState icon={ClipboardList} title="Usage couldn’t be loaded">
            Retry to see this period’s usage.
          </EmptyState>
        </div>
      ) : !report.items.length ? (
        <div className="md-card">
          <EmptyState icon={ClipboardList} title="No usage in this period">
            Choose another date range.
          </EmptyState>
        </div>
      ) : (
        <section className="md-card overflow-hidden">
          <div className="flex flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <div>
              <h3 className="section-title">{plural(report.items.length, 'item')} used</h3>
              <p className="mt-1 text-xs text-slate-500">
                Usage recorded on {report.daysWithUsage} of {plural(report.totalDays, 'day')} in this range.
              </p>
            </div>
            <div className="w-full sm:max-w-xs">
              <SearchField value={search} onChange={setSearch} placeholder="Search items" />
            </div>
          </div>
          {visibleItems.length ? (
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 text-right font-medium">Total used</th>
                    <th className="px-5 py-3 text-right font-medium">Days used</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.product} className="border-t border-slate-100">
                      <td className="px-5 py-3 font-medium text-slate-700">{item.product}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                        {quantity(item.used)} <span className="text-xs text-slate-500">{item.unit}</span>
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-slate-500">{item.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border-t border-slate-100">
              <EmptyState icon={ClipboardList} title="No matching items">
                Try a different search.
              </EmptyState>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
