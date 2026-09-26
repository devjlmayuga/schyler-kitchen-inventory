'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronDown, UtensilsCrossed } from 'lucide-react';
import DateInput from '../inputs/DateInput.jsx';
import LoadingSpinner from '../LoadingSpinner.jsx';
import ErrorBanner from '../ErrorBanner.jsx';
import { EmptyState } from '../ScreenControls.jsx';
import { apiGet } from '../../lib/apiClient.js';
import { isoDateToday } from '../../lib/dates.js';
import { peso } from '../../lib/sales.js';
import { addDays, buildReport } from '../../lib/admin.js';

const labelFor = (date) =>
  new Date(`${date.length === 7 ? `${date}-01` : date}T00:00:00Z`).toLocaleDateString('en-PH', {
    timeZone: 'UTC',
    month: 'short',
    ...(date.length === 7 ? { year: '2-digit' } : { day: 'numeric' }),
  });

function ComparisonChart({ points, monthly }) {
  const max = Math.max(1, ...points.flatMap((point) => [point.sales, point.expenses]));
  const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
  const ceiling = Math.ceil(max / step) * step;
  const axisLabel = (value) =>
    `₱${new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
  return (
    <div className="mt-6 grid grid-cols-[40px_minmax(0,1fr)] gap-2">
      <div
        className="flex h-48 flex-col justify-between text-right text-[10px] text-slate-400"
        aria-hidden="true"
      >
        {[ceiling, ceiling / 2, 0].map((value) => (
          <span key={value}>{axisLabel(value)}</span>
        ))}
      </div>
      <div
        className="overflow-x-auto pb-2"
        tabIndex={0}
        aria-label={`${monthly ? 'Monthly' : 'Daily'} sales and expenses chart`}
      >
        <div
          className="relative flex min-w-full gap-3"
          style={{ minWidth: Math.max(220, points.length * 36) }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 flex h-48 flex-col justify-between"
            aria-hidden="true"
          >
            {[0, 1, 2].map((line) => (
              <div key={line} className="border-t border-slate-100" />
            ))}
          </div>
          {points.map((point, index) => (
            <div
              key={point.date}
              className="relative flex min-w-0 flex-1 flex-col"
              title={`${labelFor(point.date)}: sales ${peso(point.sales)}, expenses ${peso(point.expenses)}`}
            >
              <div className="flex h-48 items-end justify-center gap-1">
                <span
                  className="w-full max-w-6 rounded-t bg-[var(--p-3)]"
                  style={{
                    height: `${(Math.max(0, point.sales) / ceiling) * 100}%`,
                    minHeight: point.sales > 0 ? 2 : 0,
                  }}
                />
                <span
                  className="w-full max-w-6 rounded-t bg-[var(--p-1)]"
                  style={{
                    height: `${(Math.max(0, point.expenses) / ceiling) * 100}%`,
                    minHeight: point.expenses > 0 ? 2 : 0,
                  }}
                />
              </div>
              <span className="mt-3 h-8 text-center text-[10px] text-slate-500">
                {points.length < 15 ||
                index % Math.ceil(points.length / 10) === 0 ||
                index === points.length - 1
                  ? labelFor(point.date)
                  : ''}
              </span>
              <span className="sr-only">
                {labelFor(point.date)}: sales {peso(point.sales)}, expenses {peso(point.expenses)}.
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ReportsPanel() {
  const today = isoDateToday();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [preset, setPreset] = useState('7');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const report = useMemo(() => buildReport(rows, from, to), [rows, from, to]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const data = await apiGet('salesFinance.list', { from, to });
      if (id !== request.current) return;
      setRows(data.rows || []);
      setReady(true);
    } catch (reason) {
      if (id === request.current) setError(reason.message || 'Unable to load the report.');
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
  function selectPreset(value) {
    setPreset(value);
    if (value !== 'custom') {
      setTo(today);
      setFrom(addDays(today, -(Number(value) - 1)));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="section-title">Sales overview</h2>
          <p className="mt-1 text-sm text-slate-500">See how the kitchen is doing at a glance.</p>
        </div>
        <div className="segmented-control self-start" aria-label="Report period">
          {[
            ['7', 'Last 7 days'],
            ['30', 'Last 30 days'],
            ['custom', 'Custom'],
          ].map(([value, label]) => (
            <button
              key={value}
              className="segment"
              aria-pressed={preset === value}
              onClick={() => selectPreset(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {preset === 'custom' ? (
        <div className="md-card grid max-w-lg grid-cols-2 gap-3 p-4">
          <DateInput
            label="Report from"
            value={from}
            onChange={(value) => {
              if (value) {
                setFrom(value);
                if (value > to) setTo(value);
              }
            }}
          />
          <DateInput
            label="Report to"
            value={to}
            min={from}
            onChange={(value) => {
              if (value) setTo(value);
            }}
          />
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          {labelFor(from)} – {labelFor(to)}, {to.slice(0, 4)}
        </p>
      )}
      <ErrorBanner message={error} onRetry={!loading ? load : undefined} />
      {loading ? (
        <div className="md-card p-10">
          <LoadingSpinner label="Loading sales overview…" />
        </div>
      ) : !ready ? (
        <div className="md-card">
          <EmptyState icon={BarChart3} title="Report couldn’t be loaded">
            Retry to see this period’s totals.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Sales', report.totals.sales, 'Recorded sales'],
              ['Expenses', report.totals.expenses, 'Including staff payouts'],
              ['After expenses', report.totals.net, 'Sales minus expenses'],
            ].map(([label, amount, hint], index) => (
              <div
                key={label}
                className={`md-card px-5 py-5 ${index === 0 ? 'border-[var(--p-1)] bg-[#fffafb]' : ''}`}
              >
                <div className="text-xs font-medium text-slate-500">{label}</div>
                <div
                  className={`mt-2 break-words text-2xl font-semibold tracking-tight tabular-nums ${index === 0 || amount < 0 ? 'text-[var(--p-4)]' : 'text-slate-900'}`}
                >
                  {peso(amount)}
                </div>
                <p className="mt-2 text-xs text-slate-400">{hint}</p>
              </div>
            ))}
          </div>
          {!report.daily.length ? (
            <div className="md-card">
              <EmptyState icon={BarChart3} title="No sales in this period">
                Choose another date range or record your first sale.
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <section className="md-card min-w-0 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="section-title">Sales & expenses</h3>
                    <div className="flex gap-3 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm bg-[var(--p-3)]" />
                        Sales
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm bg-[var(--p-1)]" />
                        Expenses
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {report.monthly ? 'Monthly totals for this period.' : 'Daily totals for this period.'}
                  </p>
                  <ComparisonChart points={report.chart} monthly={report.monthly} />
                </section>
                <section className="md-card min-w-0 p-5">
                  <h3 className="section-title">Top products</h3>
                  <p className="mt-1 text-xs text-slate-500">Ranked by quantity sold.</p>
                  {report.products.length ? (
                    <ol className="mt-5 space-y-5">
                      {report.products.slice(0, 5).map((item, index) => (
                        <li key={item.name}>
                          <div className="mb-2 flex items-start gap-2 text-sm">
                            <span className="text-xs text-slate-400">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span className="min-w-0 flex-1 font-medium text-slate-700">{item.name}</span>
                            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                              {item.qty}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-[var(--p-2)]"
                              style={{ width: `${(item.qty / report.products[0].qty) * 100}%` }}
                            />
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <EmptyState icon={UtensilsCrossed} title="No product breakdown">
                      This period has sales totals without product quantities.
                    </EmptyState>
                  )}
                </section>
              </div>
              <details className="md-card overflow-hidden">
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <span className="section-title">Daily breakdown</span>
                    <span className="ml-2 text-xs text-slate-400">{report.daily.length} recorded days</span>
                  </div>
                  <ChevronDown size={17} className="text-slate-400" />
                </summary>
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 text-right font-medium">Sales</th>
                        <th className="px-4 py-3 text-right font-medium">Expenses</th>
                        <th className="px-5 py-3 text-right font-medium">After expenses</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.daily.map((day) => (
                        <tr key={day.date} className="border-t border-slate-100">
                          <td className="px-5 py-3 text-slate-600">{day.date}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{peso(day.sales)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{peso(day.expenses)}</td>
                          <td
                            className={`px-5 py-3 text-right tabular-nums ${day.net < 0 ? 'text-[var(--p-4)]' : ''}`}
                          >
                            {peso(day.net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              {report.products.length > 5 && (
                <details className="md-card">
                  <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between px-5 py-4">
                    <span className="section-title">All product quantities</span>
                    <ChevronDown size={17} className="text-slate-400" />
                  </summary>
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {report.products.map((item) => (
                      <li key={item.name} className="flex justify-between gap-3 px-5 py-3 text-sm">
                        <span>{item.name}</span>
                        <span className="tabular-nums text-slate-500">{item.qty}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
