'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FullscreenLoading from '../components/FullscreenLoading.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import DateInput from '../components/inputs/DateInput.jsx';
import { apiGet, apiPost } from '../lib/googleSheetsApi.js';
import { isoDateToday } from '../lib/dates.js';
import { formatMoney, parseMoney } from '../lib/money.js';
import TextInput from '../components/inputs/TextInput.jsx';

function Stat({ label, value }) {
  return (
    <div className="md-card flex items-center justify-between gap-3 px-3 py-1.5">
      <div className="min-w-0">
        <div className="md-label truncate">{label}</div>
      </div>
      <div className="shrink-0 text-sm font-black text-slate-900">{value}</div>
    </div>
  );
}

function buildSalesExportText({ date, salesValue, breakdownFields, breakdownValues, staffList, staffExpenses, calc, productSales }) {
  const lines = [];
  lines.push(`Sales & Ledger - ${date}`);
  lines.push('');
  lines.push(`Takoyaki Sales: ${formatMoney(calc.takoyakiSales)}`);
  lines.push('');
  if (productSales && Array.isArray(productSales.categories) && productSales.categories.length) {
    lines.push('Products Sold (by category):');
    productSales.categories.forEach((cat) => {
      lines.push(`- ${cat.category}: ${formatMoney(cat.total)}`);
      cat.lines.forEach((line) => {
        if (!line.qty) return;
        lines.push(`  • ${line.Name} x${line.qty} @ ${formatMoney(line.Price)} = ${formatMoney(line.lineTotal)}`);
      });
    });
    lines.push('');
  }
  lines.push('Expenses Breakdown:');
  breakdownFields.forEach((f) => {
    const v = parseMoney(breakdownValues?.[f.key]);
    lines.push(`- ${f.label || f.key}: ${formatMoney(v)}`);
  });
  if (Array.isArray(staffList) && staffList.length) {
    const anyStaff = staffList.some((name) => parseMoney(staffExpenses?.[name]) > 0);
    if (anyStaff) {
      lines.push('');
      lines.push('Staff Payouts (Expenses):');
      staffList.forEach((name) => {
        const v = parseMoney(staffExpenses?.[name]);
        if (!v) return;
        lines.push(`- ${name}: ${formatMoney(v)}`);
      });
    }
  }
  lines.push('');
  lines.push(`Expenses Total: ${formatMoney(calc.expensesTotal)}`);
  lines.push(`Net Cash (Sales - Expenses): ${formatMoney(calc.netCash)}`);
  lines.push(`Add Cash (Previous Cash): ${formatMoney(calc.previousCashAdded)}`);
  lines.push(`Total Cash (Net + Add Cash): ${formatMoney(calc.totalCash)}`);

  // Include raw sales input for reference (in case user typed commas etc)
  if (String(salesValue || '').trim() && String(salesValue || '').trim() !== String(calc.takoyakiSales)) {
    lines.push('');
    lines.push(`(Input Sales: ${String(salesValue).trim()})`);
  }

  return lines.join('\n').trim();
}

const DEFAULT_SALES_CONFIG = {
  expenseBreakdown: [
    { key: 'Breakdown_Allow', label: 'Allow' },
    { key: 'Breakdown_Ipon', label: 'Ipon' },
    { key: 'Breakdown_Bill', label: 'Bill' },
    { key: 'Breakdown_Ilaw', label: 'Ilaw' },
  ],
  staff: [],
};

