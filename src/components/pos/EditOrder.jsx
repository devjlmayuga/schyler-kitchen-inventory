'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import PosModal from './PosModal.jsx';
import ErrorBanner from '../ErrorBanner.jsx';
import LoadingSpinner from '../LoadingSpinner.jsx';
import CustomAmountEntries from '../CustomAmountEntries.jsx';
import { apiGet, apiPost } from '../../lib/apiClient.js';
import { moneyCents, normalizeOrderEdit, orderNumber, ORDER_TYPES } from '../../lib/pos.js';
import { peso } from '../../lib/sales.js';
import useUnsavedChanges from '../../lib/useUnsavedChanges.js';

const draftOf = (order) => ({
  items: order.items.map(({ kind, name, quantity, unitPrice }) => ({ kind, name, quantity, unitPrice })),
  type: order.type,
  customer: order.customer,
  notes: order.notes,
  cashReceived: order.cashReceived,
});

export default function EditOrder({ order: initial, products, onSave, onClose }) {
  const [order, setOrder] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState({ description: '', amount: '' });
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const sequence = useRef(0);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(draftOf(order)) ||
    !!reason ||
    !!custom.description ||
    !!custom.amount;
  const canDiscard = useUnsavedChanges(dirty || !!pending);
  const busy = loading || saving;
  const frozen = busy || !!pending || !ready;
  const active = products.filter((product) => String(product.Active || 'Y').toUpperCase() !== 'N');
  const menuNames = [
    ...new Set([
      ...order.items.filter((item) => item.kind === 'menu').map((item) => item.name),
      ...active.map((product) => product.Name),
    ]),
  ];
  const total =
    draft.items.reduce(
      (sum, item) => sum + (moneyCents(item.unitPrice) || 0) * (Number(item.quantity) || 0),
      0,
    ) / 100;
  const change = Math.max(0, draft.cashReceived === '' ? 0 : Number(draft.cashReceived) - total);
  const incomplete = !!custom.description || !!custom.amount;
  const update = (key, value) => setDraft((previous) => ({ ...previous, [key]: value }));
  const itemChange = (index, changes) =>
    update(
      'items',
      draft.items.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );

  async function reload() {
    const id = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const result = await apiGet('pos.order', { id: initial.id });
      if (id !== sequence.current) return;
      setOrder(result.order);
      setDraft(draftOf(result.order));
      setReason('');
      setCustom({ description: '', amount: '' });
      setPending(null);
      setConflict(false);
      setReady(true);
    } catch (error) {
      if (id === sequence.current) setError(error.message || 'Unable to load this sale.');
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    reload();
    return () => {
      sequence.current++;
    };
  }, [initial.id]);
  function close() {
    // An uncertain or conflicting save may have changed the receipt on the server.
    if (canDiscard()) onClose(pending || conflict || !ready ? null : order);
  }
  async function save() {
    if (lock.current || (frozen && !pending) || conflict || incomplete) return;
    lock.current = true;
    setSaving(true);
    setError('');
    let payload = pending;
    let sent = false;
    try {
      if (!payload)
        payload = normalizeOrderEdit({
          ...draft,
          id: order.id,
          date: order.date,
          revision: order.revision,
          editId: crypto.randomUUID(),
          reason,
        });
      setPending(payload);
      sent = true;
      const result = await apiPost('pos.edit', payload);
      onSave(result);
    } catch (error) {
      if (error.code === 'ORDER_VALIDATION' || error.code === 'ORDER_CONFLICT' || !sent) {
        setPending(null);
        setConflict(error.code === 'ORDER_CONFLICT');
        setError(error.message);
      } else {
        setPending(payload);
        setError(
          'We could not confirm the correction. Retry save to check the same change without applying it twice.',
        );
      }
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <PosModal
      title={`Edit sale ${orderNumber(order.number)}`}
      onClose={close}
      busy={busy}
      footer={
        <div className="space-y-3">
          <ErrorBanner message={error} onRetry={!ready && !loading ? reload : undefined} />
          {conflict && (
            <button
              className="md-btn md-btn-outline"
              onClick={() => {
                if (canDiscard()) reload();
              }}
            >
              Reload latest order
            </button>
          )}
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">Corrected total</span>
            <strong className="text-xl tabular-nums">{peso(total)}</strong>
          </div>
          <p className="text-xs text-slate-500">
            Updates this sale and the totals for {order.date}. No new sale is created.
          </p>
          <div className="flex justify-end gap-2">
            <button className="md-btn md-btn-outline" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button
              className="md-btn md-btn-primary"
              disabled={busy || !ready || !dirty || conflict || incomplete || !draft.items.length}
              onClick={save}
            >
              <Save size={16} />
              {saving ? 'Saving…' : pending ? 'Retry save' : 'Save correction'}
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="p-8">
          <LoadingSpinner label="Loading saved sale…" />
        </div>
      ) : (
        <fieldset disabled={frozen} className="min-w-0 space-y-5 p-5">
          <div className="rounded-xl bg-slate-50 p-4 text-sm">
            <p>
              Saved total <strong>{peso(order.total)}</strong> · Order {orderNumber(order.number)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Edit the amounts actually charged. Menu prices stay unchanged.
            </p>
          </div>
          <div className="space-y-3">
            {draft.items.map((item, index) => (
              <div key={index} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-end gap-2">
                  <label className="md-field min-w-0 flex-1">
                    <span className="md-label">{item.kind === 'menu' ? 'Menu item' : 'Custom item'}</span>
                    {item.kind === 'menu' ? (
                      <select
                        className="md-select"
                        aria-label={`Item ${index + 1} product`}
                        value={item.name}
                        onChange={(event) => {
                          const name = event.target.value;
                          const product = active.find((product) => product.Name === name);
                          const previous = order.items.find(
                            (item) => item.kind === 'menu' && item.name === name,
                          );
                          itemChange(index, {
                            name,
                            unitPrice: previous?.unitPrice ?? Number(product?.Price || 0),
                          });
                        }}
                      >
                        {menuNames.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="md-input"
                        aria-label={`Item ${index + 1} description`}
                        maxLength={180}
                        value={item.name}
                        onChange={(event) => itemChange(index, { name: event.target.value })}
                      />
                    )}
                  </label>
                  <button
                    className="admin-icon-button shrink-0"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() =>
                      update(
                        'items',
                        draft.items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="md-field">
                    <span className="md-label">Quantity</span>
                    <input
                      className="md-input"
                      aria-label={`Item ${index + 1} quantity`}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="999"
                      step="1"
                      value={item.quantity}
                      onChange={(event) => itemChange(index, { quantity: event.target.value })}
                    />
                  </label>
                  <label className="md-field">
                    <span className="md-label">Unit price (₱)</span>
                    <input
                      className="md-input"
                      aria-label={`Item ${index + 1} unit price`}
                      type="number"
                      inputMode="decimal"
                      min={item.kind === 'custom' ? '0.01' : '0'}
                      max="1000000"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(event) => itemChange(index, { unitPrice: event.target.value })}
                    />
                  </label>
                </div>
                <p className="mt-3 text-right text-sm font-semibold tabular-nums">
                  {peso((moneyCents(item.unitPrice) * Number(item.quantity)) / 100)}
                </p>
              </div>
            ))}
            {!draft.items.length && (
              <p className="text-sm text-amber-700">Add at least one item to save this sale.</p>
            )}
          </div>
          <details className="rounded-xl border border-slate-200 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--p-4)]">Add an item</summary>
            <div className="mt-4 space-y-5">
              <div className="flex items-end gap-2">
                <label className="md-field min-w-0 flex-1">
                  <span className="md-label">Menu product</span>
                  <select
                    className="md-select"
                    aria-label="Add menu product"
                    value={selected}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    <option value="">Choose a product</option>
                    {active.map((product) => (
                      <option key={product.Name} value={product.Name}>
                        {product.Name} · {peso(product.Price)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="md-btn md-btn-outline"
                  disabled={!selected}
                  onClick={() => {
                    const product = active.find((product) => product.Name === selected);
                    const index = draft.items.findIndex(
                      (item) => item.kind === 'menu' && item.name === selected,
                    );
                    if (index >= 0)
                      itemChange(index, { quantity: Math.min(999, Number(draft.items[index].quantity) + 1) });
                    else
                      update('items', [
                        ...draft.items,
                        { kind: 'menu', name: product.Name, unitPrice: Number(product.Price), quantity: 1 },
                      ]);
                    setSelected('');
                  }}
                >
                  <Plus size={16} />
                  Add
                </button>
              </div>
              <CustomAmountEntries
                title="Custom sale"
                entries={[]}
                draft={custom}
                onDraftChange={setCustom}
                onError={setError}
                disabled={frozen}
                maxLength={180}
                example="e.g. Barkada mix"
                onChange={(entries) =>
                  update('items', [
                    ...draft.items,
                    ...entries.map((entry) => ({
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="md-field">
              <span className="md-label">Order type</span>
              <select
                className="md-select"
                aria-label="Order type"
                value={draft.type}
                onChange={(event) => update('type', event.target.value)}
              >
                {ORDER_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label className="md-field">
              <span className="md-label">Cash received</span>
              <input
                className="md-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="Leave blank for exact amount"
                value={draft.cashReceived}
                onChange={(event) => update('cashReceived', event.target.value)}
              />
            </label>
          </div>
          <p className="text-right text-sm text-slate-500">
            Change <strong className="text-slate-800">{peso(change)}</strong>
          </p>
          <label className="md-field">
            <span className="md-label">Customer or table</span>
            <input
              className="md-input"
              maxLength={80}
              value={draft.customer}
              onChange={(event) => update('customer', event.target.value)}
            />
          </label>
          <label className="md-field">
            <span className="md-label">Order notes</span>
          <textarea
            aria-label="Order notes"
              className="md-input h-20 py-3"
              maxLength={500}
              value={draft.notes}
              onChange={(event) => update('notes', event.target.value)}
            />
          </label>
          <label className="md-field">
            <span className="md-label">Correction note (optional)</span>
            <input
              className="md-input"
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Quantity was entered twice"
            />
          </label>
          {incomplete && (
            <p className="text-xs text-amber-700">Add or clear the new custom item before saving.</p>
          )}
        </fieldset>
      )}
    </PosModal>
  );
}
