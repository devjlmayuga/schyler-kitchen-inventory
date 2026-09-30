'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, ReceiptText, Settings2, Trash2, Users } from 'lucide-react';
import LoadingSpinner from '../LoadingSpinner.jsx';
import { EmptyState } from '../ScreenControls.jsx';
import { AdminFeedback, AdminSaveBar } from './AdminFeedback.jsx';
import { apiGet, apiPost } from '../../lib/apiClient.js';
import { normalizePayroll, staffRate } from '../../lib/payroll.js';
import { nextExpenseKey } from '../../lib/admin.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const allWeekdays = () => WEEKDAYS.map((_, index) => index);

export default function SalesSettings({ onDirtyChange, onBusyChange }) {
  const [config, setConfig] = useState({ expenseBreakdown: [], staff: [] });
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [expense, setExpense] = useState('');
  const [staff, setStaff] = useState('');
  const request = useRef(0);
  const writeLock = useRef(false);
  const dirty = saved !== null && JSON.stringify(config) !== JSON.stringify(saved);
  const busy = loading || saving;
  useEffect(() => {
    onDirtyChange(dirty || !!expense.trim() || !!staff.trim());
    return () => onDirtyChange(false);
  }, [dirty, expense, staff, onDirtyChange]);
  useEffect(() => {
    onBusyChange(saving);
    return () => onBusyChange(false);
  }, [saving, onBusyChange]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const data = await apiGet('salesConfig.get');
      if (id !== request.current) return;
      const value = {
        ...data.config,
        payroll: normalizePayroll(data.config?.payroll),
        expenseBreakdown: data.config?.expenseBreakdown || [],
        staff: data.config?.staff || [],
        staffSchedules: Object.fromEntries(
          (data.config?.staff || []).map((name) => [
            name,
            data.config?.staffSchedules?.[name] || allWeekdays(),
          ]),
        ),
      };
      setConfig(value);
      setSaved(value);
    } catch (reason) {
      if (id === request.current) setError(reason.message || 'Unable to load settings.');
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
  function update(next) {
    setConfig(next);
    setSuccess('');
  }
  function addExpense(event) {
    event.preventDefault();
    const label = expense.trim();
    if (!label) return;
    setError('');
    if (config.expenseBreakdown.some((field) => field.label.trim().toLowerCase() === label.toLowerCase())) {
      setError('This expense category is already in the list.');
      return;
    }
    update({
      ...config,
      expenseBreakdown: [
        ...config.expenseBreakdown,
        { key: nextExpenseKey(label, config.expenseBreakdown), label },
      ],
    });
    setExpense('');
  }
  function addStaff(event) {
    event.preventDefault();
    const name = staff.trim();
    if (!name) return;
    setError('');
    if (config.staff.some((item) => item.toLowerCase() === name.toLowerCase())) {
      setError('This staff member is already in the list.');
      return;
    }
    update({
      ...config,
      staff: [...config.staff, name],
      staffSchedules: { ...config.staffSchedules, [name]: allWeekdays() },
    });
    setStaff('');
  }
  async function save() {
    if (busy || !saved || writeLock.current) return;
    setError('');
    setSuccess('');
    const fields = config.expenseBreakdown.map((field) => ({ ...field, label: field.label.trim() }));
    if (!fields.length || fields.some((field) => !field.label)) {
      setError('Keep at least one expense category, and give every category a name.');
      return;
    }
    if (new Set(fields.map((field) => field.label.toLowerCase())).size !== fields.length) {
      setError('Use a different name for each expense category.');
      return;
    }
    writeLock.current = true;
    setSaving(true);
    try {
      const next = { ...config, expenseBreakdown: fields, payroll: normalizePayroll(config.payroll) };
      await apiPost('salesConfig.save', { config: next });
      setConfig(next);
      setSaved(next);
      setSuccess('Sales settings saved.');
    } catch (reason) {
      setError(reason.message || 'Unable to save settings. Your edits are still here.');
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <AdminFeedback error={error} success={success} onRetry={!saved && !loading ? load : undefined} />
      <div>
        <h2 className="section-title">Sales settings</h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage expense categories, your team, weekly schedules and staff pay rates.
        </p>
      </div>
      {loading ? (
        <div className="md-card p-10">
          <LoadingSpinner label="Loading settings…" />
        </div>
      ) : !saved ? (
        <div className="md-card">
          <EmptyState icon={Settings2} title="Settings couldn’t be loaded">
            Retry above before making changes.
          </EmptyState>
        </div>
      ) : (
        <>
          <fieldset disabled={busy} className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
            <section className="md-card overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-100 p-5">
                <span className="admin-section-icon">
                  <ReceiptText size={19} />
                </span>
                <div>
                  <h3 className="section-title">Expense categories</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Names your team will see when recording expenses.
                  </p>
                </div>
              </div>
              <div className="space-y-3 p-5">
                {config.expenseBreakdown.map((field, index) => (
                  <div key={field.key} className="flex items-center gap-2">
                    <label className="min-w-0 flex-1">
                      <span className="sr-only">Expense category {index + 1}</span>
                      <input
                        className="md-input"
                        value={field.label}
                        maxLength={100}
                        onChange={(event) =>
                          update({
                            ...config,
                            expenseBreakdown: config.expenseBreakdown.map((item) =>
                              item.key === field.key ? { ...item, label: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="admin-icon-button text-slate-400 hover:text-red-700"
                      aria-label={`Remove expense ${field.label || index + 1}`}
                      onClick={() =>
                        update({
                          ...config,
                          expenseBreakdown: config.expenseBreakdown.filter((item) => item.key !== field.key),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <form className="flex gap-2 border-t border-slate-100 pt-4" onSubmit={addExpense}>
                  <input
                    className="md-input min-w-0 flex-1"
                    aria-label="New expense category"
                    placeholder="e.g. Gas, delivery…"
                    value={expense}
                    onChange={(event) => setExpense(event.target.value)}
                    maxLength={100}
                  />
                  <button
                    type="submit"
                    className="md-btn md-btn-outline px-3"
                    disabled={!expense.trim()}
                    aria-label="Add expense category"
                  >
                    <Plus size={17} />
                    Add
                  </button>
                </form>
              </div>
            </section>
            <section className="md-card overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-100 p-5">
                <span className="admin-section-icon">
                  <Users size={19} />
                </span>
                <div>
                  <h3 className="section-title">Staff</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Default work days and pay rates for each person.
                  </p>
                </div>
              </div>
              <div className="p-5">
                <label className="md-field mb-5">
                  <span className="md-label">Daily sales quota (₱)</span>
                  <input
                    className="md-input"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    aria-label="Daily sales quota"
                    value={config.payroll.quotaTarget}
                    onChange={(event) =>
                      update({ ...config, payroll: { ...config.payroll, quotaTarget: event.target.value } })
                    }
                  />
                  <span className="mt-1 text-xs leading-relaxed text-slate-500">
                    Each staff member on duty earns their bonus when shop sales exceed this amount.
                  </span>
                </label>
                <form className="flex gap-2" onSubmit={addStaff}>
                  <input
                    className="md-input min-w-0 flex-1"
                    aria-label="New staff member"
                    placeholder="Staff name"
                    maxLength={100}
                    value={staff}
                    onChange={(event) => setStaff(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="md-btn md-btn-outline px-3"
                    disabled={!staff.trim()}
                    aria-label="Add staff member"
                  >
                    <Plus size={17} />
                    Add
                  </button>
                </form>
                {config.staff.length ? (
                  <ul className="mt-4 divide-y divide-slate-100">
                    {config.staff.map((name) => (
                      <li key={name} className="py-4">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                            {name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-800">
                            {name}
                          </span>
                          <button
                            type="button"
                            className="admin-icon-button text-slate-400 hover:text-red-700"
                            aria-label={`Remove staff ${name}`}
                            onClick={() => {
                              const staffSchedules = { ...config.staffSchedules };
                              delete staffSchedules[name];
                              update({
                                ...config,
                                staff: config.staff.filter((item) => item !== name),
                                staffSchedules,
                              });
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <fieldset className="mt-4">
                          <legend className="md-label">Regular weekly schedule</legend>
                          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                            {WEEKDAYS.map((day, index) => {
                              const selected = (config.staffSchedules?.[name] || []).includes(index);
                              return (
                                <label
                                  key={day}
                                  className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-xs font-semibold transition ${
                                    selected
                                      ? 'border-[var(--p-3)] bg-[var(--brand-soft)] text-[var(--p-4)]'
                                      : 'border-slate-200 bg-white text-slate-500'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    className="sr-only"
                                    aria-label={`${name} scheduled every ${day}`}
                                    checked={selected}
                                    onChange={(event) => {
                                      const current = config.staffSchedules?.[name] || [];
                                      const schedule = event.target.checked
                                        ? [...current, index].sort((left, right) => left - right)
                                        : current.filter((value) => value !== index);
                                      update({
                                        ...config,
                                        staffSchedules: { ...config.staffSchedules, [name]: schedule },
                                      });
                                    }}
                                  />
                                  {day}
                                </label>
                              );
                            })}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            Used as the default Sunday–Saturday plan. You can adjust a specific week in Attendance.
                          </p>
                        </fieldset>
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {[
                            ['dailyRate', 'Daily pay (₱)'],
                            ['quotaBonus', 'Quota bonus (₱)'],
                            ['otRate', 'OT / hour (₱)'],
                          ].map(([key, label]) => (
                            <label
                              className={`md-field ${key === 'dailyRate' ? 'col-span-2 sm:col-span-1' : ''}`}
                              key={key}
                            >
                              <span className="md-label">{label}</span>
                              <input
                                className="md-input"
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                aria-label={`${name} ${label}`}
                                placeholder={key === 'dailyRate' ? 'Set rate' : '50'}
                                value={staffRate(config.payroll, name)[key] ?? ''}
                                onChange={(event) =>
                                  update({
                                    ...config,
                                    payroll: {
                                      ...config.payroll,
                                      staffRates: {
                                        ...config.payroll.staffRates,
                                        [name]: {
                                          ...staffRate(config.payroll, name),
                                          [key]: event.target.value,
                                        },
                                      },
                                    },
                                  })
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={Users} title="Add your team">
                    Staff added here will appear in Sales and Attendance.
                  </EmptyState>
                )}
              </div>
            </section>
          </fieldset>
          <AdminSaveBar
            dirty={dirty}
            pendingDraft={!!expense.trim() || !!staff.trim()}
            saving={saving}
            onSave={save}
            label="Save settings"
            onDiscard={() => {
              if (window.confirm('Discard your unsaved settings?')) {
                setConfig(saved);
                setExpense('');
                setStaff('');
                setSuccess('');
              }
            }}
          />
        </>
      )}
    </div>
  );
}