export default function SalesPage() {
  const [date, setDate] = useState(isoDateToday());
  const [sales, setSales] = useState('');
  const [breakdownValues, setBreakdownValues] = useState({});
  const [addCash, setAddCash] = useState('');
  const [staff, setStaff] = useState('');
  const [staffExpenses, setStaffExpenses] = useState({});
  const [products, setProducts] = useState([]);
  const [soldQtyByName, setSoldQtyByName] = useState({});

  const [saving, setSaving] = useState(false);
  const [loadingByDate, setLoadingByDate] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [config, setConfig] = useState(DEFAULT_SALES_CONFIG);

  const [showRecent, setShowRecent] = useState(false);
  const [recentRows, setRecentRows] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState('');
  const [fromDate, setFromDate] = useState(isoDateToday());
  const [toDate, setToDate] = useState(isoDateToday());

  const activeProducts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];
    return list
      .filter((p) => String(p.Active || 'Y').toUpperCase() !== 'N')
      .map((p) => ({
        Category: String(p.Category || '').trim() || 'Uncategorized',
        Name: String(p.Name || '').trim(),
        Price: parseMoney(p.Price),
      }))
      .filter((p) => p.Name);
  }, [products]);

  useEffect(() => {
    // Ensure qty map has keys for current products
    setSoldQtyByName((prev) => {
      const next = {};
      activeProducts.forEach((p) => {
        next[p.Name] = prev && typeof prev === 'object' ? prev[p.Name] ?? '' : '';
      });
      return next;
    });
  }, [activeProducts]);

  useEffect(() => {
    const list = Array.isArray(config.staff) ? config.staff : [];
    setStaffExpenses((prev) => {
      const next = {};
      list.forEach((name) => {
        next[name] = prev && typeof prev === 'object' ? prev[name] ?? '' : '';
      });
      return next;
    });
  }, [config.staff]);

  const breakdownFields = useMemo(() => {
    const fields = Array.isArray(config.expenseBreakdown) ? config.expenseBreakdown : [];
    return fields.length ? fields : DEFAULT_SALES_CONFIG.expenseBreakdown;
  }, [config.expenseBreakdown]);

  useEffect(() => {
    setBreakdownValues((prev) => {
      const next = {};
      breakdownFields.forEach((f) => {
        next[f.key] = prev && typeof prev === 'object' ? prev[f.key] ?? '' : '';
      });
      return next;
    });
  }, [breakdownFields]);

  const productSales = useMemo(() => {
    const byCategory = new Map();
    let total = 0;
    activeProducts.forEach((p) => {
      const qty = parseMoney(soldQtyByName?.[p.Name]);
      const lineTotal = qty * p.Price;
      total += lineTotal;
      const cat = p.Category || 'Uncategorized';
      const cur = byCategory.get(cat) || { category: cat, total: 0, lines: [] };
      cur.total += lineTotal;
      cur.lines.push({ ...p, qty, lineTotal });
      byCategory.set(cat, cur);
    });
    const categories = Array.from(byCategory.values()).sort((a, b) => a.category.localeCompare(b.category));
    categories.forEach((c) => c.lines.sort((a, b) => a.Name.localeCompare(b.Name)));
    return { categories, total };
  }, [activeProducts, soldQtyByName]);

  const calc = useMemo(() => {
    const hasProductMode = activeProducts.length > 0;
    const takoyakiSales = hasProductMode ? productSales.total : parseMoney(sales);
    const breakdownTotal = breakdownFields.reduce((sum, f) => sum + parseMoney(breakdownValues?.[f.key]), 0);
    const staffTotal = (Array.isArray(config.staff) ? config.staff : []).reduce(
      (sum, name) => sum + parseMoney(staffExpenses?.[name]),
      0,
    );
    const expensesTotal = breakdownTotal + staffTotal;
    const previousCashAdded = parseMoney(addCash);
    const netCash = takoyakiSales - expensesTotal;
    const totalCash = netCash + previousCashAdded;
    return {
      takoyakiSales,
      hasProductMode,
      breakdownTotal,
      staffTotal,
      expensesTotal,
      netCash,
      totalCash,
      previousCashAdded,
    };
  }, [activeProducts.length, addCash, breakdownFields, breakdownValues, config.staff, productSales.total, sales, staffExpenses]);

  const loadByDate = useCallback(async () => {
    setError('');
    setSuccess('');
    setLoadingByDate(true);
    try {
      const data = await apiGet('sales.bootstrap', { date });
      const nextConfig = { ...DEFAULT_SALES_CONFIG, ...(data?.config || {}) };
      setConfig(nextConfig);
      setProducts(Array.isArray(data?.products) ? data.products : []);

      const fields = Array.isArray(nextConfig.expenseBreakdown) && nextConfig.expenseBreakdown.length
        ? nextConfig.expenseBreakdown
        : DEFAULT_SALES_CONFIG.expenseBreakdown;

      const staffList = Array.isArray(nextConfig.staff) ? nextConfig.staff : [];

      const row = data?.row || null;
      if (!row) {
        setSales('');
        setBreakdownValues(() => Object.fromEntries(fields.map((f) => [f.key, ''])));
        setSoldQtyByName({});
        setAddCash('');
        setStaff('');
        setStaffExpenses({});
        return;
      }
      setSales(String(row.Takoyaki_Sales ?? ''));
      setBreakdownValues(() => Object.fromEntries(fields.map((f) => [f.key, String(row?.[f.key] ?? '')])));
      setAddCash(String(row.Previous_Cash_Added ?? ''));
      setStaff(String(row.Staff ?? ''));
      const rawProducts = row.Product_Sales_JSON;
      if (rawProducts) {
        try {
          const parsed = typeof rawProducts === 'string' ? JSON.parse(rawProducts) : rawProducts;
          const obj = parsed && typeof parsed === 'object' ? parsed : {};
          setSoldQtyByName(() => {
            const next = {};
            Object.keys(obj).forEach((k) => {
              next[k] = String(obj[k] ?? '');
            });
            return next;
          });
        } catch {
          setSoldQtyByName({});
        }
      } else {
        setSoldQtyByName({});
      }
      const rawStaff = row.Staff_Expenses_JSON;
      if (rawStaff) {
        try {
          const parsed = typeof rawStaff === 'string' ? JSON.parse(rawStaff) : rawStaff;
          const obj = parsed && typeof parsed === 'object' ? parsed : {};
          setStaffExpenses(() => {
            const next = {};
            Object.keys(obj).forEach((k) => {
              next[k] = String(obj[k] ?? '');
            });
            return next;
          });
        } catch {
          setStaffExpenses({});
        }
      } else {
        setStaffExpenses(() => Object.fromEntries(staffList.map((name) => [name, ''])));
      }
    } catch (e) {
      setError(e?.message || 'Failed to load ledger for date');
    } finally {
      setLoadingByDate(false);
    }
  }, [date]);

  useEffect(() => {
    loadByDate();
  }, [loadByDate]);

  async function save() {
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const staffMap = {};
      (Array.isArray(config.staff) ? config.staff : []).forEach((name) => {
        const amount = parseMoney(staffExpenses?.[name]);
        if (!amount) return;
        staffMap[name] = amount;
      });
      const breakdownNumbers = {};
      breakdownFields.forEach((f) => {
        breakdownNumbers[f.key] = parseMoney(breakdownValues?.[f.key]);
      });
      const productQtyMap = {};
      activeProducts.forEach((p) => {
        const qty = parseMoney(soldQtyByName?.[p.Name]);
        if (!qty) return;
        productQtyMap[p.Name] = qty;
      });
      await apiPost('salesFinance.upsertByDate', {
        date,
        row: {
          Takoyaki_Sales: calc.takoyakiSales,
          ...breakdownNumbers,
          Previous_Cash_Added: calc.previousCashAdded,
          Staff: staff,
          Staff_Expenses_JSON: Object.keys(staffMap).length ? JSON.stringify(staffMap) : '',
          Product_Sales_JSON: Object.keys(productQtyMap).length ? JSON.stringify(productQtyMap) : '',
        },
      });
      setSuccess(`Saved ledger for ${date}.`);
    } catch (e) {
      setError(e?.message || 'Failed to save ledger entry');
    } finally {
      setSaving(false);
    }
  }

  async function deleteByDate() {
    const ok = window.confirm(`Delete ledger for ${date}? This cannot be undone.`);
    if (!ok) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await apiPost('salesFinance.deleteByDate', { date });
      setSuccess(`Deleted ledger for ${date}.`);
      await loadByDate();
    } catch (e) {
      setError(e?.message || 'Failed to delete ledger');
    } finally {
      setSaving(false);
    }
  }

  const loadRecent = useCallback(async () => {
    setRecentError('');
    setRecentLoading(true);
    try {
      const data = await apiGet('salesFinance.list', { from: fromDate, to: toDate });
      setRecentRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setRecentError(e?.message || 'Failed to load recent entries');
    } finally {
      setRecentLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!showRecent) return;
    loadRecent();
  }, [loadRecent, showRecent]);

  const overlay = saving
    ? { title: 'Saving ledger…', subtitle: `Date: ${date}` }
    : loadingByDate
      ? { title: 'Loading ledger…', subtitle: `Date: ${date}` }
      : null;

  async function copyText() {
    setError('');
    setSuccess('');
    const text = buildSalesExportText({
      date,
      salesValue: sales,
      breakdownFields,
      breakdownValues,
      staffList: Array.isArray(config.staff) ? config.staff : [],
      staffExpenses,
      calc,
      productSales,
    });
    try {
      await navigator.clipboard.writeText(text);
      setSuccess('Copied sales summary to clipboard.');
    } catch {
      setError('Clipboard copy failed. Try manual select/copy.');
    }
  }

  return (
    <div className="space-y-4">
      <FullscreenLoading show={!!overlay} title={overlay?.title} subtitle={overlay?.subtitle} />
      <div className="md-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">Sales & Financial Ledger</h1>
            <p className="text-sm text-slate-600">Totals update instantly as you type.</p>
          </div>
          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-end">
            <div className="w-full sm:w-[180px]">
              <DateInput label="Date" value={date} onChange={setDate} />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:gap-2">
              <button
                type="button"
                onClick={loadByDate}
                className="md-btn md-btn-outline h-[42px] w-full sm:w-auto"
              >
                Load
              </button>
              <button
                type="button"
                onClick={deleteByDate}
                disabled={saving}
                className="md-btn md-btn-outline h-[42px] w-full sm:w-auto"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={copyText}
                disabled={loadingByDate}
                className="md-btn md-btn-primary h-[42px] w-full sm:w-auto"
              >
                Copy/Export Text
              </button>
            </div>
          </div>
        </div>
      </div>

      <ErrorBanner message={error} />
      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="order-2 space-y-3 lg:order-1 lg:col-span-2">
          <div className="md-card p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput
                label="Total Sales"
                value={calc.hasProductMode ? String(calc.takoyakiSales) : sales}
                onChange={setSales}
                inputMode="decimal"
                disabled={calc.hasProductMode}
              />
              <TextInput
                label="Add Cash (Previous Cash)"
                value={addCash}
                onChange={setAddCash}
                inputMode="decimal"
              />
            </div>

            {activeProducts.length ? (
              <div className="mt-5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-slate-900">Products Sold (by category)</div>
                    <div className="text-xs text-slate-600">Enter quantities sold. Sales total updates automatically.</div>
                  </div>
                  <div className="md-chip">Total: {formatMoney(productSales.total)}</div>
                </div>

                <div className="mt-3 space-y-3">
                  {productSales.categories.map((cat) => (
                    <div key={cat.category} className="rounded-2xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-extrabold text-slate-900">{cat.category}</div>
                        <div className="text-sm font-black text-slate-900">{formatMoney(cat.total)}</div>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {cat.lines.map((line) => (
                          <div key={line.Name} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-slate-900">{line.Name}</div>
                              <div className="text-xs font-semibold text-slate-600">@ {formatMoney(line.Price)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                inputMode="decimal"
                                value={soldQtyByName?.[line.Name] ?? ''}
                                onChange={(e) => setSoldQtyByName((prev) => ({ ...(prev || {}), [line.Name]: e.target.value }))}
                                className="h-[42px] w-[72px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-200"
                                placeholder="0"
                              />
                              <div className="w-[92px] text-right text-sm font-black text-slate-900">
                                {formatMoney(line.lineTotal)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {productSales.categories.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      No active products configured yet. Add products in Admin → Products.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-600">Expenses Breakdown</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {breakdownFields.map((f) => (
                  <TextInput
                    key={f.key}
                    label={f.label || f.key}
                    value={breakdownValues?.[f.key] ?? ''}
                    onChange={(v) => setBreakdownValues((prev) => ({ ...(prev || {}), [f.key]: v }))}
                    inputMode="decimal"
                  />
                ))}
              </div>
              </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-600">Staff Payouts (Expenses)</div>
              {Array.isArray(config.staff) && config.staff.length ? (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {config.staff.map((name) => (
                    <TextInput
                      key={name}
                      label={name}
                      value={staffExpenses?.[name] ?? ''}
                      onChange={(v) => setStaffExpenses((prev) => ({ ...(prev || {}), [name]: v }))}
                      inputMode="decimal"
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                  No staff configured yet. Add staff in Admin → Sales.
                </div>
              )}
            </div>

            {/* {Array.isArray(config.staff) && config.staff.length ? (
              <div className="mt-4">
                <div className="text-xs font-semibold text-slate-600">Staff on Duty (Optional)</div>
                <select
                  value={staff}
                  onChange={(e) => setStaff(e.target.value)}
                  className="md-select mt-2"
                >
                  <option value="">Select staff…</option>
                  {config.staff.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : null} */}
          </div>
        </div>

        <div className="order-1 lg:order-2 lg:self-start">
          <div className="md-card p-4">
            <div className="grid content-start gap-1">
              <div className="grid gap-1 md:grid-cols-2 lg:grid-cols-1">
                <Stat label="Expenses Total" value={calc.expensesTotal} />
                <Stat label="Total Cash (Sales − Expenses + Add Cash)" value={calc.totalCash} />
              </div>
              <div className="grid gap-1 md:grid-cols-2 lg:grid-cols-1">
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="md-btn md-btn-primary h-[42px] w-full"
                >
                  {saving ? 'Saving…' : 'Save Daily Ledger'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRecent((v) => !v)}
                  className="md-btn md-btn-outline h-[42px] w-full"
                >
                  {showRecent ? 'Hide Recent' : 'Show Recent'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showRecent ? (
        <div className="md-card p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Recent entries</div>
              <div className="text-xs text-slate-600">Filtered by date range (sheet timestamps).</div>
            </div>
            <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-end">
              <div className="w-full sm:w-[160px]">
                <DateInput label="From" value={fromDate} onChange={setFromDate} />
              </div>
              <div className="w-full sm:w-[160px]">
                <DateInput label="To" value={toDate} onChange={setToDate} />
              </div>
              <button
                type="button"
                onClick={loadRecent}
                disabled={recentLoading}
                className="md-btn md-btn-primary h-[42px] w-full sm:w-auto"
              >
                Refresh
              </button>
            </div>
          </div>

          {recentLoading ? (
            <div className="mt-3">
              <LoadingSpinner label="Loading recent entries…" />
            </div>
          ) : null}
          <ErrorBanner message={recentError} onRetry={loadRecent} />

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[900px] w-full text-left text-sm">
              <thead className="md-table-head">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Sales</th>
                  <th className="px-3 py-2 font-semibold">Expenses</th>
                  <th className="px-3 py-2 font-semibold">Final Cash</th>
                  <th className="px-3 py-2 font-semibold">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((r, idx) => (
                  <tr key={`${r.Date}-${idx}`} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.Date}</td>
                    <td className="px-3 py-2">{r.Takoyaki_Sales}</td>
                    <td className="px-3 py-2">{r.Expenses_Total}</td>
                    <td className="px-3 py-2">{r.Final_Total_Cash}</td>
                    <td className="px-3 py-2">{r.Remaining_Balance}</td>
                  </tr>
                ))}
                {recentRows.length === 0 && !recentLoading ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-600" colSpan={5}>
                      No entries for this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
