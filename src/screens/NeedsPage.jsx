'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  ClipboardCopy,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShoppingBasket,
  Undo2,
} from 'lucide-react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import { ActionMenu, EmptyState, SearchField } from '../components/ScreenControls.jsx';
import { apiGet, apiPost } from '../lib/apiClient.js';
import { isoDateToday } from '../lib/dates.js';
import { parseQty } from '../lib/numbers.js';
import useUnsavedChanges from '../lib/useUnsavedChanges.js';

export default function NeedsPage({ q: qProp } = {}) {
  const [date, setDate] = useState(isoDateToday());
  const [inventory, setInventory] = useState([]);
  const [manual, setManual] = useState([]);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState(String(qProp || ''));
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [removed, setRemoved] = useState(null);
  const request = useRef(0);
  const writeLock = useRef(false);
  const inputRef = useRef(null);
  const focusAfterAdd = useRef(false);
  const canDiscard = useUnsavedChanges(!!input.trim());
  const busy = loading || !!pending;

  useEffect(() => {
    if (!pending && focusAfterAdd.current) {
      inputRef.current?.focus();
      focusAfterAdd.current = false;
    }
  }, [pending]);

  useEffect(() => {
    setQuery(String(qProp || ''));
  }, [qProp]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const [stock, needs] = await Promise.all([
        apiGet('inventory.get', { date }),
        apiGet('needs.list', { date, source: 'derived' }),
      ]);
      if (id !== request.current) return;
      setInventory(Array.isArray(stock.items) ? stock.items : []);
      setManual((needs.items || []).filter((item) => item.Status === 'NEEDS_MANUAL'));
      setReady(true);
    } catch (reason) {
      if (id === request.current) setError(reason.message || 'Unable to load this list.');
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

  const lowStock = useMemo(
    () =>
      inventory
        .filter((item) => parseQty(item.Closing_Qty) <= parseQty(item.Threshold_Limit))
        .sort(
          (a, b) =>
            Number(parseQty(a.Closing_Qty) > 0) - Number(parseQty(b.Closing_Qty) > 0) ||
            a.Product.localeCompare(b.Product),
        ),
    [inventory],
  );
  const matches = (item) => item.Product.toLowerCase().includes(query.trim().toLowerCase());
  const visibleLow = lowStock.filter(matches);
  const visibleManual = manual.filter(matches);

  function changeDate(value) {
    if (!value || value === date || !canDiscard()) return;
    setInput('');
    setSuccess('');
    setRemoved(null);
    setDate(value);
  }
  async function addNeed(event) {
    event.preventDefault();
    const product = input.trim();
    if (!ready || busy || writeLock.current || !product) return;
    if (manual.some((item) => item.Product.toLowerCase() === product.toLowerCase())) {
      setError('This item is already on your list.');
      return;
    }
    writeLock.current = true;
    focusAfterAdd.current = true;
    setPending('add');
    setError('');
    setSuccess('');
    const item = { Product: product, Current_Closing_Qty: 0, Status: 'NEEDS_MANUAL' };
    try {
      await apiPost('needs.manual.upsert', { date, item });
      setManual((items) => [...items, item]);
      setInput('');
      setQuery('');
      setRemoved(null);
      setSuccess(`${product} added to your list.`);
    } catch (reason) {
      setError(reason.message || 'Unable to add the item. Please try again.');
    } finally {
      writeLock.current = false;
      setPending('');
    }
  }
  async function complete(item) {
    if (busy || writeLock.current) return;
    writeLock.current = true;
    setPending(item.Product);
    setError('');
    setSuccess('');
    try {
      await apiPost('needs.manual.remove', { date, Product: item.Product });
      setManual((items) => items.filter((entry) => entry.Product !== item.Product));
      setRemoved(item);
      setSuccess(`${item.Product} marked as done.`);
    } catch (reason) {
      setError(reason.message || 'Unable to update this item.');
    } finally {
      writeLock.current = false;
      setPending('');
    }
  }
  async function undo() {
    if (!removed || busy || writeLock.current) return;
    writeLock.current = true;
    setPending('undo');
    setError('');
    try {
      await apiPost('needs.manual.upsert', { date, item: removed });
      setManual((items) => [...items.filter((item) => item.Product !== removed.Product), removed]);
      setSuccess(`${removed.Product} restored.`);
      setRemoved(null);
    } catch (reason) {
      setError(reason.message || 'Unable to restore the item.');
    } finally {
      writeLock.current = false;
      setPending('');
    }
  }
  async function copyList() {
    const text = [
      `Shopping list · ${date}`,
      ...(lowStock.length
        ? [
            '',
            'Restock',
            ...lowStock.map(
              (item) => `- ${item.Product}: ${parseQty(item.Closing_Qty)} ${item.Unit || ''} remaining`,
            ),
          ]
        : []),
      ...(manual.length ? ['', 'Other supplies', ...manual.map((item) => `- ${item.Product}`)] : []),
    ].join('\n');
    setError('');
    try {
      await navigator.clipboard.writeText(text);
      setSuccess('Shopping list copied.');
    } catch {
      setError('Unable to copy. Please allow clipboard access and try again.');
    }
  }

  return (
    <div className="workspace-page">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <h1 className="page-title">Needs</h1>
          <p className="page-subtitle">Everything to pick up for your kitchen.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 sm:w-44">
            <DateInput label="List date" value={date} onChange={changeDate} disabled={busy} />
          </div>
          <ActionMenu disabled={busy}>
            <button className="action-menu-item" disabled={busy} onClick={load}>
              <RefreshCw size={16} />
              Refresh list
            </button>
          </ActionMenu>
        </div>
      </header>
      <ErrorBanner message={error} onRetry={!ready && !loading ? load : undefined} />
      {success && (
        <div className="notice-success">
          <span role="status" className="flex min-w-0 flex-1 items-center gap-2">
            <Check size={16} className="shrink-0" />
            {success}
          </span>
          {removed && (
            <button
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 font-semibold"
              disabled={busy}
              onClick={undo}
            >
              <Undo2 size={15} />
              Undo
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-sm">
          <SearchField value={query} onChange={setQuery} placeholder="Search your list…" />
        </div>
        <button
          className="md-btn md-btn-outline min-h-11"
          disabled={busy || !ready || !(lowStock.length + manual.length)}
          onClick={copyList}
        >
          <ClipboardCopy size={16} />
          Copy shopping list
        </button>
      </div>
      {loading ? (
        <div className="md-card p-10">
          <LoadingSpinner label="Loading your list…" />
        </div>
      ) : !ready ? (
        <div className="md-card">
          <EmptyState icon={ShoppingBasket} title="Your list couldn’t be loaded">
            Retry to see what needs replenishing.
          </EmptyState>
        </div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <section className="md-card overflow-hidden" aria-label="Stock to replenish">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 className="section-title">
                  Restock <span className="ml-1.5 text-slate-400">{lowStock.length}</span>
                </h2>
                <p className="mt-1 text-xs text-slate-500">Based on the day’s saved inventory.</p>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--p-3)]">
                <ShoppingBasket size={20} />
              </span>
            </div>
            {visibleLow.length ? (
              <ul className="divide-y divide-slate-100">
                {visibleLow.map((item) => (
                  <li key={item.Product} className="flex items-center justify-between gap-3 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{item.Product}</span>
                        {parseQty(item.Closing_Qty) <= 0 && <span className="stock-alert">Out of stock</span>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        <span className="font-semibold text-[var(--p-4)]">
                          {parseQty(item.Closing_Qty)} {item.Unit || ''}
                        </span>{' '}
                        remaining
                      </p>
                    </div>
                    <Link
                      href={`/inventory?date=${date}&q=${encodeURIComponent(item.Product)}`}
                      aria-label={`Update ${item.Product} inventory`}
                      className="admin-icon-button shrink-0"
                    >
                      <ArrowUpRight size={18} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={query ? Search : PackageCheck}
                title={
                  query && lowStock.length
                    ? 'No matching stock items'
                    : inventory.length
                      ? 'Stock looks good'
                      : 'No inventory for this day'
                }
              >
                {query && lowStock.length
                  ? 'Try another item name.'
                  : inventory.length
                    ? 'Nothing is at or below its low-stock alert.'
                    : 'Save this day’s inventory to see what needs restocking.'}
              </EmptyState>
            )}
            <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-xs leading-relaxed text-slate-500">
              After restocking, update your inventory to clear these items.
            </div>
          </section>
          <section className="md-card overflow-hidden" aria-label="Other supplies">
            <div className="border-b border-slate-100 p-5">
              <h2 className="section-title">
                Other supplies <span className="ml-1.5 text-slate-400">{manual.length}</span>
              </h2>
              <p className="mt-1 text-xs text-slate-500">Add anything else you need to pick up.</p>
              <form className="mt-4 flex items-start gap-2" onSubmit={addNeed}>
                <input
                  ref={inputRef}
                  aria-label="New supply"
                  className="md-input min-w-0 flex-1"
                  placeholder="e.g. Ice, cleaning supplies…"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={busy}
                  maxLength={150}
                />
                <button
                  type="submit"
                  className="md-btn md-btn-primary h-[42px] shrink-0 px-3"
                  disabled={busy || !input.trim()}
                >
                  <Plus size={17} />
                  {pending === 'add' ? 'Adding…' : 'Add'}
                </button>
              </form>
            </div>
            {visibleManual.length ? (
              <ul className="divide-y divide-slate-100">
                {visibleManual.map((item) => (
                  <li key={item.Product} className="flex items-center gap-3 px-5 py-3">
                    <button
                      className="group grid h-11 w-11 shrink-0 place-items-center rounded-xl text-transparent hover:bg-[var(--brand-soft)] hover:text-[var(--p-3)] focus-visible:text-[var(--p-3)]"
                      disabled={busy}
                      onClick={() => complete(item)}
                      aria-label={`Mark ${item.Product} as done`}
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-md border border-slate-300 group-hover:border-[var(--p-2)]">
                        <Check size={14} />
                      </span>
                    </button>
                    <span className="min-w-0 break-words text-sm font-medium text-slate-800">
                      {item.Product}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={query && manual.length ? Search : ShoppingBasket}
                title={query && manual.length ? 'No matching supplies' : 'Your extras go here'}
              >
                {query && manual.length
                  ? 'Try another name or clear the search.'
                  : 'Add an item above, then check it off once it’s picked up.'}
              </EmptyState>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
