'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, Plus, Search, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { ActionMenu, EmptyState, SearchField } from '../ScreenControls.jsx';
import LoadingSpinner from '../LoadingSpinner.jsx';
import { AdminFeedback, AdminSaveBar } from './AdminFeedback.jsx';
import { apiGet, apiPost } from '../../lib/apiClient.js';
import { normalizeCatalog } from '../../lib/admin.js';

export default function CatalogSettings({ kind, onDirtyChange, onBusyChange }) {
  const menu = kind === 'products';
  const nameKey = menu ? 'Name' : 'Product';
  const textKey = menu ? 'Category' : 'Unit';
  const amountKey = menu ? 'Price' : 'Threshold_Limit';
  const [rows, setRows] = useState([]);
  const [saved, setSaved] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({});
  const [availability, setAvailability] = useState('all');
  const request = useRef(0);
  const writeLock = useRef(false);
  const dirty = ready && JSON.stringify(rows) !== JSON.stringify(saved);
  const hasDraft = Object.values(draft).some((value) => String(value).trim());
  const busy = loading || saving;
  useEffect(() => {
    onDirtyChange(dirty || hasDraft);
    return () => onDirtyChange(false);
  }, [dirty, hasDraft, onDirtyChange]);
  useEffect(() => {
    onBusyChange(saving);
    return () => onBusyChange(false);
  }, [saving, onBusyChange]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const data = await apiGet(`${kind}.list`);
      if (id !== request.current) return;
      const entries = (data.items || []).map((item) => ({
        ...item,
        Original_Name: item[kind === 'products' ? 'Name' : 'Product'],
      }));
      setRows(entries);
      setSaved(entries);
      setReady(true);
    } catch (reason) {
      if (id === request.current) setError(reason.message || 'Unable to load items.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [kind]);
  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  function update(index, key, value) {
    setSuccess('');
    setRows((items) => items.map((item, i) => (i === index ? { ...item, [key]: value } : item)));
  }
  function add(event) {
    event.preventDefault();
    setError('');
    try {
      const item = normalizeCatalog([{ ...draft, Active: 'Y' }], kind)[0];
      normalizeCatalog([...rows, item], kind);
      setRows((items) => [...items, item]);
      setDraft({});
      setShowAdd(false);
      setQuery('');
      setAvailability('all');
      setSuccess(`${item[nameKey]} added to the list. Save changes to apply.`);
    } catch (reason) {
      setError(reason.message);
    }
  }
  async function save() {
    if (busy || !ready || writeLock.current) return;
    writeLock.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const items = normalizeCatalog(rows, kind);
      await apiPost(`${kind}.upsertMany`, { items });
      const entries = items.map((item) => ({ ...item, Original_Name: item[nameKey] }));
      setRows(entries);
      setSaved(entries);
      setSuccess(menu ? 'Menu products saved.' : 'Inventory items saved.');
    } catch (reason) {
      setError(reason.message || 'Unable to save. Your edits are still here.');
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }
  async function remove(item) {
    const name = item.Original_Name || item[nameKey];
    const exists = !!item.Original_Name;
    if (
      exists &&
      !window.confirm(
        menu
          ? `Delete ${name} from the menu? You can hide it from orders instead by turning off Available.`
          : `Delete ${name}? This also removes its inventory history and replenishment records. This cannot be undone.`,
      )
    )
      return;
    if (busy || writeLock.current) return;
    writeLock.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      if (exists) await apiPost(`${kind}.delete`, menu ? { name } : { product: name });
      setRows((items) => items.filter((entry) => entry !== item));
      setSaved((items) => items.filter((entry) => entry[nameKey] !== name));
      setSuccess(`${name} removed.`);
    } catch (reason) {
      setError(reason.message || 'Unable to remove this item.');
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }
  const visible = rows
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        `${item[nameKey]} ${item[textKey]}`.toLowerCase().includes(query.trim().toLowerCase()) &&
        (availability === 'all' || (availability === 'active') === (String(item.Active || 'Y') !== 'N')),
    );

  return (
    <div className="space-y-5">
      <AdminFeedback error={error} success={success} onRetry={!ready && !loading ? load : undefined} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="section-title">{menu ? 'Menu products' : 'Inventory items'}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {menu
              ? 'Edit names, prices and availability. Recorded sales keep their original product names.'
              : 'Edit names, units and restock alerts. Item history stays linked when you rename it.'}
          </p>
        </div>
        <button
          className="md-btn md-btn-primary min-h-11 self-start"
          disabled={busy || !ready}
          aria-expanded={showAdd}
          onClick={() => setShowAdd((value) => !value)}
        >
          <Plus size={17} />
          {menu ? 'Add product' : 'Add item'}
        </button>
      </div>
      {showAdd && (
        <form className="md-card border-[var(--p-1)] p-5" onSubmit={add}>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="section-title">{menu ? 'New menu product' : 'New inventory item'}</h3>
            <button
              type="button"
              className="admin-icon-button"
              aria-label="Close new item form"
              disabled={busy}
              onClick={() => {
                if (!hasDraft || window.confirm('Discard this new item?')) {
                  setDraft({});
                  setShowAdd(false);
                }
              }}
            >
              <X size={17} />
            </button>
          </div>
          <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-3">
            <label className="md-field">
              <span className="md-label">{menu ? 'Product name' : 'Item name'}</span>
              <input
                autoFocus
                required
                maxLength={150}
                className="md-input"
                value={draft[nameKey] || ''}
                onChange={(event) => setDraft({ ...draft, [nameKey]: event.target.value })}
                placeholder={menu ? 'e.g. Cheese takoyaki' : 'e.g. Flour'}
              />
            </label>
            <label className="md-field">
              <span className="md-label">{menu ? 'Category' : 'Unit'}</span>
              <input
                className="md-input"
                value={draft[textKey] || ''}
                onChange={(event) => setDraft({ ...draft, [textKey]: event.target.value })}
                placeholder={menu ? 'e.g. Classics' : 'e.g. packs'}
              />
            </label>
            <label className="md-field">
              <span className="md-label">{menu ? 'Price (₱)' : 'Low-stock alert'}</span>
              <input
                type="number"
                min="0"
                step={menu ? '0.01' : 'any'}
                inputMode="decimal"
                className="md-input"
                value={draft[amountKey] ?? ''}
                onChange={(event) => setDraft({ ...draft, [amountKey]: event.target.value })}
                placeholder="0"
              />
            </label>
            <div className="flex justify-end sm:col-span-3">
              <button type="submit" className="md-btn md-btn-primary min-h-11">
                Add to list
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <section className="md-card" aria-label={menu ? 'Product settings' : 'Inventory settings'}>
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:px-5">
          <div className="w-full sm:max-w-sm">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={menu ? 'Search products or categories…' : 'Search items…'}
            />
          </div>
          {menu ? (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <span>Show</span>
              <select
                className="md-select min-w-0"
                aria-label="Product availability"
                value={availability}
                onChange={(event) => setAvailability(event.target.value)}
              >
                <option value="all">All products</option>
                <option value="active">Available</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
          ) : (
            <span className="shrink-0 text-xs text-slate-500">
              {ready ? `${rows.length} items` : 'Loading…'}
            </span>
          )}
        </div>
        {loading ? (
          <div className="p-10">
            <LoadingSpinner label={menu ? 'Loading products…' : 'Loading inventory items…'} />
          </div>
        ) : !ready ? (
          <EmptyState icon={Package} title="Items couldn’t be loaded">
            Retry above before making changes.
          </EmptyState>
        ) : !visible.length ? (
          <EmptyState
            icon={query || availability !== 'all' ? Search : menu ? UtensilsCrossed : Package}
            title={
              query || availability !== 'all'
                ? 'No matching items'
                : menu
                  ? 'Build your menu'
                  : 'Add your kitchen essentials'
            }
          >
            {query || availability !== 'all'
              ? 'Try another search or filter.'
              : 'Use the add button to create your first item.'}
          </EmptyState>
        ) : (
          <fieldset disabled={busy} className="min-w-0">
            <ul className="divide-y divide-slate-100">
              {visible.map(({ item, index }) => (
                <li key={index} className={`catalog-row ${menu ? 'catalog-row-menu' : ''}`}>
                  <div className="min-w-0">
                    <label className="md-field">
                      <span className="md-label">{menu ? 'Product name' : 'Item name'}</span>
                      <input
                        className="md-input font-semibold"
                        maxLength={120}
                        aria-label={`${item.Original_Name || 'New item'} name`}
                        value={item[nameKey]}
                        onChange={(event) => update(index, nameKey, event.target.value)}
                      />
                    </label>
                    {!item.Original_Name && (
                      <span className="mt-1 inline-block text-xs text-[var(--p-4)]">New · not saved</span>
                    )}
                  </div>
                  <label className="md-field">
                    <span className="md-label">{menu ? 'Category' : 'Unit'}</span>
                    <input
                      className="md-input"
                      aria-label={`${item[nameKey]} ${menu ? 'category' : 'unit'}`}
                      value={item[textKey] ?? ''}
                      onChange={(event) => update(index, textKey, event.target.value)}
                    />
                  </label>
                  <label className="md-field">
                    <span className="md-label">{menu ? 'Price (₱)' : 'Low-stock alert'}</span>
                    <input
                      className="md-input tabular-nums"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step={menu ? '0.01' : 'any'}
                      aria-label={`${item[nameKey]} ${menu ? 'price' : 'low-stock alert'}`}
                      value={item[amountKey] ?? ''}
                      onChange={(event) => update(index, amountKey, event.target.value)}
                    />
                  </label>
                  {menu && (
                    <label className="flex min-h-11 items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--p-3)]"
                        checked={String(item.Active || 'Y') !== 'N'}
                        onChange={(event) => update(index, 'Active', event.target.checked ? 'Y' : 'N')}
                        aria-label={`${item.Name} available for orders`}
                      />
                      Available
                    </label>
                  )}
                  <div className="catalog-row-actions">
                    <ActionMenu label={`Actions for ${item[nameKey]}`} disabled={busy}>
                      <button
                        type="button"
                        className="action-menu-item text-red-700"
                        disabled={busy}
                        onClick={() => remove(item)}
                      >
                        <Trash2 size={16} />
                        {item.Original_Name ? 'Delete permanently' : 'Remove from list'}
                      </button>
                    </ActionMenu>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </section>
      {ready && (
        <AdminSaveBar
          dirty={dirty}
          pendingDraft={hasDraft}
          saving={saving}
          onSave={save}
          onDiscard={() => {
            if (window.confirm('Discard your unsaved edits?')) {
              setRows(saved);
              setSuccess('');
            }
          }}
        />
      )}
    </div>
  );
}
