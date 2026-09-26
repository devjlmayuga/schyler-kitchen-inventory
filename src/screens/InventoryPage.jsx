'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardCopy, LockKeyhole, Package, Search, Trash2, UnlockKeyhole } from 'lucide-react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import { ActionMenu, EmptyState, SearchField } from '../components/ScreenControls.jsx';
import { apiGet, apiPost } from '../lib/apiClient.js';
import { isoDateToday } from '../lib/dates.js';
import { closingQuantity, isLowStock, prepareInventory } from '../lib/inventory.js';
import useUnsavedChanges from '../lib/useUnsavedChanges.js';

export default function InventoryPage({ q: qProp, initialDate } = {}) {
  const [rows, setRows] = useState([]);
  const [savedRows, setSavedRows] = useState('[]');
  const [date, setDate] = useState(initialDate || isoDateToday());
  const [dayClosed, setDayClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState(String(qProp || ''));
  const [filter, setFilter] = useState('all');
  const request = useRef(0);
  const dirty = ready && JSON.stringify(rows) !== savedRows;
  const canDiscard = useUnsavedChanges(dirty);
  const busy = loading || saving;

  useEffect(() => {
    setQuery(String(qProp || ''));
  }, [qProp]);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const data = await apiGet('inventory.getOrSeed', { date });
      if (id !== request.current) return;
      const items = Array.isArray(data.items) ? data.items : [];
      setRows(items);
      setSavedRows(JSON.stringify(items));
      setDayClosed(!!data.closed);
      setReady(true);
    } catch (e) {
      if (id === request.current) setError(e?.message || 'Unable to load inventory. Please try again.');
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

  const lowCount = rows.filter(isLowStock).length;
  const visibleRows = useMemo(
    () =>
      rows
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) =>
            String(item.Product || '')
              .toLowerCase()
              .includes(query.trim().toLowerCase()) &&
            (filter !== 'low' || isLowStock(item)),
        ),
    [rows, query, filter],
  );

  function changeDate(value) {
    if (!value || value === date || !canDiscard()) return;
    setSuccess('');
    setDate(value);
  }

  function updateCell(index, key, value) {
    setSuccess('');
    setRows((previous) => previous.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }

  async function save() {
    if (busy || !ready || dayClosed) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const items = prepareInventory(rows);
      await apiPost('inventory.submit', { date, items });
      setRows(items);
      setSavedRows(JSON.stringify(items));
      setSuccess('Inventory saved.');
    } catch (e) {
      setError(e?.message || 'Unable to save inventory. Your changes are still here.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleClosed() {
    if (!canDiscard()) return;
    if (
      !dayClosed &&
      !window.confirm(
        `Mark ${date} as a closed day? This resets stock added and used to zero and locks this date. Use this only for a day the shop did not operate.`,
      )
    )
      return;
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await apiPost('inventory.setClosed', { date, closed: !dayClosed });
      await load();
    } catch (e) {
      setError(e?.message || 'Unable to update this day.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDay() {
    if (
      !window.confirm(
        `Delete inventory for ${date}? This cannot be undone. Any unsaved changes will also be discarded.`,
      )
    )
      return;
    setSaving(true);
    setSuccess('');
    setError('');
    try {
      await apiPost('inventory.deleteDay', { date });
      await load();
      setSuccess('Saved inventory deleted. A fresh daily list is ready.');
    } catch (e) {
      setError(e?.message || 'Unable to delete inventory.');
    } finally {
      setSaving(false);
    }
  }

  async function copySummary() {
    const summary = [
      `Daily inventory · ${date}`,
      ...rows.map(
        (item) =>
          `${item.Product}: ${closingQuantity(item)} ${item.Unit || ''}${isLowStock(item) ? ' · Low stock' : ''} (Opening ${item.Current_Qty || 0}, Added ${item.In_Stock || 0}, Used ${item.Out_Stock || 0})`,
      ),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summary);
      setSuccess('Inventory summary copied.');
    } catch {
      setError('Unable to copy the summary. Please allow clipboard access and try again.');
    }
  }

  return (
    <div className="workspace-page">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="page-title">Inventory</h1>
            {dayClosed && ready && (
              <span className="md-chip">
                <LockKeyhole size={12} /> Closed day
              </span>
            )}
          </div>
          <p className="page-subtitle">A clear view of what’s in your kitchen.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 sm:w-44">
            <DateInput label="Inventory date" value={date} onChange={changeDate} disabled={busy} />
          </div>
          <ActionMenu disabled={busy || !ready}>
            <button
              className="action-menu-item"
              disabled={busy || !ready || !rows.length}
              onClick={copySummary}
            >
              <ClipboardCopy size={16} /> Copy summary
            </button>
            <button className="action-menu-item" disabled={busy || !ready} onClick={toggleClosed}>
              {dayClosed ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}
              {dayClosed ? 'Reopen day' : 'Mark as closed day'}
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button className="action-menu-item text-red-700" disabled={busy || !ready} onClick={deleteDay}>
              <Trash2 size={16} /> Delete day
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
      {dayClosed && ready && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          This is a non-operating day. Reopen it from the actions menu to make changes.
        </div>
      )}

      <section className="md-card overflow-hidden" aria-label="Daily stock">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="segmented-control self-start" aria-label="Filter inventory">
            <button
              type="button"
              className="segment"
              aria-pressed={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              All items <span className="segment-count">{ready ? rows.length : '—'}</span>
            </button>
            <button
              type="button"
              className="segment"
              aria-pressed={filter === 'low'}
              onClick={() => setFilter('low')}
            >
              Low stock <span className="segment-count">{ready ? lowCount : '—'}</span>
            </button>
          </div>
          <div className="w-full sm:w-64">
            <SearchField value={query} onChange={setQuery} placeholder="Search inventory…" />
          </div>
        </div>
        {loading ? (
          <div className="p-10">
            <LoadingSpinner label="Loading inventory…" />
          </div>
        ) : !ready ? (
          <EmptyState icon={Package} title="Inventory couldn’t be loaded">
            Use Retry above to load this day before making changes.
          </EmptyState>
        ) : !rows.length ? (
          <EmptyState icon={Package} title="No inventory items yet">
            Add your kitchen items in Admin to start tracking stock.
          </EmptyState>
        ) : !visibleRows.length ? (
          <EmptyState icon={Search} title={query ? 'No matching items' : 'Stock looks good'}>
            {query ? 'Try another item name or clear your search.' : 'No items are running low for this day.'}
          </EmptyState>
        ) : (
          <div>
            <div
              className="inventory-grid hidden border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-xs font-semibold text-slate-500 sm:grid"
              aria-hidden="true"
            >
              <span>Item</span>
              <span className="text-center">Opening</span>
              <span className="text-center">Added</span>
              <span className="text-center">Used</span>
              <span className="text-right">Remaining</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {visibleRows.map(({ item, index }) => {
                const closing = closingQuantity(item);
                const low = isLowStock(item);
                return (
                  <li
                    key={`${item.Product}-${index}`}
                    className="inventory-grid grid items-center gap-x-3 gap-y-4 px-4 py-4 sm:px-5"
                  >
                    <div className="col-span-2 min-w-0 sm:col-span-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-800">{item.Product}</span>
                        {low && (
                          <span className="stock-alert">
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--p-3)]" />
                            {closing <= 0 ? 'Out of stock' : 'Low stock'}
                          </span>
                        )}
                      </div>
                      {item.Unit && <div className="mt-1 text-xs text-slate-500">{item.Unit}</div>}
                    </div>
                    <div className="col-start-1 row-start-2 text-center sm:col-auto sm:row-auto">
                      <span className="mb-1.5 block text-xs text-slate-500 sm:hidden">Opening</span>
                      <span className="text-sm tabular-nums text-slate-500">{item.Current_Qty || 0}</span>
                    </div>
                    {['In_Stock', 'Out_Stock'].map((key) => (
                      <label key={key} className="row-start-2 block sm:row-auto">
                        <span className="mb-1.5 block text-center text-xs text-slate-500 sm:sr-only">
                          {key === 'In_Stock' ? 'Added' : 'Used'}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          aria-label={`${item.Product} ${key === 'In_Stock' ? 'added' : 'used'}`}
                          disabled={busy || dayClosed}
                          value={item[key] ?? ''}
                          onFocus={(event) => event.target.select()}
                          onChange={(event) => updateCell(index, key, event.target.value)}
                          placeholder="0"
                          className="stock-input"
                        />
                      </label>
                    ))}
                    <div className="col-start-3 row-start-1 text-right sm:col-auto sm:row-auto">
                      <span className="mb-1 block text-xs text-slate-500 sm:hidden">Remaining</span>
                      <span
                        aria-label={`${item.Product} remaining`}
                        className={`text-lg font-semibold tabular-nums ${low ? 'text-[var(--p-4)]' : 'text-slate-900'}`}
                      >
                        {closing}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {ready && rows.length > 0 && !dayClosed && (
        <div className="save-bar">
          <div className="min-w-0 text-sm text-slate-500">
            {dirty ? (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--p-3)]" />
                Unsaved changes
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Check size={16} />
                {success === 'Inventory saved.' ? 'All changes saved' : 'Ready for your stock update'}
              </span>
            )}
          </div>
          <button
            type="button"
            className="md-btn md-btn-primary min-h-11 shrink-0"
            disabled={busy}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save inventory'}
          </button>
        </div>
      )}
    </div>
  );
}
