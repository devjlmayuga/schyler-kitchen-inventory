'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardCopy,
  History,
  ReceiptText,
  Trash2,
  Wallet,
} from 'lucide-react';
import CustomAmountEntries from '../components/CustomAmountEntries.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import { ActionMenu, EmptyState } from '../components/ScreenControls.jsx';
import { apiGet, apiPost } from '../lib/apiClient.js';
import { isoDateToday } from '../lib/dates.js';
import { parseMoney } from '../lib/money.js';
import {
  groupProductSalesByCategory,
  ledgerTotals,
  peso,
  readAmountMap,
  readCustomEntries,
} from '../lib/sales.js';
import useUnsavedChanges from '../lib/useUnsavedChanges.js';

const DEFAULT_CONFIG = {
  expenseBreakdown: [
    { key: 'Breakdown_Allow', label: 'Allow' },
    { key: 'Breakdown_Ipon', label: 'Ipon' },
    { key: 'Breakdown_Bill', label: 'Bill' },
    { key: 'Breakdown_Ilaw', label: 'Ilaw' },
  ],
  staff: [],
};

function MoneyField({ label, value, onChange }) {
  return (
    <label className="md-field">
      <span className="md-label">{label}</span>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
        >
          ₱
        </span>
        <input
          aria-label={label}
          className="md-input pl-8 tabular-nums"
          inputMode="decimal"
          type="number"
          min="0"
          step="0.01"
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder="0.00"
        />
      </div>
    </label>
  );
}

