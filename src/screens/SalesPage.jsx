'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardCopy,
  History,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import CustomAmountEntries from '../components/CustomAmountEntries.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import { ActionMenu, EmptyState, SearchField } from '../components/ScreenControls.jsx';
import { apiGet, apiPost } from '../lib/apiClient.js';
import { isoDateToday } from '../lib/dates.js';
import { parseMoney } from '../lib/money.js';
import {
  appendSale,
  ledgerTotals,
  orderLines,
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
  const [products, setProducts] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [cart, setCart] = useState({});
  const [customOrder, setCustomOrder] = useState([]);
  const [customDraft, setCustomDraft] = useState({ description: '', amount: '' });
  const [expenseDraft, setExpenseDraft] = useState({ description: '', amount: '' });
  const pendingEntry = !!(
    customDraft.description ||
    customDraft.amount ||
    expenseDraft.description ||
    expenseDraft.amount
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState('order');
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const request = useRef(0);
  const saveLock = useRef(false);
  const dirty = ready && JSON.stringify(row) !== savedRow;
  const hasCart = Object.keys(cart).length > 0 || customOrder.length > 0;
  const canDiscard = useUnsavedChanges(dirty || hasCart || pendingEntry);
  const busy = loading || saving;
  const fields = config.expenseBreakdown;
  const totals = ledgerTotals(row, fields);
  const staffAmounts = readAmountMap(row.Staff_Expenses_JSON);
  const sold = readAmountMap(row.Product_Sales_JSON);
  const customSales = readCustomEntries(row.Custom_Sales_JSON);
  const customExpenses = readCustomEntries(row.Custom_Expenses_JSON);
  const staffNames = [...new Set([...(config.staff || []), ...Object.keys(staffAmounts)])];
  const hasOtherExpenses = fields.some((field) => /other/i.test(`${field.key} ${field.label}`));

  const activeProducts = useMemo(
    () =>
      products
        .filter((product) => String(product.Active || 'Y').toUpperCase() !== 'N' && product.Name)
        .map((product) => ({
          ...product,
          Category: String(product.Category || 'Other'),
          Price: parseMoney(product.Price),
        })),
    [products],
  );
  const categories = useMemo(
    () => [...new Set(activeProducts.map((product) => product.Category))],
    [activeProducts],
  );
  const visibleProducts = activeProducts.filter(
    (product) =>
      (!category || product.Category === category) &&
      `${product.Name} ${product.Category}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const draft = useMemo(() => {
    try {
      const lines = orderLines(activeProducts, cart);
      return {
        lines,
        count: lines.reduce((sum, line) => sum + line.qty, customOrder.length),
        total:
          lines.reduce(
            (sum, line) => sum + Math.round(line.lineTotal * 100),
            customOrder.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0),
          ) / 100,
        error: '',
      };
    } catch (e) {
      return { lines: [], count: 0, total: 0, error: e.message };
    }
  }, [activeProducts, cart, customOrder]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
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
      setCart({});
      setCustomOrder([]);
      setCustomDraft({ description: '', amount: '' });
      setExpenseDraft({ description: '', amount: '' });
      setProducts(Array.isArray(data.products) ? data.products : []);
      setConfig({
        expenseBreakdown: data.config?.expenseBreakdown?.length
          ? data.config.expenseBreakdown
          : DEFAULT_CONFIG.expenseBreakdown,
        staff: Array.isArray(data.config?.staff) ? data.config.staff : [],
      });
      setCategory('');
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

  function addProduct(name) {
    setSuccess('');
    setCart((previous) => ({ ...previous, [name]: Math.max(0, Number(previous[name]) || 0) + 1 }));
  }

  function removeProduct(name) {
    setCart((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== name)));
  }

  function setQuantity(name, value) {
    setSuccess('');
    setCart((previous) => ({ ...previous, [name]: value }));
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

  async function persist(includeOrder = false) {
    if (!ready || busy || pendingEntry || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const next = includeOrder ? appendSale(row, activeProducts, cart, customOrder) : row;
      validateLedger(next);
      await apiPost('salesFinance.upsertByDate', { date, row: next });
      setRow(next);
      setSavedRow(JSON.stringify(next));
      if (includeOrder) {
        setCart({});
        setCustomOrder([]);
      }
      setSuccess(
        includeOrder
          ? `${peso(draft.total)} sale recorded. Ready for the next order.`
          : 'Daily summary saved.',
      );
    } catch (e) {
      setError(e?.message || 'Unable to save. Your order and changes are still here.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function deleteDay() {
    if (
      !window.confirm(
        `Delete sales for ${date}? This cannot be undone. Unsaved changes and the current order will also be discarded.`,
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
    const text = [
      `Sales summary · ${date}`,
      `Sales: ${peso(totals.sales)}`,
      '',
      ...Object.entries(sold)
        .filter(([, qty]) => qty)
        .map(([name, qty]) => `${name} × ${qty}`),
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
          <p className="page-subtitle">Good food. Simple order taking.</p>
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
            <button className="action-menu-item text-red-700" disabled={busy || !ready} onClick={deleteDay}>
              <Trash2 size={16} />
              Delete day
            </button>
          </ActionMenu>
        </div>
      </header>

      <ErrorBanner message={error} onRetry={!ready && !loading ? load : undefined} />
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

          <div className="segmented-control w-fit" aria-label="Sales workspace">
            <button className="segment" aria-pressed={view === 'order'} onClick={() => setView('order')}>
              <ShoppingBag size={16} />
              New order
              {hasCart && (
                <span className="segment-count">{Object.keys(cart).length + customOrder.length}</span>
              )}
            </button>
            <button className="segment" aria-pressed={view === 'day'} onClick={() => setView('day')}>
              <ReceiptText size={16} />
              Daily summary
              {dirty && (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--p-3)]" aria-label="Unsaved changes" />
              )}
            </button>
          </div>

          {view === 'order' ? (
            <>
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
                <section className="md-card min-w-0 p-4 sm:p-5" aria-label="Product catalog">
                  <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="section-title">Menu</h2>
                      <p className="mt-1 text-xs text-slate-500">Tap a product to add it to your order.</p>
                    </div>
                    <div className="w-full sm:w-60">
                      <SearchField value={query} onChange={setQuery} placeholder="Search products…" />
                    </div>
                  </div>
                  {!!activeProducts.length && (
                    <div className="mb-5 flex flex-wrap gap-2" aria-label="Product categories">
                      <button
                        className="category-chip"
                        aria-pressed={!category}
                        onClick={() => setCategory('')}
                      >
                        All products
                      </button>
                      {categories.map((name) => (
                        <button
                          key={name}
                          className="category-chip"
                          aria-pressed={category === name}
                          onClick={() => setCategory(name)}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                  {!activeProducts.length ? (
                    <EmptyState icon={UtensilsCrossed} title="Your menu is empty">
                      Add products in Admin or enter a custom sale below.
                    </EmptyState>
                  ) : !visibleProducts.length ? (
                    <EmptyState icon={Search} title="No products found">
                      Try a different name or category.
                    </EmptyState>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-2 min-[1400px]:grid-cols-3">
                      {visibleProducts.map((product) => (
                        <button
                          key={product.Name}
                          type="button"
                          disabled={busy}
                          aria-label={`Add ${product.Name} to order`}
                          onClick={() => addProduct(product.Name)}
                          className={`product-tile ${Number(cart[product.Name]) > 0 ? 'product-tile-selected' : ''}`}
                        >
                          <div className="mb-5 flex w-full items-start justify-between gap-2">
                            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--p-4)]">
                              <UtensilsCrossed size={19} strokeWidth={1.6} />
                            </span>
                            {Number(cart[product.Name]) > 0 ? (
                              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-[var(--p-3)] px-1 text-xs font-semibold text-white">
                                {cart[product.Name]}
                              </span>
                            ) : (
                              <Plus size={17} className="mt-1 text-slate-400" />
                            )}
                          </div>
                          <span className="text-left text-sm font-semibold leading-snug text-slate-800">
                            {product.Name}
                          </span>
                          <span className="mt-1 text-left text-xs text-slate-400">{product.Category}</span>
                          <span className="mt-3 text-sm font-semibold tabular-nums text-[var(--p-4)]">
                            {peso(product.Price)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <CustomAmountEntries
                      title="Custom sale"
                      example="e.g. Barkada mix"
                      entries={[]}
                      onChange={(entries) => {
                        setCustomOrder([...customOrder, ...entries]);
                        setSuccess('');
                      }}
                      draft={customDraft}
                      onDraftChange={setCustomDraft}
                      onError={setError}
                      disabled={busy}
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Enter the total price for an item without a fixed menu price.
                    </p>
                  </div>
                </section>

                <section
                  id="order-basket"
                  tabIndex={-1}
                  className="md-card scroll-mt-24 overflow-hidden xl:sticky xl:top-24"
                  aria-label="Current order"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                    <div className="flex items-center gap-2">
                      <ShoppingBag size={18} className="text-[var(--p-3)]" />
                      <h2 className="section-title">Current order</h2>
                    </div>
                    {hasCart && (
                      <button
                        className="rounded px-2 py-1 text-xs text-slate-500 hover:text-[var(--p-4)]"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm('Clear all items from the current order?')) {
                            setCart({});
                            setCustomOrder([]);
                          }
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {!hasCart ? (
                    <EmptyState icon={ShoppingBag} title="Start with something delicious">
                      Choose products from the menu. Your order will appear here.
                    </EmptyState>
                  ) : (
                    <fieldset disabled={busy} className="min-w-0">
                      <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto px-5">
                        {activeProducts
                          .filter((product) => Object.hasOwn(cart, product.Name))
                          .map((product) => (
                            <div key={product.Name} className="py-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-800">{product.Name}</div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    {peso(product.Price)} each
                                  </div>
                                </div>
                                <button
                                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700"
                                  aria-label={`Remove ${product.Name} from order`}
                                  onClick={() => removeProduct(product.Name)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-2">
                                <div className="quantity-stepper">
                                  <button
                                    aria-label={`Decrease ${product.Name} quantity`}
                                    onClick={() =>
                                      Number(cart[product.Name]) > 1
                                        ? setQuantity(product.Name, Number(cart[product.Name]) - 1)
                                        : removeProduct(product.Name)
                                    }
                                  >
                                    <Minus size={15} />
                                  </button>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min="1"
                                    step="1"
                                    value={cart[product.Name]}
                                    aria-label={`${product.Name} order quantity`}
                                    onFocus={(event) => event.target.select()}
                                    onChange={(event) => setQuantity(product.Name, event.target.value)}
                                  />
                                  <button
                                    aria-label={`Increase ${product.Name} quantity`}
                                    onClick={() => addProduct(product.Name)}
                                  >
                                    <Plus size={15} />
                                  </button>
                                </div>
                                <span className="text-sm font-semibold tabular-nums">
                                  {peso(Math.max(0, Number(cart[product.Name]) || 0) * product.Price)}
                                </span>
                              </div>
                            </div>
                          ))}
                      </div>
                      {customOrder.map((entry, index) => (
                        <div
                          key={`custom-${index}`}
                          className="flex items-center gap-3 border-t border-slate-100 p-5 text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-semibold">{entry.description}</p>
                            <p className="mt-1 text-xs text-slate-500">Custom sale</p>
                          </div>
                          <span className="shrink-0 font-semibold">{peso(entry.amount)}</span>
                          <button
                            className="admin-icon-button shrink-0"
                            aria-label={`Remove ${entry.description} from order`}
                            onClick={() => setCustomOrder(customOrder.filter((_, i) => i !== index))}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </fieldset>
                  )}
                  <div className="border-t border-slate-100 bg-slate-50/60 p-5">
                    {draft.error && (
                      <p role="alert" className="mb-3 text-sm text-red-700">
                        {draft.error}
                      </p>
                    )}
                    <div className="mb-4 flex items-end justify-between gap-3">
                      <span className="text-sm text-slate-500">
                        Order total
                        {draft.count > 0 && (
                          <span className="mt-1 block text-xs">
                            {draft.count} {draft.count === 1 ? 'item' : 'items'}
                          </span>
                        )}
                      </span>
                      <span className="text-2xl font-semibold tracking-tight tabular-nums">
                        {peso(draft.total)}
                      </span>
                    </div>
                    <button
                      className="md-btn md-btn-primary min-h-12 w-full"
                      disabled={busy || !hasCart || !!draft.error || pendingEntry}
                      onClick={() => persist(true)}
                    >
                      <Check size={18} />
                      {saving ? 'Recording…' : 'Record sale'}
                    </button>
                    <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">
                      {pendingEntry
                        ? 'Add or clear the custom sale / expense entry before saving.'
                        : 'Adds this order to the selected day’s sales.'}
                      {dirty && ' Your daily summary changes will also be saved.'}
                    </p>
                  </div>
                </section>
              </div>
              {hasCart && (
                <div className="save-bar xl:hidden">
                  <div>
                    <div className="text-xs text-slate-500">Current order</div>
                    <div className="font-semibold tabular-nums">
                      {draft.error ? 'Check quantities' : `${draft.count} items · ${peso(draft.total)}`}
                    </div>
                  </div>
                  <button
                    className="md-btn md-btn-primary min-h-11"
                    onClick={() => {
                      const basket = document.getElementById('order-basket');
                      basket?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      basket?.focus({ preventScroll: true });
                    }}
                  >
                    Review order <ArrowDown size={16} />
                  </button>
                </div>
              )}
            </>
          ) : (
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
                  {Object.entries(sold).some(([, qty]) => qty > 0) || customSales.length ? (
                    <div className="divide-y divide-slate-100 px-5">
                      {Object.entries(sold)
                        .filter(([, qty]) => qty > 0)
                        .map(([name, qty]) => (
                          <div key={name} className="flex items-center justify-between gap-3 py-3 text-sm">
                            <span className="font-medium text-slate-700">{name}</span>
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-slate-600">
                              × {qty}
                            </span>
                          </div>
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
                        : 'Record your first sale from New order.'}
                    </EmptyState>
                  )}
                  <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Sales</span>
                      <span className="font-medium tabular-nums">{peso(totals.sales)}</span>
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
                </section>
              </fieldset>
              <div className="save-bar">
                <span className="flex items-center gap-2 text-sm text-slate-500">
                  {pendingEntry ? (
                    'Add or clear the custom sale / expense entry'
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
                  disabled={busy || !dirty || pendingEntry}
                  onClick={() => persist(false)}
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </>
          )}
        </>
      )}
      {showHistory && (
        <SalesHistory
          onSelectDate={(value) => {
            changeDate(value);
            setView('day');
          }}
        />
      )}
    </div>
  );
}
