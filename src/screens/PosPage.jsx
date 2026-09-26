'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronRight,
  History,
  Minus,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { apiGet, apiPost } from '../lib/apiClient.js';
import { getUser } from '../lib/auth.js';
import {
  businessDate,
  moneyCents,
  normalizeOrderRequest,
  orderNumber,
  ORDER_TYPES,
  validBusinessDate,
} from '../lib/pos.js';
import { peso } from '../lib/sales.js';
import { DEFAULT_PRINTER, loadPrinterSettings, printerStatus, subscribePrinter } from '../lib/printer.js';
import { receiptTime } from '../lib/receipt.js';
import useUnsavedChanges from '../lib/useUnsavedChanges.js';
import { EmptyState, SearchField } from '../components/ScreenControls.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import CustomAmountEntries from '../components/CustomAmountEntries.jsx';
import PrinterSetup from '../components/pos/PrinterSetup.jsx';
import OrderSlip from '../components/pos/OrderSlip.jsx';
import EditOrder from '../components/pos/EditOrder.jsx';

const pendingKey = () => `si_pos_pending:${getUser()?.username || 'staff'}`;

export default function PosPage() {
  const [date, setDate] = useState(businessDate());
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState({});
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState({ count: 0, total: 0 });
  const [cursor, setCursor] = useState(null);
  const [historyDate, setHistoryDate] = useState(businessDate());
  const [historyBusy, setHistoryBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [view, setView] = useState('order');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState([]);
  const [type, setType] = useState('Takeaway');
  const [customer, setCustomer] = useState('');
  const [notes, setNotes] = useState('');
  const [cash, setCash] = useState('');
  const [customDraft, setCustomDraft] = useState({ description: '', amount: '' });
  const [pending, setPending] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [slip, setSlip] = useState(null);
  const [editing, setEditing] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_PRINTER);
  const [printer, setPrinter] = useState({ connected: false });
  const [showPrinter, setShowPrinter] = useState(false);
  const [basketVisible, setBasketVisible] = useState(false);
  const request = useRef(0);
  const historyRequest = useRef(0);
  const saveLock = useRef(false);
  const busy = saving || !!pending;
  const hasCustomDraft = !!(customDraft.description || customDraft.amount);
  useUnsavedChanges(!!cart.length || hasCustomDraft || !!pending || !!customer || !!notes || !!cash);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'history') setView('history');
    setSettings(loadPrinterSettings());
    setPrinter(printerStatus());
    try {
      const raw = sessionStorage.getItem(pendingKey());
      if (raw) {
        const recovered = normalizeOrderRequest(JSON.parse(raw));
        setPending(recovered);
        setCart(recovered.items.map((item, index) => ({ ...item, key: `recovered-${index}` })));
        setType(recovered.type);
        setCustomer(recovered.customer);
        setNotes(recovered.notes);
        setCash(recovered.cashReceived ?? '');
      }
    } catch {
      setError(
        'The previous checkout could not be restored. Check saved orders before starting another sale.',
      );
    }
    setHydrated(true);
    return subscribePrinter(setPrinter);
  }, []);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const requestedDate = new URLSearchParams(window.location.search).get('date');
      const today = validBusinessDate(requestedDate) ? requestedDate : businessDate();
      const data = await apiGet('pos.bootstrap', { date: today });
      if (id !== request.current) return;
      setDate(today);
      setProducts(data.products || []);
      let hasPending = true;
      try {
        hasPending = !!sessionStorage.getItem(pendingKey());
      } catch {
        /* Preserve prices if storage is unavailable. */
      }
      setCart((items) =>
        items.map((item) => {
          const latest = (data.products || []).find((product) => product.Name === item.name);
          return !hasPending && item.kind === 'menu' && latest
            ? { ...item, unitPrice: Number(latest.Price) }
            : item;
        }),
      );
      historyRequest.current += 1;
      setHistoryBusy(false);
      setSales(data.sales || {});
      setOrders(data.orders || []);
      setSummary(data.summary || { count: 0, total: 0 });
      setCursor(data.nextCursor);
      setHistoryDate(today);
      setReady(true);
    } catch (reason) {
      if (id === request.current) setError(reason.message || 'Unable to load POS.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load]);
  useEffect(() => {
    const basket = document.getElementById('pos-basket');
    if (!basket) return;
    const observer = new IntersectionObserver(([entry]) => setBasketVisible(entry.isIntersecting), {
      rootMargin: '0px 0px -80px 0px',
      threshold: 0.1,
    });
    observer.observe(basket);
    return () => observer.disconnect();
  }, [ready, view]);
  const activeProducts = products.filter(
    (product) => product.Name && String(product.Active || 'Y').toUpperCase() !== 'N',
  );
  const categories = [...new Set(activeProducts.map((product) => product.Category || 'Other'))];
  const visible = activeProducts.filter(
    (product) =>
      (!category || (product.Category || 'Other') === category) &&
      `${product.Name} ${product.Category}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const totals = useMemo(() => {
    let total = 0;
    let count = 0;
    let error = '';
    for (const item of cart) {
      const quantity = Number(item.quantity);
      if (
        item.kind === 'menu' &&
        !products.some(
          (product) => product.Name === item.name && String(product.Active || 'Y').toUpperCase() !== 'N',
        )
      )
        error = `${item.name} is unavailable. Remove it from the order.`;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999)
        error = 'Use whole quantities from 1 to 999.';
      else {
        total += moneyCents(item.unitPrice) * quantity;
        count += quantity;
      }
    }
    const tendered = cash === '' ? total : moneyCents(cash);
    if (!Number.isFinite(tendered) || tendered < total) error = 'Cash received must cover the order total.';
    return { total: total / 100, count, change: Math.max(0, tendered - total) / 100, error };
  }, [cart, cash, products]);

  function addProduct(product) {
    setError('');
    setCart((items) => {
      const existing = items.find((item) => item.kind === 'menu' && item.name === product.Name);
      return existing
        ? items.map((item) =>
            item === existing ? { ...item, quantity: Math.min(999, (Number(item.quantity) || 0) + 1) } : item,
          )
        : [
            ...items,
            {
              key: crypto.randomUUID(),
              kind: 'menu',
              name: product.Name,
              unitPrice: Number(product.Price),
              quantity: 1,
            },
          ];
    });
  }
  function quantity(key, value) {
    setCart((items) => items.map((item) => (item.key === key ? { ...item, quantity: value } : item)));
  }
  function remove(key) {
    setCart((items) => items.filter((item) => item.key !== key));
  }
  async function history(nextDate, more = false) {
    const id = ++historyRequest.current;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const data = await apiGet('pos.orders', { date: nextDate, ...(more ? { before: cursor } : {}) });
      if (id !== historyRequest.current) return;
      setOrders((previous) => (more ? [...previous, ...data.orders] : data.orders));
      setCursor(data.nextCursor);
      setHistoryDate(nextDate);
    } catch (reason) {
      if (id === historyRequest.current) setHistoryError(reason.message || 'Unable to load orders.');
    } finally {
      if (id === historyRequest.current) setHistoryBusy(false);
    }
  }
  async function complete() {
    if (saveLock.current || !ready || !hydrated) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    let payload = pending;
    let sent = false;
    try {
      if (!payload) {
        payload = normalizeOrderRequest({
          id: crypto.randomUUID(),
          date: businessDate(),
          items: cart.map(({ key, ...item }) => item),
          type,
          customer,
          notes,
          cashReceived: cash,
        });
        sessionStorage.setItem(pendingKey(), JSON.stringify(payload));
        setPending(payload);
      }
      sent = true;
      const result = await apiPost('pos.complete', payload);
      // Printing is deliberately outside the save/retry path: a failed printer never recreates an order.
      setPending(null);
      try {
        sessionStorage.removeItem(pendingKey());
      } catch {
        /* A stale reference remains safe to retry. */
      }
      setLastOrder(result.order);
      request.current += 1;
      historyRequest.current += 1;
      setLoading(false);
      setHistoryBusy(false);
      setSales(result.sales || {});
      setDate(result.order.date);
      setCart([]);
      setCash('');
      setCustomer('');
      setNotes('');
      setCustomDraft({ description: '', amount: '' });
      setOrders((items) => [
        result.order,
        ...items.filter((item) => item.id !== result.order.id && item.date === result.order.date),
      ]);
      setHistoryDate(result.order.date);
      setSummary(result.summary);
      setCursor(null);
      if (settings.autoPrint) setSlip({ order: result.order, autoPrint: true });
    } catch (reason) {
      if (reason.code === 'ORDER_VALIDATION') {
        try {
          sessionStorage.removeItem(pendingKey());
        } catch {}
        setPending(null);
        setError(reason.message);
      } else if (sent || pending) {
        setPending(payload);
        setError('We could not confirm the sale. Retry the same order below; it will only be counted once.');
      } else setError(reason.message || 'Unable to prepare this order.');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="workspace-page pos-workspace">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="page-title">POS</h1>
          <p className="page-subtitle">Take orders. Print slips. Sales stay up to date.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="md-btn md-btn-outline min-h-11"
            onClick={() => setShowPrinter(true)}
            disabled={saving}
          >
            <Printer size={17} />
            Printer setup
            <span
              className={`h-2 w-2 rounded-full ${settings.method === 'system' ? 'bg-slate-300' : printer.connected && printer.method === settings.method ? 'bg-emerald-500' : 'bg-amber-400'}`}
            />
          </button>
          <Link href="/sales" className="md-btn md-btn-outline min-h-11">
            View sales
            <ChevronRight size={16} />
          </Link>
        </div>
      </header>
      <ErrorBanner message={error} onRetry={!ready && !loading ? load : undefined} />
      {pending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{saving ? 'Saving your order…' : 'Confirm your last checkout'}</p>
          <p className="mt-1 text-xs">The order is kept for a safe retry, including after a page reload.</p>
          {!saving && (
            <button className="md-btn md-btn-primary mt-3" onClick={complete}>
              Retry save
            </button>
          )}
        </div>
      )}
      {lastOrder && !pending && (
        <div className="notice-success flex-wrap justify-between">
          <span className="flex items-center gap-2">
            <Check size={17} />
            Order {orderNumber(lastOrder.number)} saved · {peso(lastOrder.total)} · Sales updated
          </span>
          <button
            className="text-sm font-semibold underline underline-offset-4"
            onClick={() => setSlip({ order: lastOrder })}
          >
            View / print slip
          </button>
        </div>
      )}
      {loading && !ready ? (
        <div className="md-card p-10">
          <LoadingSpinner label="Opening POS…" />
        </div>
      ) : (
        ready && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="segmented-control">
                <button className="segment" aria-pressed={view === 'order'} onClick={() => setView('order')}>
                  <ShoppingBag size={16} />
                  New order{cart.length > 0 && <span className="segment-count">{cart.length}</span>}
                </button>
                <button
                  className="segment"
                  aria-pressed={view === 'history'}
                  onClick={() => {
                    setView('history');
                    history(historyDate);
                  }}
                >
                  <History size={16} />
                  Saved orders
                </button>
              </div>
              <p className="text-xs text-slate-500">
                {date} · Day’s sales <strong className="text-slate-800">{peso(sales.Takoyaki_Sales)}</strong>{' '}
                · {summary.count} POS orders
              </p>
            </div>
            {view === 'history' ? (
              <section className="md-card overflow-hidden" aria-label="Saved orders">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-5">
                  <div>
                    <h2 className="section-title">Order history</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Open an order to edit the sale or reprint its slip.
                    </p>
                  </div>
                  <div className="flex items-end gap-2">
                    <DateInput
                      label="Order date"
                      value={historyDate}
                      disabled={historyBusy}
                      onChange={(value) => {
                        if (value) history(value);
                      }}
                    />
                    <button
                      className="admin-icon-button"
                      aria-label="Refresh orders"
                      disabled={historyBusy}
                      onClick={() => history(historyDate)}
                    >
                      <RefreshCw size={17} />
                    </button>
                  </div>
                </div>
                <div className="px-5 pt-3">
                  <ErrorBanner message={historyError} />
                </div>
                {historyBusy && !orders.length ? (
                  <LoadingSpinner label="Loading orders…" />
                ) : !orders.length ? (
                  <EmptyState icon={History} title="No orders for this day">
                    Completed POS orders appear here.
                  </EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {orders.map((order) => (
                      <li key={order.id}>
                        <button
                          className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-slate-50"
                          onClick={() => setSlip({ order })}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800">
                              {orderNumber(order.number)}{' '}
                              <span className="ml-2 text-xs font-normal text-slate-500">{order.type}</span>
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {receiptTime(order.createdAt)}
                              {order.customer ? ` · ${order.customer}` : ''}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {order.items.reduce((sum, item) => sum + item.quantity, 0)} items ·{' '}
                              {order.cashier}
                            </p>
                          </div>
                          <span className="flex items-center gap-3 font-semibold tabular-nums">
                            {peso(order.total)}
                            <Printer size={17} className="text-[var(--p-3)]" />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {cursor && (
                  <div className="p-5">
                    <button
                      className="md-btn md-btn-outline w-full"
                      disabled={historyBusy}
                      onClick={() => history(historyDate, true)}
                    >
                      {historyBusy ? 'Loading…' : 'Load earlier orders'}
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <>
                <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <section className="md-card min-w-0 p-4 sm:p-5" aria-label="POS menu">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h2 className="section-title">Menu</h2>
                      <button
                        className="admin-icon-button"
                        aria-label="Refresh menu"
                        disabled={loading || busy}
                        onClick={load}
                      >
                        <RefreshCw size={16} />
                      </button>
                    </div>
                    <SearchField value={query} onChange={setQuery} placeholder="Search menu…" />
                    <div className="my-4 flex flex-wrap gap-2">
                      <button
                        className="category-chip"
                        aria-pressed={!category}
                        onClick={() => setCategory('')}
                      >
                        All
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
                    {!visible.length ? (
                      <EmptyState
                        icon={Search}
                        title={activeProducts.length ? 'No matching products' : 'Your menu is empty'}
                      >
                        {activeProducts.length
                          ? 'Try another name or category.'
                          : 'Add menu products in Admin or enter a custom item below.'}
                      </EmptyState>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-2 min-[1400px]:grid-cols-3">
                        {visible.map((product) => {
                          const count = cart.find(
                            (item) => item.kind === 'menu' && item.name === product.Name,
                          )?.quantity;
                          return (
                            <button
                              key={product.Name}
                              className={`product-tile ${count ? 'product-tile-selected' : ''}`}
                              disabled={busy || !hydrated}
                              aria-label={`Add ${product.Name} to order`}
                              onClick={() => addProduct(product)}
                            >
                              <div className="mb-4 flex w-full items-center justify-between">
                                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--p-4)]">
                                  <UtensilsCrossed size={19} />
                                </span>
                                {count ? (
                                  <span className="rounded-full bg-[var(--p-3)] px-2 py-1 text-xs font-semibold text-white">
                                    {count}
                                  </span>
                                ) : (
                                  <Plus size={17} className="text-slate-400" />
                                )}
                              </div>
                              <span className="text-left text-sm font-semibold text-slate-800">
                                {product.Name}
                              </span>
                              <span className="mt-1 text-xs text-slate-400">
                                {product.Category || 'Other'}
                              </span>
                              <span className="mt-3 font-semibold tabular-nums text-[var(--p-4)]">
                                {peso(product.Price)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <details className="mt-5 border-t border-slate-100 pt-4">
                      <summary className="cursor-pointer text-sm font-semibold text-[var(--p-4)]">
                        Add a custom-priced item
                      </summary>
                      <div className="mt-4">
                        <CustomAmountEntries
                          title="Custom sale"
                          maxLength={180}
                          example="e.g. Barkada mix"
                          entries={[]}
                          draft={customDraft}
                          onDraftChange={setCustomDraft}
                          onError={setError}
                          disabled={busy || !hydrated}
                          onChange={(entries) =>
                            setCart((items) => [
                              ...items,
                              ...entries.map((entry) => ({
                                key: crypto.randomUUID(),
                                kind: 'custom',
                                name: entry.description,
                                unitPrice: entry.amount,
                                quantity: 1,
                              })),
                            ])
                          }
                        />
                      </div>
                    </details>
                  </section>
                  <section
                    id="pos-basket"
                    tabIndex={-1}
                    className="md-card min-w-0 scroll-mt-24 overflow-hidden xl:sticky xl:top-24"
                    aria-label="Current order"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 p-5">
                      <h2 className="section-title">Current order</h2>
                      {cart.length > 0 && (
                        <button
                          className="text-xs font-semibold text-slate-500"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm('Clear this order?')) {
                              setCart([]);
                              setCustomer('');
                              setNotes('');
                              setCash('');
                              setCustomDraft({ description: '', amount: '' });
                            }
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <fieldset disabled={busy} className="min-w-0">
                      <div className="flex gap-1 border-b border-slate-100 p-3">
                        {ORDER_TYPES.map((value) => (
                          <button
                            key={value}
                            className={`flex-1 rounded-lg px-2 py-2.5 text-xs font-semibold ${type === value ? 'bg-[var(--brand-soft)] text-[var(--p-4)]' : 'text-slate-500 hover:bg-slate-50'}`}
                            aria-pressed={type === value}
                            onClick={() => setType(value)}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                      {!cart.length ? (
                        <EmptyState icon={ShoppingBag} title="Ready for the next order">
                          Tap menu items to start.
                        </EmptyState>
                      ) : (
                        <div className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
                          {cart.map((item) => (
                            <div key={item.key} className="p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="break-words text-sm font-semibold text-slate-800">
                                    {item.name}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {peso(item.unitPrice)} each
                                    {item.kind === 'custom' ? ' · Custom item' : ''}
                                  </p>
                                </div>
                                <button
                                  className="p-1 text-slate-400 hover:text-red-700"
                                  aria-label={`Remove ${item.name} from order`}
                                  onClick={() => remove(item.key)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-3">
                                <div className="quantity-stepper">
                                  <button
                                    aria-label={`Decrease ${item.name} quantity`}
                                    onClick={() =>
                                      Number(item.quantity) > 1
                                        ? quantity(item.key, Number(item.quantity) - 1)
                                        : remove(item.key)
                                    }
                                  >
                                    <Minus size={15} />
                                  </button>
                                  <input
                                    aria-label={`${item.name} quantity`}
                                    type="number"
                                    min="1"
                                    max="999"
                                    step="1"
                                    inputMode="numeric"
                                    value={item.quantity}
                                    onChange={(event) => quantity(item.key, event.target.value)}
                                    onFocus={(event) => event.target.select()}
                                  />
                                  <button
                                    aria-label={`Increase ${item.name} quantity`}
                                    onClick={() =>
                                      quantity(item.key, Math.min(999, (Number(item.quantity) || 0) + 1))
                                    }
                                  >
                                    <Plus size={15} />
                                  </button>
                                </div>
                                <strong className="text-sm tabular-nums">
                                  {peso(Number(item.quantity || 0) * item.unitPrice)}
                                </strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <details className="border-t border-slate-100 p-4">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                          Customer / table & order notes{customer || notes ? ' · Added' : ''}
                        </summary>
                        <div className="mt-3 space-y-3">
                          <label className="md-field">
                            <span className="md-label">Customer or table (optional)</span>
                            <input
                              className="md-input"
                              maxLength={80}
                              value={customer}
                              onChange={(event) => setCustomer(event.target.value)}
                              placeholder="e.g. Table 2 / Alex"
                            />
                          </label>
                          <label className="md-field">
                            <span className="md-label">Order notes (optional)</span>
                            <textarea
                              className="md-input h-20 py-3"
                              maxLength={500}
                              value={notes}
                              onChange={(event) => setNotes(event.target.value)}
                              placeholder="e.g. No spicy sauce"
                            />
                          </label>
                        </div>
                      </details>
                      <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 p-5">
                        <div className="flex items-end justify-between gap-3">
                          <div className="text-sm text-slate-500">
                            Total<span className="mt-1 block text-xs">{totals.count} items</span>
                          </div>
                          <strong className="text-3xl tracking-tight tabular-nums">
                            {peso(totals.total)}
                          </strong>
                        </div>
                        <label className="md-field">
                          <span className="md-label">Cash received (optional)</span>
                          <input
                            className="md-input"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.01"
                            placeholder={`Exact amount · ${peso(totals.total)}`}
                            value={cash}
                            onChange={(event) => setCash(event.target.value)}
                          />
                        </label>
                        {cash !== '' && (
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Change</span>
                            <strong className="tabular-nums">{peso(totals.change)}</strong>
                          </div>
                        )}
                        {totals.error && (
                          <p role="alert" className="text-xs text-red-700">
                            {totals.error}
                          </p>
                        )}
                        {hasCustomDraft && (
                          <p className="text-xs text-amber-700">
                            Add or clear the custom item before completing the sale.
                          </p>
                        )}
                        <button
                          className="md-btn md-btn-primary min-h-12 w-full"
                          disabled={busy || !hydrated || !cart.length || !!totals.error || hasCustomDraft}
                          onClick={complete}
                        >
                          {settings.autoPrint ? <Printer size={18} /> : <Check size={18} />}
                          {saving ? 'Saving…' : settings.autoPrint ? 'Complete & print' : 'Complete sale'}
                        </button>
                        <p className="text-center text-xs text-slate-500">
                          Saves the order and adds it to daily sales.
                        </p>
                      </div>
                    </fieldset>
                  </section>
                </div>
                {cart.length > 0 && !basketVisible && (
                  <div className="save-bar xl:hidden">
                    <div>
                      <p className="text-xs text-slate-500">{totals.count} items</p>
                      <strong className="tabular-nums">{peso(totals.total)}</strong>
                    </div>
                    <button
                      className="md-btn md-btn-primary min-h-11"
                      onClick={() => {
                        const basket = document.getElementById('pos-basket');
                        basket?.scrollIntoView({ behavior: 'smooth' });
                        basket?.focus({ preventScroll: true });
                      }}
                    >
                      Review order
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )
      )}
      {showPrinter && (
        <PrinterSetup settings={settings} onSave={setSettings} onClose={() => setShowPrinter(false)} />
      )}
      {slip && (
        <OrderSlip
          order={slip.order}
          autoPrint={slip.autoPrint}
          settings={settings}
          onClose={() => setSlip(null)}
          onEdit={
            !busy
              ? () => {
                  setEditing(slip.order);
                  setSlip(null);
                }
              : undefined
          }
        />
      )}
      {editing && (
        <EditOrder
          order={editing}
          products={products}
          onClose={(order) => {
            setEditing(null);
            if (order) setSlip({ order });
            else {
              setView('history');
              setOrders([]);
              history(historyDate);
            }
          }}
          onSave={(result) => {
            request.current += 1;
            historyRequest.current += 1;
            setLoading(false);
            setHistoryBusy(false);
            setOrders((items) => items.map((item) => (item.id === result.order.id ? result.order : item)));
            setLastOrder((previous) => (previous?.id === result.order.id ? result.order : previous));
            if (date === result.order.date) {
              setSales(result.sales);
              setSummary(result.summary);
            }
            setEditing(null);
            setSlip({ order: result.order });
          }}
        />
      )}
    </div>
  );
}