function SalesHistory({ onSelectDate }) {
  const [from, setFrom] = useState(isoDateToday());
  const [to, setTo] = useState(isoDateToday());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiGet('salesFinance.list', { from, to })
      .then((data) => {
        if (active) setRows(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch((e) => {
        if (active) setError(e?.message || 'Unable to load sales history.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [from, to]);
  return (
    <section className="md-card p-5">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 className="section-title">Sales history</h2>
          <p className="mt-1 text-sm text-slate-500">Select a day to view its sales.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <DateInput
            label="From"
            value={from}
            onChange={(value) => {
              if (!value) return;
              setFrom(value);
              if (value > to) setTo(value);
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
      </div>
      <ErrorBanner message={error} />
      {loading ? (
        <LoadingSpinner label="Loading history…" />
      ) : (
        !error && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="py-3 font-medium">Date</th>
                  <th className="py-3 text-right font-medium">Sales</th>
                  <th className="py-3 text-right font-medium">Expenses</th>
                  <th className="py-3 text-right font-medium">Cash balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.Date} className="border-b border-slate-100 last:border-0">
                    <td className="py-3">
                      <button
                        className="inline-flex items-center gap-1 font-semibold text-[var(--p-4)] underline-offset-4 hover:underline"
                        onClick={() => onSelectDate(String(row.Date).slice(0, 10))}
                      >
                        {String(row.Date).slice(0, 10)}
                        <ArrowUpRight size={13} />
                      </button>
                    </td>
                    <td className="py-3 text-right tabular-nums">{peso(row.Takoyaki_Sales)}</td>
                    <td className="py-3 text-right tabular-nums">{peso(row.Expenses_Total)}</td>
                    <td className="py-3 text-right tabular-nums">
                      {peso(row.Remaining_Balance ?? row.Final_Total_Cash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="py-8 text-center text-sm text-slate-500">No sales saved for this date range.</p>
            )}
          </div>
        )
      )}
    </section>
  );
}

export default function SalesPage() {
  const [date, setDate] = useState(isoDateToday());
  const [row, setRow] = useState({});
  const [savedRow, setSavedRow] = useState('{}');
  const [orderCount, setOrderCount] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [products, setProducts] = useState([]);
  const [expenseDraft, setExpenseDraft] = useState({ description: '', amount: '' });
  const pendingEntry = !!(expenseDraft.description || expenseDraft.amount);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const request = useRef(0);
  const saveLock = useRef(false);
  const dirty = ready && JSON.stringify(row) !== savedRow;
  const canDiscard = useUnsavedChanges(dirty || pendingEntry);
  const busy = loading || saving;
  const fields = config.expenseBreakdown;
  const totals = ledgerTotals(row, fields);
  const staffAmounts = readAmountMap(row.Staff_Expenses_JSON);
  const sold = readAmountMap(row.Product_Sales_JSON);
  const salesByCategory = groupProductSalesByCategory(sold, products);
  const customSales = readCustomEntries(row.Custom_Sales_JSON);
  const customExpenses = readCustomEntries(row.Custom_Expenses_JSON);
  const staffNames = [...new Set([...(config.staff || []), ...Object.keys(staffAmounts)])];
  const hasOtherExpenses = fields.some((field) => /other/i.test(`${field.key} ${field.label}`));

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
    setConflict(false);
    try {
      const data = await apiGet('sales.bootstrap', { date });
      if (id !== request.current) return;
      const next = data.row || {};
      // Validate saved maps before allowing edits so unreadable history cannot be overwritten.
      readAmountMap(next.Product_Sales_JSON);
      readAmountMap(next.Staff_Expenses_JSON);
      readCustomEntries(next.Custom_Sales_JSON);
      readCustomEntries(next.Custom_Expenses_JSON);
      setRow(next);
      setSavedRow(JSON.stringify(next));
      setExpenseDraft({ description: '', amount: '' });
      setOrderCount(data.orderCount || 0);
      setConfig({
        expenseBreakdown: data.config?.expenseBreakdown?.length
          ? data.config.expenseBreakdown
          : DEFAULT_CONFIG.expenseBreakdown,
        staff: Array.isArray(data.config?.staff) ? data.config.staff : [],
      });
      setProducts(Array.isArray(data.products) ? data.products : []);
      setReady(true);
    } catch (e) {
      if (id === request.current) setError(e?.message || 'Unable to load sales. Please try again.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  function changeDate(value) {
    if (!value || value === date || !canDiscard()) return;
    setSuccess('');
    setDate(value);
  }

  function changeField(key, value) {
    setSuccess('');
    setRow((previous) => ({ ...previous, [key]: value }));
  }

  function validateLedger(next) {
    const keys = ['Takoyaki_Sales', 'Previous_Cash_Added', ...fields.map((field) => field.key)];
    for (const key of keys) {
      const amount = Number(String(next[key] || 0).replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount < 0)
        throw new Error('Enter valid amounts of 0 or more in the daily summary.');
    }
    for (const quantity of Object.values(readAmountMap(next.Product_Sales_JSON))) {
      if (quantity < 0) throw new Error('Recorded product quantities must be 0 or more.');
    }
    for (const amount of Object.values(readAmountMap(next.Staff_Expenses_JSON))) {
      if (amount < 0) throw new Error('Staff payouts must be 0 or more.');
    }
  }

  async function persist() {
    if (!ready || busy || pendingEntry || saveLock.current || conflict) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      validateLedger(row);
      const result = await apiPost('salesFinance.upsertByDate', { date, row });
      const next = { ...row, ...(result.saved?.revision ? { Revision: result.saved.revision } : {}) };
      setRow(next);
      setSavedRow(JSON.stringify(next));
      setSuccess('Daily summary saved.');
    } catch (reason) {
      setConflict(reason.code === 'SALES_CONFLICT');
      setError(reason.message || 'Unable to save. Your changes are still here.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function deleteDay() {
    if (
      !window.confirm(
        `Delete sales for ${date}? This cannot be undone. Unsaved changes will also be discarded.`,
      )
    )
      return;
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await apiPost('salesFinance.deleteByDate', { date });
      await load();
      setSuccess('Daily sales deleted.');
    } catch (e) {
      setError(e?.message || 'Unable to delete daily sales.');
    } finally {
      setSaving(false);
    }
  }

  async function copySummary() {
    const productLines = salesByCategory.flatMap((group) => [
      `${group.category} products (${group.quantity} sold)`,
      ...group.items.map((item) => `  ${item.name} × ${item.qty}`),
    ]);
    const text = [
      `Sales summary · ${date}`,
      ...salesByCategory.map((group) => `${group.category} Sales: ${peso(group.amount)}`),
      `Total Sales: ${peso(totals.sales)}`,
      '',
      ...(productLines.length ? ['Product sales by category', ...productLines] : []),
      '',
      ...customSales.map((entry) => `${entry.description}: ${peso(entry.amount)}`),
      ...customExpenses.map((entry) => `Other expense · ${entry.description}: ${peso(entry.amount)}`),
      ...fields
        .filter((field) => parseMoney(row[field.key]))
        .map((field) => `${field.label}: ${peso(row[field.key])}`),
      ...Object.entries(staffAmounts)
        .filter(([, amount]) => amount)
        .map(([name, amount]) => `${name}: ${peso(amount)}`),
      ...(row.Other_Expenses_Remark ? [`Other expenses: ${row.Other_Expenses_Remark}`] : []),
      `Expenses: ${peso(totals.expenses)}`,
      `Added cash: ${peso(totals.addedCash)}`,
      ...(totals.payouts ? [`Other payouts: ${peso(totals.payouts)}`] : []),
      `Cash balance: ${peso(totals.cash)}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setSuccess('Daily summary copied.');
    } catch {
      setError('Unable to copy. Please allow clipboard access and try again.');
    }
  }

  return (
    <div className="workspace-page">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Sales</h1>
          <p className="page-subtitle">Daily sales, expenses and cash balance.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 sm:w-44">
            <DateInput label="Sales date" value={date} onChange={changeDate} disabled={busy} />
          </div>
          <ActionMenu disabled={busy || !ready}>
            <button className="action-menu-item" disabled={busy || !ready} onClick={copySummary}>
              <ClipboardCopy size={16} /> Copy daily summary
            </button>
            <button
              className="action-menu-item"
              disabled={busy}
              onClick={() => setShowHistory((value) => !value)}
            >
              <History size={16} />
              {showHistory ? 'Hide sales history' : 'Sales history'}
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              className="action-menu-item text-red-700"
              disabled={busy || !ready || orderCount > 0}
              onClick={deleteDay}
            >
              <Trash2 size={16} />
              Delete day
            </button>
          </ActionMenu>
        </div>
      </header>

      <ErrorBanner
        message={error}
        onRetry={
          !ready && !loading
            ? load
            : conflict
              ? () => {
                  if (canDiscard()) load();
                }
              : undefined
        }
      />
      {success && (
        <div role="status" className="notice-success">
          <Check size={16} />
          {success}
        </div>
      )}
      {loading ? (
        <div className="md-card p-10">
          <LoadingSpinner label="Loading sales…" />
        </div>
      ) : !ready ? (
        <div className="md-card">
          <EmptyState icon={ReceiptText} title="Sales couldn’t be loaded">
            Use Retry above to load this day before recording a sale.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {[
              ['Day’s sales', totals.sales],
              ['Expenses', totals.expenses],
              ['Cash balance', totals.cash],
            ].map(([label, value], index) => (
              <div key={label} className="min-w-0 border-r border-slate-100 px-3 py-4 last:border-0 sm:px-5">
                <div className="text-xs text-slate-500">{label}</div>
                <div
                  className={`mt-1.5 break-words text-base font-semibold tracking-tight tabular-nums sm:text-2xl ${index === 0 ? 'text-[var(--p-4)]' : 'text-slate-800'}`}
                >
                  {peso(value)}
                </div>
              </div>
            ))}
          </div>

          <Link href="/pos" className="md-card flex items-center justify-between gap-3 p-5 text-sm">
            <span>
              <strong className="block text-slate-800">Take orders in POS</strong>
              <span className="mt-1 block text-xs text-slate-500">
                Completed orders automatically update this daily summary.
              </span>
            </span>
            <span className="md-btn md-btn-primary shrink-0">
              Open POS <ArrowUpRight size={16} />
            </span>
          </Link>
          <>
            <fieldset disabled={busy} className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
              <section className="md-card p-5">
                <div className="mb-5 flex items-center gap-2">
                  <Wallet size={18} className="text-[var(--p-3)]" />
                  <h2 className="section-title">Expenses & cash</h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {fields.map((field) => (
                    <MoneyField
                      key={field.key}
                      label={field.label || field.key}
                      value={row[field.key]}
                      onChange={(value) => changeField(field.key, value)}
                    />
                  ))}
                </div>
                {hasOtherExpenses && (
                  <label className="md-field mt-4">
                    <span className="md-label">Other expense notes</span>
                    <input
                      className="md-input"
                      value={row.Other_Expenses_Remark || ''}
                      onChange={(event) => changeField('Other_Expenses_Remark', event.target.value)}
                      placeholder="What was this expense for?"
                    />
                  </label>
                )}
                <div className="mt-6 border-t border-slate-100 pt-5">
                  <CustomAmountEntries
                    title="Other expense"
                    example="e.g. Delivery fee"
                    entries={customExpenses}
                    onChange={(entries) => changeField('Custom_Expenses_JSON', JSON.stringify(entries))}
                    draft={expenseDraft}
                    onDraftChange={setExpenseDraft}
                    onError={setError}
                    disabled={busy}
                  />
                </div>
                {!!staffNames.length && (
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <h3 className="mb-3 text-sm font-semibold text-slate-700">Staff payouts</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {staffNames.map((name) => (
                        <MoneyField
                          key={name}
                          label={name}
                          value={staffAmounts[name] || ''}
                          onChange={(value) =>
                            changeField(
                              'Staff_Expenses_JSON',
                              JSON.stringify({ ...staffAmounts, [name]: value }),
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-6 border-t border-slate-100 pt-5">
                  <MoneyField
                    label="Cash carried over / added"
                    value={row.Previous_Cash_Added}
                    onChange={(value) => changeField('Previous_Cash_Added', value)}
                  />
                </div>
              </section>
              <section className="md-card overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="section-title">Day’s sales</h2>
                  <p className="mt-1 text-xs text-slate-500">All products recorded for {date}.</p>
                </div>
                {salesByCategory.length || customSales.length ? (
                  <div className="divide-y divide-slate-100 px-5">
                    {salesByCategory.map((group) => (
                      <section key={group.category} className="py-3">
                        <div className="mb-1 flex items-center justify-between gap-3">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {group.category}
                          </h3>
                          <span className="text-xs tabular-nums text-slate-400">
                            {group.quantity} sold
                          </span>
                        </div>
                        {group.items.map(({ name, qty }) => (
                          <div key={name} className="flex items-center justify-between gap-3 py-2 text-sm">
                            <span className="font-medium text-slate-700">{name}</span>
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-600">
                              × {qty}
                            </span>
                          </div>
                        ))}
                      </section>
                    ))}
                    {customSales.map((entry, index) => (
                      <div
                        key={`custom-${index}`}
                        className="flex items-center justify-between gap-3 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="break-words font-medium text-slate-700">{entry.description}</p>
                          <p className="text-xs text-slate-400">Custom sale</p>
                        </div>
                        <span className="shrink-0 tabular-nums">{peso(entry.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={ReceiptText}
                    title={totals.sales ? 'Sales total recorded' : 'No sales recorded yet'}
                  >
                    {totals.sales
                      ? 'This day has a sales amount without product quantities.'
                      : 'Record your first sale in POS.'}
                  </EmptyState>
                )}
                <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-5 text-sm">
                  {salesByCategory.map((group) => (
                    <div key={group.category} className="flex justify-between">
                      <span className="text-slate-500">{group.category} Sales</span>
                      <span className="font-medium tabular-nums">{peso(group.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span className="font-medium text-slate-700">Total Sales</span>
                    <span className="font-semibold tabular-nums">{peso(totals.sales)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Expenses</span>
                    <span className="font-medium tabular-nums">− {peso(totals.expenses)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Added cash</span>
                    <span className="font-medium tabular-nums">+ {peso(totals.addedCash)}</span>
                  </div>
                  {totals.payouts > 0 && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Other payouts</span>
                      <span>− {peso(totals.payouts)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-3 font-semibold">
                    <span>Cash balance</span>
                    <span className="tabular-nums">{peso(totals.cash)}</span>
                  </div>
                </div>
                {orderCount > 0 ? (
                  <div className="space-y-3 border-t border-slate-100 p-5">
                    <p className="text-xs text-slate-500">
                      Includes {orderCount} saved POS orders. Correct an order to update this day’s totals.
                    </p>
                    <Link className="md-btn md-btn-outline" href={`/pos?view=history&date=${date}`}>
                      Edit sales / orders <ArrowUpRight size={16} />
                    </Link>
                  </div>
                ) : (
                  <details className="border-t border-slate-100 p-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-slate-500">
                      Adjust recorded sales
                      <ChevronDown size={14} />
                    </summary>
                    <div className="mt-4 space-y-4">
                      <p className="text-xs leading-relaxed text-slate-500">
                        Correct the day’s quantities or enter a total for sales taken outside this app. These
                        fields are saved together.
                      </p>
                      {Object.entries(sold).map(([name, qty]) => (
                        <label key={name} className="flex items-center justify-between gap-3 text-sm">
                          <span>{name}</span>
                          <input
                            className="stock-input max-w-20"
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            aria-label={`${name} daily quantity`}
                            value={qty}
                            onChange={(event) =>
                              changeField(
                                'Product_Sales_JSON',
                                JSON.stringify({ ...sold, [name]: event.target.value }),
                              )
                            }
                          />
                        </label>
                      ))}
                      <MoneyField
                        label="Sales total"
                        value={row.Takoyaki_Sales}
                        onChange={(value) => changeField('Takoyaki_Sales', value)}
                      />
                      <p className="text-xs text-slate-500">
                        When correcting quantities, update the sales total to match.
                      </p>
                    </div>
                  </details>
                )}
              </section>
            </fieldset>
            <div className="save-bar">
              <span className="flex items-center gap-2 text-sm text-slate-500">
                {pendingEntry ? (
                  'Add or clear the new expense entry'
                ) : dirty ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-[var(--p-3)]" />
                    Unsaved changes
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Daily summary up to date
                  </>
                )}
              </span>
              <button
                className="md-btn md-btn-primary min-h-11 shrink-0"
                disabled={busy || !dirty || pendingEntry || conflict}
                onClick={persist}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        </>
      )}
      {showHistory && (
        <SalesHistory
          onSelectDate={(value) => {
            changeDate(value);
          }}
        />
      )}
    </div>
  );
}
