'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FullscreenLoading from '../components/FullscreenLoading.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import { apiGet, apiPost } from '../lib/googleSheetsApi.js';
import { isoDateToday } from '../lib/dates.js';
import { clampMin, parseQty } from '../lib/numbers.js';

function computeClosing(item) {
  const current = parseQty(item.Current_Qty);
  const inStock = parseQty(item.In_Stock);
  const outStock = parseQty(item.Out_Stock);
  return current + inStock - outStock;
}

function needsReplenish(item) {
  const closing = computeClosing(item);
  const threshold = parseQty(item.Threshold_Limit);
  return closing <= threshold;
}

function buildInventoryExportText(date, items) {
  const rows = Array.isArray(items) ? items : [];
  const lines = [];
  lines.push(`Daily Inventory - ${date}`);
  lines.push('Closing = QTY + IN - OUT.');
  lines.push('');

  const lowItems = rows.filter(needsReplenish);
  if (lowItems.length) {
    lines.push(`Needs replenish (${lowItems.length}):`);
    lowItems.forEach((r) => {
      const closing = computeClosing(r);
      const unit = r.Unit ? ` ${r.Unit}` : '';
      lines.push(`- ${String(r.Product || '').trim()}: ${closing}${unit} remaining`);
    });
    lines.push('');
  }

  lines.push('All items:');
  rows.forEach((r) => {
    const product = String(r.Product || '').trim();
    const unit = r.Unit ? ` ${r.Unit}` : '';
    const current = parseQty(r.Current_Qty);
    const inStock = parseQty(r.In_Stock);
    const outStock = parseQty(r.Out_Stock);
    const closing = current + inStock - outStock;
    const low = closing <= parseQty(r.Threshold_Limit);
    lines.push(
      `- ${product}: Closing ${closing}${unit} (QTY ${current}, IN ${inStock}, OUT ${outStock})${low ? ' [LOW]' : ''}`,
    );
  });

  return lines.join('\n').trim();
}

