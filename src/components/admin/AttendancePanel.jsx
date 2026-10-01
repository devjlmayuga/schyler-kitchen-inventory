'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Clock3, Printer, RefreshCw, Users } from 'lucide-react';
import DateInput from '../inputs/DateInput.jsx';
import LoadingSpinner from '../LoadingSpinner.jsx';
import FaceAttendancePanel from '../FaceAttendancePanel.jsx';
import { EmptyState, SearchField } from '../ScreenControls.jsx';
import { AdminFeedback, AdminSaveBar } from './AdminFeedback.jsx';
import PayslipPreview from './PayslipPreview.jsx';
import AttendanceDaysModal from './AttendanceDaysModal.jsx';
import { apiGet, apiPost } from '../../lib/apiClient.js';
import { isoDateToday } from '../../lib/dates.js';
import { addDays, weekStart } from '../../lib/admin.js';
import { buildPayslip, normalizeAttendance, normalizePayroll, staffRate } from '../../lib/payroll.js';
import { peso } from '../../lib/sales.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const recordFor = (records, staff, date) =>
  records.find((record) => record.staff === staff && record.date === date);
const eventTime = (raw) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(raw));

export default function AttendancePanel({ onOpenSettings, onDirtyChange, onBusyChange }) {
  const currentWeek = weekStart(isoDateToday());
  const [week, setWeek] = useState(currentWeek);
  const [staff, setStaff] = useState([]);
  const [records, setRecords] = useState([]);
  const [saved, setSaved] = useState([]);
  const [payroll, setPayroll] = useState(normalizePayroll());
  const [salesByDate, setSalesByDate] = useState({});
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [query, setQuery] = useState('');
  const [showFace, setShowFace] = useState(false);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState(null);
  const request = useRef(0);
  const writeLock = useRef(false);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week]);
  const dirty = ready && JSON.stringify(records) !== JSON.stringify(saved);
  const busy = loading || saving;
  const needsReview = records.some((record) => !record.rates);
  const names = [...new Set([...staff, ...records.map((record) => record.staff)])];
  const visibleEvents = events.filter((event) =>
    String(event.staff || '')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const payslips = useMemo(() => {
    try {
      return {
        items: Object.fromEntries(
          [...new Set(records.map((record) => record.staff))].map((name) => [
            name,
            buildPayslip(name, week, records, salesByDate, payroll),
          ]),
        ),
      };
    } catch (reason) {
      return { items: {}, error: reason.message };
    }
  }, [records, week, salesByDate, payroll]);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(saving);
    return () => onBusyChange(false);
  }, [saving, onBusyChange]);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setReady(false);
    setError('');
    setSuccess('');
    try {
      const [data, eventData, settings] = await Promise.all([
        apiGet('attendance.listWeek', { weekStart: week }),
        apiGet('face.eventsWeek', { weekStart: week }),
        apiGet('salesConfig.get'),
      ]);
      if (id !== request.current) return;
      const members = settings.config?.staff || [];
      const allNames = [...new Set([...members, ...(data.records || []).map((record) => record.staff)])];
      const entries = allNames.flatMap((name) =>
        days.map((date) => {
          const existing = (data.records || []).find(
            (record) => record.staff === name && record.date === date,
          );
          return { date, staff: name, scheduled: false, onDuty: false, overtimeHours: 0, ...existing };
        }),
      );
      setStaff(members);
      setRecords(entries);
      setSaved(entries);
      setPayroll(normalizePayroll(data.payroll || settings.config?.payroll));
      setSalesByDate(data.salesByDate || {});
      setEvents(
        [...(eventData.events || [])].sort((a, b) =>
          String(b.event_time).localeCompare(String(a.event_time)),
        ),
      );
      setSelected('');
      setReady(true);
    } catch (reason) {
      if (id === request.current) setError(reason.message || 'Unable to load attendance.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [week, days]);
  useEffect(() => {
    load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  function canDiscard() {
    return !dirty || window.confirm('Discard unsaved attendance changes?');
  }
  function changeWeek(next) {
    if (busy || next === week || !canDiscard()) return;
    setWeek(next);
  }
  function update(date, change) {
    setSuccess('');
    setRecords((entries) =>
      entries.map((record) =>
        record.staff === selected && record.date === date ? { ...record, ...change } : record,
      ),
    );
  }
  async function save() {
    if (busy || !ready || writeLock.current) return false;
    writeLock.current = true;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const next = normalizeAttendance(records, week, payroll);
      const data = await apiPost('attendance.saveWeek', { weekStart: week, records: next });
      const entries = data.records || next;
      setRecords(entries);
      setSaved(entries);
      setSuccess('Attendance and pay rates saved. Staff with daily rates can print their payslips.');
      return true;
    } catch (reason) {
      setError(reason.message || 'Unable to save attendance. Your edits are still here.');
      return false;
    } finally {
      writeLock.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h2 className="section-title">Attendance & pay</h2>
          <p className="mt-1 text-sm text-slate-500">
            Review duty, add overtime and print weekly staff payslips.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <button
            className="admin-icon-button"
            disabled={busy}
            aria-label="Previous week"
            onClick={() => changeWeek(addDays(week, -7))}
          >
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <DateInput
              label="Week containing"
              value={week}
              disabled={busy}
              onChange={(value) => {
                if (value) changeWeek(weekStart(value));
              }}
            />
          </div>
          <button
            className="admin-icon-button"
            disabled={busy}
            aria-label="Next week"
            onClick={() => changeWeek(addDays(week, 7))}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      {week !== currentWeek && (
        <button
          className="text-xs font-semibold text-[var(--p-4)]"
          disabled={busy}
          onClick={() => changeWeek(currentWeek)}
        >
          Back to this week
        </button>
      )}
      <AdminFeedback
        error={error || payslips.error}
        success={success}
        onRetry={!ready && !loading ? load : undefined}
      />
      {loading ? (
        <div className="md-card p-10">
          <LoadingSpinner label="Loading attendance…" />
        </div>
      ) : !ready ? (
        <div className="md-card">
          <EmptyState icon={Users} title="Attendance couldn’t be loaded">
            Retry to view this week.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="md-card overflow-hidden" aria-label="Weekly attendance">
            <div className="border-b border-slate-100 p-5">
              <h3 className="section-title">
                {week} – {addDays(week, 6)}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Set each staff member's schedule for this week, then record actual duty and overtime. Quota:
                daily sales above {peso(payroll.quotaTarget)}.
              </p>
            </div>
            {names.length ? (
              <ul className="divide-y divide-slate-100">
                {names.map((name) => {
                  const slip = payslips.items[name];
                  const scheduledDays = records.filter(
                    (record) => record.staff === name && record.scheduled,
                  ).length;
                  const unsavedRates = records.some((record) => record.staff === name && !record.rates);
                  return (
                    <li key={name} className="p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-slate-800">{name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {scheduledDays} scheduled · {slip?.totals.days || 0} worked ·{' '}
                            {slip?.totals.quotaDays || 0} quota days · {slip?.totals.overtimeHours || 0}h OT
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="mr-2 text-sm font-semibold tabular-nums">
                            {slip?.missingRate
                              ? 'Set daily rate'
                              : slip
                                ? peso(slip.totals.total)
                                : 'Check hours'}
                          </span>
                          <button
                            className="md-btn md-btn-outline min-h-11"
                            aria-label={`Edit attendance for ${name}`}
                            aria-haspopup="dialog"
                            disabled={busy}
                            onClick={() => setSelected(name)}
                          >
                            Schedule & days
                          </button>
                          <button
                            className="md-btn md-btn-outline min-h-11"

                            aria-label={`Payslip for ${name}`}
                            onClick={() => setPreview(slip)}
                          >
                            <Printer size={16} />
                            Payslip
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-7 gap-1 sm:gap-3">
                        {days.map((date, index) => {
                          const day = slip?.days[index];
                          return (
                            <div
                              key={date}
                              className={`rounded-lg px-1 py-2 text-center ${day?.onDuty ? 'bg-[var(--brand-soft)] text-[var(--p-4)]' : recordFor(records, name, date)?.scheduled ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-400'}`}
                            >
                              <span className="block text-[10px]">
                                {DAYS[index]} {date.slice(8)}
                              </span>
                              <span className="mt-1 block text-xs font-semibold">
                                {day?.onDuty ? 'Duty' : recordFor(records, name, date)?.scheduled ? 'Scheduled' : 'Off'}
                              </span>
                              {day?.quotaHit && (
                                <span className="mt-1 block text-[10px] font-semibold">Quota</span>
                              )}
                              {day?.overtimeHours > 0 && (
                                <span className="block text-[10px]">{day.overtimeHours}h OT</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={Users} title="Add your team first">
                <p>Set staff and daily pay in Sales settings.</p>
                <button className="md-btn md-btn-outline mt-4" onClick={onOpenSettings}>
                  Open sales settings
                </button>
              </EmptyState>
            )}
          </section>
          {!!selected && (
            <AttendanceDaysModal
              staff={selected}
              week={week}
              weekEnd={addDays(week, 6)}
              saving={saving}
              canSave={dirty || needsReview}
              dirty={dirty}
              error={error || payslips.error}
              onClose={() => setSelected('')}
              onSave={async () => {
                if (await save()) setSelected('');
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
                <div>
                  <h3 className="section-title">Daily details</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Schedule days can change every week. Salary uses actual duty, not scheduled days.
                  </p>
                </div>
                <button
                  className="text-xs font-semibold text-[var(--p-4)]"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Apply current pay settings to ${selected} for this week? This replaces saved rates.`,
                      )
                    )
                      return;
                    setRecords((entries) =>
                      entries.map((record) =>
                        record.staff === selected
                          ? {
                              ...record,
                              rates: { ...staffRate(payroll, selected), quotaTarget: payroll.quotaTarget },
                            }
                          : record,
                      ),
                    );
                    setSuccess('');
                  }}
                >
                  Use current pay settings
                </button>
              </div>
              <fieldset disabled={busy} className="min-w-0 divide-y divide-slate-100">
                {days.map((date, index) => {
                  const record = records.find((entry) => entry.staff === selected && entry.date === date);
                  if (!record) return null;
                  const rate = record.rates || {
                    ...staffRate(payroll, selected),
                    quotaTarget: payroll.quotaTarget,
                  };
                  const quotaHit = record.onDuty && Number(salesByDate[date] || 0) > rate.quotaTarget;
                  return (
                    <div
                      key={date}
                      className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-[90px_95px_80px_minmax(0,1fr)_135px] sm:items-center sm:p-5"
                    >
                      <div>
                        <p className="text-sm font-semibold">
                          {DAYS[index]} {date.slice(5)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {record.onDuty
                            ? rate.dailyRate == null
                              ? 'Rate not set'
                              : `${peso(rate.dailyRate)} / day`
                            : 'Off duty'}
                        </p>
                      </div>
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        {/* <input
                          type="checkbox"
                          className="h-4 w-4 accent-amber-600"
                          aria-label={`${selected} scheduled ${date}`}
                          checked={record.scheduled}
                          onChange={(event) => update(date, { scheduled: event.target.checked })}
                        />
                        Scheduled */}
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--p-3)]"
                          aria-label={`${selected} on duty ${date}`}
                          checked={record.onDuty}
                          onChange={(event) =>
                            update(date, {
                              onDuty: event.target.checked,
                              ...(!event.target.checked ? { overtimeHours: 0 } : {}),
                            })
                          }
                        />
                        On duty
                      </label>
                      <div className="text-xs text-slate-500">
                        <p>Shop sales {peso(salesByDate[date])}</p>
                        <p className={`mt-1 ${quotaHit ? 'font-semibold text-[var(--p-4)]' : ''}`}>
                          {quotaHit ? `Quota hit · +${peso(rate.quotaBonus)}` : 'No quota bonus'}
                        </p>
                      </div>
                      <div>
                        <label className="flex items-center gap-2 text-xs font-medium">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[var(--p-3)]"
                            aria-label={`${selected} overtime ${date}`}
                            disabled={!record.onDuty}
                            checked={Number(record.overtimeHours) > 0}
                            onChange={(event) =>
                              update(date, { overtimeHours: event.target.checked ? 1 : 0 })
                            }
                          />
                          Overtime
                        </label>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            className="md-input w-full"
                            aria-label={`${selected} OT hours ${date}`}
                            type="number"
                            min="0"
                            max="24"
                            step="0.25"
                            inputMode="decimal"
                            disabled={!record.onDuty}
                            value={record.overtimeHours}
                            onChange={(event) => update(date, { overtimeHours: event.target.value })}
                          />
                          <span className="text-xs text-slate-500">hrs</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </fieldset>
              <div className="border-t border-slate-100 p-5 text-xs text-slate-500">
                Save attendance before printing. Set missing daily rates in{' '}
                <button className="font-semibold text-[var(--p-4)]" onClick={onOpenSettings}>
                  Sales settings
                </button>
                , then apply current pay settings above. Printing does not record a cash payout.
              </div>
            </AttendanceDaysModal>
          )}
          {!!names.length && (
            <AdminSaveBar
              dirty={dirty || needsReview}
              saving={saving}
              onSave={save}
              label="Save attendance"
              onDiscard={() => {
                if (canDiscard()) setRecords(saved);
              }}
            />
          )}
          <section className="md-card overflow-hidden" aria-label="Clock activity">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
              <div>
                <h3 className="section-title">Clock activity</h3>
                <p className="mt-1 text-xs text-slate-500">Latest first · Manila time</p>
              </div>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 sm:w-56">
                  <SearchField value={query} onChange={setQuery} placeholder="Find staff…" />
                </div>
                <button
                  className="admin-icon-button shrink-0"
                  aria-label="Refresh attendance"
                  disabled={busy}
                  onClick={() => {
                    if (canDiscard()) load();
                  }}
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
            {visibleEvents.length ? (
              <ul className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
                {visibleEvents.map((event, index) => (
                  <li
                    key={event.id || `${event.event_time}-${index}`}
                    className="flex items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{event.staff || 'Unknown staff'}</p>
                      <p className="mt-1 text-xs text-slate-500">{eventTime(event.event_time)}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${event.event_type === 'CHECK_IN' ? 'bg-[var(--brand-soft)] text-[var(--p-4)]' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {event.event_type === 'CHECK_IN' ? 'Time in' : 'Time out'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={Clock3}
                title={query ? 'No matching clock activity' : 'No clock activity this week'}
              >
                {query ? 'Try another name.' : 'Staff time-in and time-out records will appear here.'}
              </EmptyState>
            )}
          </section>
        </>
      )}
      <section className="space-y-4">
        <button
          className="md-btn md-btn-outline min-h-11"
          aria-expanded={showFace}
          disabled={!ready || dirty || saving}
          onClick={() => setShowFace((value) => !value)}
        >
          <Camera size={17} />
          {showFace ? 'Close face attendance' : 'Manage face attendance'}
        </button>
        {showFace && (
          <FaceAttendancePanel
            staff={staff}
            onRecorded={() => {
              if (canDiscard()) load();
            }}
          />
        )}
      </section>
      {preview && <PayslipPreview payslip={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
