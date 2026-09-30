'use client';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import PosModal from './PosModal.jsx';
import ErrorBanner from '../ErrorBanner.jsx';
import LoadingSpinner from '../LoadingSpinner.jsx';
import { apiGet, apiPost } from '../../lib/apiClient.js';
import { normalizeOrderDeletion, orderNumber } from '../../lib/pos.js';
import { peso } from '../../lib/sales.js';
import useUnsavedChanges from '../../lib/useUnsavedChanges.js';

export default function DeleteOrder({ order: initial, onDeleted, onClose }) {
  const [order, setOrder] = useState(initial);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const lock = useRef(false);
  const busy = loading || saving;
  useUnsavedChanges(!!pending);
  async function reload() {
    const id = ++sequence.current;
    setLoading(true);
    setReady(false);
    setError('');
    try {
      const result = await apiGet('pos.order', { id: initial.id });
      if (id !== sequence.current) return;
      if (result.order.deletedAt) {
        onDeleted({ ...result, repeated: true });
        return;
      }
      setOrder(result.order);
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
    onClose(pending || conflict || !ready ? null : order);
  }
  async function remove() {
    if (lock.current || busy || !ready || conflict) return;
    lock.current = true;
    setSaving(true);
    setError('');
    let payload = pending;
    let sent = false;
    try {
      if (!payload) payload = normalizeOrderDeletion({ id: order.id, revision: order.revision, reason });
      setPending(payload);
      sent = true;
      const result = await apiPost('pos.delete', payload);
      onDeleted(result);
    } catch (error) {
      if (!sent || error.code === 'ORDER_VALIDATION' || error.code === 'ORDER_CONFLICT') {
        setPending(null);
        setConflict(error.code === 'ORDER_CONFLICT');
        setError(error.message);
      } else {
        setPending(payload);
        setError(
          'We could not confirm the deletion. Retry to check the same sale; its amount will only be removed once.',
        );
      }
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <PosModal
      title={`Delete sale ${orderNumber(order.number)}?`}
      onClose={close}
      busy={busy}
      footer={
        <div className="space-y-3">
          <ErrorBanner message={error} onRetry={!ready && !loading ? reload : undefined} />
          {conflict && (
            <button className="md-btn md-btn-outline" onClick={reload}>
              Reload latest order
            </button>
          )}
          <div className="flex justify-end gap-2">
            <button className="md-btn md-btn-outline" disabled={busy} onClick={close}>
              {pending ? 'Close & refresh' : 'Keep sale'}
            </button>
            <button
              className="md-btn min-h-11 bg-red-700 text-white hover:bg-red-800"
              disabled={busy || !ready || conflict}
              onClick={remove}
            >
              <Trash2 size={16} />
              {saving ? 'Deleting…' : pending ? 'Retry deletion' : 'Delete sale'}
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="p-8">
          <LoadingSpinner label="Loading sale…" />
        </div>
      ) : (
        <div className="space-y-5 p-5">
          <div className="rounded-xl border border-red-100 bg-red-50 p-4">
            <p className="text-sm font-semibold text-slate-800">
              Order {orderNumber(order.number)} · {order.date}
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-red-800">{peso(order.total)}</p>
            {order.customer && <p className="mt-1 break-words text-sm text-slate-600">{order.customer}</p>}
          </div>
          <p className="text-sm leading-relaxed text-slate-600">
            This removes the order from saved sales and deducts {peso(order.total)} from the sales and cash
            balance for {order.date}. Other sales and expenses stay unchanged.
          </p>
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto text-sm">
            {order.items.map((item, index) => (
              <li key={index} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 break-words">
                  {item.quantity} × {item.name}
                </span>
                <span className="shrink-0 tabular-nums">{peso(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <label className="md-field">
            <span className="md-label">Deletion note (optional)</span>
            <input
              className="md-input"
              maxLength={200}
              value={reason}
              disabled={busy || !!pending || !ready}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Duplicate order"
            />
          </label>
          <p className="text-xs text-slate-500">
            The deletion is kept in the audit history. This does not issue a payment refund.
          </p>
        </div>
      )}
    </PosModal>
  );
}
