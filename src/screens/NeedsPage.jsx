'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FullscreenLoading from '../components/FullscreenLoading.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import { apiGet, apiPost } from '../lib/googleSheetsApi.js';
import { isoDateToday } from '../lib/dates.js';
import { parseQty } from '../lib/numbers.js';

function needsAuto(item) {
  const closing = parseQty(item.Closing_Qty);
  const threshold = parseQty(item.Threshold_Limit);
  return closing <= threshold;
}

function buildExportText(date, autoNeeds, manualNeeds) {
  const lines = [];
  lines.push(`Needs! (Replenish List) - ${date}`);
  lines.push('');
  if (autoNeeds.length) {
    lines.push('Auto (below threshold):');
    autoNeeds.forEach((n) => {
      const qty = parseQty(n.Closing_Qty);
      const unit = n.Unit ? ` ${n.Unit}` : '';
      lines.push(`- ${n.Product}: ${qty}${unit} remaining`);
    });
    lines.push('');
  }
  if (manualNeeds.length) {
    lines.push('Other Needs:');
    manualNeeds.forEach((n) => {
      lines.push(`- ${n.Product}`);
    });
    lines.push('');
  }
  return lines.join('\n').trim();
}

export default function NeedsPage({ q: qProp } = {}) {
  const [date, setDate] = useState(isoDateToday());
  const [inventoryRows, setInventoryRows] = useState([]);
  const [manualNeeds, setManualNeeds] = useState([]);
  const [manualInput, setManualInput] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const q = String(qProp || '').trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const autoNeeds = useMemo(
    () => inventoryRows.filter(needsAuto).map((r) => ({ ...r, Status: 'NEEDS_AUTO' })),
    [inventoryRows],
  );

  const visibleAuto = useMemo(() => {
    const query = q.toLowerCase();
    if (!query) return autoNeeds;
    return autoNeeds.filter((n) => String(n.Product || '').toLowerCase().includes(query));
  }, [autoNeeds, q]);

  const visibleManual = useMemo(() => {
    const query = q.toLowerCase();
    if (!query) return manualNeeds;
    return manualNeeds.filter((n) => String(n.Product || '').toLowerCase().includes(query));
  }, [manualNeeds, q]);
  const overlay = saving
    ? { title: 'Updating needs…', subtitle: `Date: ${date}` }
    : loading
      ? { title: 'Loading needs…', subtitle: `Date: ${date}` }
      : null;

  const load = useCallback(async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const [inv, needs] = await Promise.all([
        apiGet('inventory.get', { date }),
        apiGet('needs.list', { date, source: 'derived' }),
      ]);
      setInventoryRows(Array.isArray(inv.items) ? inv.items : []);
      const items = Array.isArray(needs.items) ? needs.items : [];
      setManualNeeds(items.filter((i) => i.Status === 'NEEDS_MANUAL'));
    } catch (e) {
      setError(e?.message || 'Failed to load needs');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function addManualNeed() {
    const product = manualInput.trim();
    if (!product) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiPost('needs.manual.upsert', {
        date,
        item: { Product: product, Current_Closing_Qty: 0, Status: 'NEEDS_MANUAL' },
      });
      setManualInput('');
      setSuccess('Added other need.');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to add other need');
    } finally {
      setSaving(false);
    }
  }

  async function removeManualNeed(product) {
    const ok = window.confirm(`Remove other need "${product}"?`);
    if (!ok) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiPost('needs.manual.remove', { date, Product: product });
      setSuccess('Removed other need.');
      await load();
    } catch (e) {
      setError(e?.message || 'Failed to remove other need');
    } finally {
      setSaving(false);
    }
  }

  async function copyExport() {
    const text = buildExportText(date, autoNeeds, manualNeeds);
    try {
      await navigator.clipboard.writeText(text);
      setSuccess('Copied needs list to clipboard.');
    } catch {
      setError('Clipboard copy failed. Try manual select/copy.');
    }
  }

  return (
    <div className="space-y-4">
      <FullscreenLoading show={!!overlay} title={overlay?.title} subtitle={overlay?.subtitle} />
      <div className="md-card">
        <div className="border-b border-slate-200 bg-white px-4 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-lg font-extrabold text-slate-900">Needs</div>
              <div className="mt-1 text-sm text-slate-600">Auto needs come from inventory thresholds.</div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full sm:w-[180px]">
                <DateInput label="Date" value={date} onChange={setDate} />
              </div>
              {q ? (
                <button
                  type="button"
                  className="md-btn md-btn-outline h-10"
                  onClick={() => {
                    router.replace(pathname);
                  }}
                  title="Clear filter"
                >
                  Filter: {q} ×
                </button>
              ) : null}
              <button type="button" className="md-btn md-btn-primary h-10" onClick={copyExport} disabled={loading}>
                Copy/Export Text
              </button>
            </div>
          </div>
        </div>
        <div className="px-4 py-4">
          <ErrorBanner message={error} onRetry={load} />
          {success ? (
            <div className="md-card border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
              {success}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="md-card">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
            <div className="text-sm font-extrabold text-slate-900">Auto (Below threshold)</div>
            <span className="md-badge-warn">{visibleAuto.length}</span>
          </div>
          <div className="px-4 py-4">
            <ul className="space-y-2">
              {visibleAuto.map((n) => (
                <li
                  key={n.Product}
                  className="flex items-center justify-between rounded-2xl bg-[rgba(243,176,184,0.32)] p-3"
                >
                  <div>
                    <div className="font-semibold">{n.Product}</div>
                    <div className="text-xs font-semibold text-slate-700">
                      {(() => {
                        const qty = parseQty(n.Closing_Qty);
                        const unit = n.Unit ? ` ${n.Unit}` : '';
                        return `${qty}${unit} remaining`;
                      })()}
                    </div>
                  </div>
                  <span className="md-badge-warn">Needs</span>
                </li>
              ))}
              {autoNeeds.length === 0 ? <li className="text-sm text-slate-600">No auto needs right now.</li> : null}
              {autoNeeds.length > 0 && visibleAuto.length === 0 ? (
                <li className="text-sm text-slate-600">No items match this filter.</li>
              ) : null}
            </ul>
          </div>
        </div>

        <div className="md-card">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
            <div className="text-sm font-extrabold text-slate-900">Other Needs</div>
            <span className="md-chip">{visibleManual.length}</span>
          </div>
          <div className="px-4 py-4">
            <div className="flex gap-2">
              <input
                className="md-input"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Add other need (e.g., Ice)"
              />
              <button type="button" className="md-btn md-btn-primary h-[42px]" onClick={addManualNeed} disabled={saving}>
                Add
              </button>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {visibleManual.map((n) => (
                <div
                  key={n.Product}
                  className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0"
                >
                  <div className="font-semibold text-slate-900">{n.Product}</div>
                  <button
                    type="button"
                    className="md-btn md-btn-outline h-9 px-3"
                    onClick={() => removeManualNeed(n.Product)}
                    disabled={saving}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {manualNeeds.length === 0 ? (
                <div className="px-4 py-3 text-sm text-slate-600">No other needs added.</div>
              ) : null}
              {manualNeeds.length > 0 && visibleManual.length === 0 ? (
                <div className="px-4 py-3 text-sm text-slate-600">No items match this filter.</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