export default function InventoryPage({ q: qProp } = {}) {
  const [rows, setRows] = useState([]);
  const [date, setDate] = useState(isoDateToday());
  const [dayClosed, setDayClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const q = String(qProp || '').trim();

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setSuccess('');
        setError('');
      }
      setLoading(true);
      setDayClosed(false);
      try {
        const data = await apiGet('inventory.getOrSeed', { date });
        const items = Array.isArray(data.items) ? data.items : [];
        setRows(items);
        setDayClosed(!!data?.closed);
        if (!silent && data?.seeded) {
          const from = data.seededFrom ? ` from ${data.seededFrom} closing` : '';
          setSuccess(`Loaded items template (QTY${from}). Enter IN/OUT then submit.`);
        }
      } catch (e) {
        if (!silent) setError(e?.message || 'Failed to load inventory');
      } finally {
        setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    load();
  }, [load]);

  const lowCount = useMemo(() => rows.filter(needsReplenish).length, [rows]);
  const visibleRows = useMemo(() => {
    const query = q.toLowerCase();
    const withIndex = rows.map((r, idx) => ({ r, idx }));
    if (!query) return withIndex;
    return withIndex.filter(({ r }) => String(r.Product || '').toLowerCase().includes(query));
  }, [q, rows]);
  const overlay = saving
    ? { title: 'Saving inventory…', subtitle: `Date: ${date}` }
    : seeding
      ? { title: 'Loading items…', subtitle: 'Preparing daily list' }
      : loading
        ? { title: 'Loading inventory…', subtitle: `Date: ${date}` }
        : null;

  function updateCell(index, key, value) {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  }

  async function submitInventory(nextRows) {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      if (dayClosed) {
        setError('This day is marked CLOSED. Re-open it to edit inventory.');
        return;
      }
      const payloadRows = (nextRows || rows).map((r) => {
        const closing = computeClosing(r);
        return {
          ...r,
          Current_Qty: clampMin(parseQty(r.Current_Qty), 0),
          In_Stock: clampMin(parseQty(r.In_Stock), 0),
          Out_Stock: clampMin(parseQty(r.Out_Stock), 0),
          Closing_Qty: closing,
          Threshold_Limit: clampMin(parseQty(r.Threshold_Limit), 0),
        };
      });
      await apiPost('inventory.submit', { date, items: payloadRows });
      setSuccess(`Saved inventory for ${date}.`);
      setRows(payloadRows);
    } catch (e) {
      setError(e?.message || 'Failed to save inventory');
    } finally {
      setSaving(false);
    }
  }

  async function loadItemsTemplate() {
    setError('');
    setSuccess('');
    setSeeding(true);
    try {
      if (dayClosed) {
        setError('This day is marked CLOSED. Re-open it to load items.');
        return;
      }
      const seeded = await apiGet('inventory.seedTemplate', { date });
      const templateRows = Array.isArray(seeded.items) ? seeded.items : [];
      setRows(templateRows);
      setDayClosed(false);
      const from = seeded.seededFrom ? ` from ${seeded.seededFrom} closing` : '';
      setSuccess(`Loaded items template (QTY${from}). Enter IN/OUT then submit.`);
    } catch (e) {
      setError(e?.message || 'Failed to load items');
    } finally {
      setSeeding(false);
    }
  }

  async function deleteDay() {
    const ok = window.confirm(`Delete inventory records for ${date}? This cannot be undone.`);
    if (!ok) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiPost('inventory.deleteDay', { date });
      setSuccess(`Deleted inventory for ${date}.`);
      await load({ silent: true });
      setDayClosed(false);
    } catch (e) {
      setError(e?.message || 'Failed to delete inventory for date');
    } finally {
      setSaving(false);
    }
  }

  async function toggleClosed() {
    const nextClosed = !dayClosed;
    if (nextClosed && rows.length) {
      const ok = window.confirm(
        `Mark ${date} as CLOSED?\n\nThis will reset IN/OUT to 0 and lock the day. Next open day will inherit QTY from the previous open day.`,
      );
      if (!ok) return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiPost('inventory.setClosed', { date, closed: nextClosed });
      if (nextClosed) {
        const from = res?.seededFrom ? ` (QTY from ${res.seededFrom} closing)` : '';
        setSuccess(`Marked ${date} as CLOSED${from}.`);
      } else {
        setSuccess(`Re-opened ${date}.`);
      }
      await load({ silent: true });
    } catch (e) {
      setError(e?.message || 'Failed to update CLOSED status');
    } finally {
      setSaving(false);
    }
  }

  async function rolloverDay() {
    const ok = window.confirm(
      'Rollover day will set Current_Qty = Closing_Qty for all items and reset IN/OUT to 0. Continue?',
    );
    if (!ok) return;
    const nextRows = rows.map((r) => {
      const closing = computeClosing(r);
      return {
        ...r,
        Current_Qty: closing,
        In_Stock: 0,
        Out_Stock: 0,
        Closing_Qty: closing,
      };
    });
    await submitInventory(nextRows);
  }

  async function copyExportText() {
    setError('');
    setSuccess('');
    const text = buildInventoryExportText(date, rows);
    try {
      await navigator.clipboard.writeText(text);
      setSuccess('Copied inventory summary to clipboard.');
    } catch {
      setError('Clipboard copy failed. Try manual select/copy.');
    }
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <FullscreenLoading show={!!overlay} title={overlay?.title} subtitle={overlay?.subtitle} />
      <div className="md-card w-full max-w-full p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">Daily Inventory</h1>
              {dayClosed ? (
                <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-extrabold tracking-wide text-white">
                  CLOSED
                </span>
              ) : null}
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Needs replenish <span className="md-badge-danger">{lowCount}</span>
              </span>
            </div>
            <p className="text-sm text-slate-600">Closing = QTY + IN − OUT.</p>
          </div>

          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-end">
            <div className="w-full sm:w-[180px]">
              <DateInput label="Date" value={date} onChange={setDate} />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
              <button
                type="button"
                className={[
                  'md-btn h-[42px] w-full sm:w-auto',
                  dayClosed ? 'bg-slate-900 text-white hover:bg-slate-800' : 'md-btn-outline',
                ].join(' ')}
                onClick={toggleClosed}
                disabled={saving || loading || seeding}
                aria-pressed={dayClosed}
                title="Toggle CLOSED for this date"
              >
                CLOSED
              </button>
              {q ? (
                <button
                  type="button"
                  className="md-btn md-btn-outline h-[42px] w-full sm:w-auto"
                  onClick={() => {
                    router.replace(pathname);
                  }}
                  title="Clear filter"
                >
                  Filter: {q} ×
                </button>
              ) : null}

              <button
                type="button"
                className="md-btn md-btn-outline h-[42px] w-full sm:w-auto"
                onClick={loadItemsTemplate}
                disabled={saving || loading || seeding || dayClosed}
              >
                Load Items
              </button>
              {/* <button
            type="button"
            onClick={rolloverDay}
            disabled={saving || loading || rows.length === 0}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
          >
            Rollover Day
          </button> */}

              <button
                type="button"
                className="md-btn md-btn-outline h-[42px] w-full sm:w-auto"
                onClick={deleteDay}
                disabled={saving || loading || seeding}
              >
                Delete Day
              </button>
              <button
                type="button"
                className="md-btn md-btn-outline h-[42px] w-full sm:w-auto"
                onClick={copyExportText}
                disabled={saving || loading || seeding || rows.length === 0}
              >
                Copy/Export Text
              </button>
              <button
                type="button"
                className="md-btn md-btn-primary h-[42px] w-full sm:w-auto"
                onClick={() => submitInventory()}
                disabled={saving || loading || rows.length === 0 || dayClosed}
              >
                {saving ? 'Saving…' : 'Submit Inventory'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={load} />
      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      {!loading && rows.length === 0 ? (
        <div className="md-card p-4 text-sm text-slate-600">
          {dayClosed ? (
            <span>This date is marked CLOSED.</span>
          ) : (
            <span>
              No inventory saved for this date yet. Click <span className="font-extrabold">Load Items</span> to start
              the daily list, then submit.
            </span>
          )}
        </div>
      ) : null}

      {/* Table kept in-place (Tailwind) for now */}

      {!loading && rows.length > 0 ? (
        <div className="md-table-wrap min-w-0 max-w-full overflow-x-auto overflow-y-hidden">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="md-table-head">
              <tr>
                <th className="sticky left-0 bg-slate-50 px-3 py-2 font-semibold shadow-[6px_0_14px_rgba(15,23,42,0.06)]">
                  Item
                </th>
                <th className="px-3 py-2 font-semibold">QTY</th>
                <th className="px-3 py-2 font-semibold">IN</th>
                <th className="px-3 py-2 font-semibold">OUT</th>
                <th className="px-3 py-2 font-semibold">Closing</th>
                {/* <th className="px-3 py-2 font-semibold">Threshold</th> */}
                {/* <th className="px-3 py-2 font-semibold">Status</th> */}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ r, idx }) => {
                const closing = computeClosing(r);
                const low = needsReplenish(r);
                // Sticky "Item" column must be opaque so scrolled cells don't show through.
                const rowBg = low ? 'bg-[#FCE4E8]' : 'bg-white';
                return (
                  <tr
                    key={`${r.Product}-${idx}`}
                    className={rowBg}
                  >
                    <td
                      className={[
                        'sticky left-0 px-3 py-2 font-medium',
                        rowBg,
                        'shadow-[6px_0_14px_rgba(15,23,42,0.06)]',
                      ].join(' ')}
                    >
                      <div className="max-w-[150px] truncate sm:max-w-none">{r.Product}</div>
                    </td>
                    {['Current_Qty', 'In_Stock', 'Out_Stock'].map((k) => (
                      <td key={k} className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            disabled={dayClosed || k === 'Current_Qty'}
                            inputMode="decimal"
                            value={r[k] ?? ''}
                            onChange={(e) => updateCell(idx, k, e.target.value)}
                            className="w-[50px] sm:w-11 rounded-2xl bg-white/80 px-1.5 py-1 text-sm ring-1 ring-slate-200/60 shadow-[inset_0_2px_10px_rgba(15,23,42,0.08)] focus:outline-none focus:ring-2 focus:ring-[#F3B0B8]"
                          />
                          {r.Unit ? (
                            <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{r.Unit}</span>
                          ) : null}
                        </div>
                      </td>
                    ))}
                    <td className="px-3 py-2 font-semibold">
                      <div className="flex items-center gap-1">
                        <span>{closing}</span>
                        {r.Unit ? <span className="whitespace-nowrap text-xs font-semibold text-slate-500">{r.Unit}</span> : null}
                      </div>
                    </td>
                    {/* <td className="px-3 py-2">
                      <input
                        disabled
                        inputMode="decimal"
                        value={r.Threshold_Limit ?? ''}
                        className="w-20 sm:w-24 rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-sm text-slate-700"
                      />
                    </td> */}
                    {/* <td className="px-3 py-2">
                      {low ? (
                        <span className="md-badge-warn">
                          Needs Replenish
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">OK</span>
                      )}
                    </td> */}
                  </tr>
                );
              })}
              {visibleRows.length === 0 ? (
                <tr className="border-t">
                  <td className="px-3 py-3 text-slate-600" colSpan={8}>
                    No items match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
