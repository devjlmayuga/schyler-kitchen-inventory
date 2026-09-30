import { addDays } from './admin.js';

export const DEFAULT_PAYROLL = { quotaTarget: 4000, staffRates: {} };
export const DEFAULT_STAFF_RATE = { dailyRate: null, quotaBonus: 50, otRate: 50 };
const money = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function amount(value, label, nullable = false) {
  if (value === '' || value == null) {
    if (nullable) return null;
    throw new Error(`${label} is required.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10000000)
    throw new Error(`${label} must be between 0 and 10,000,000.`);
  return money(number);
}

export function normalizePayroll(value = {}) {
  const config = value || {};
  return {
    quotaTarget: amount(config.quotaTarget ?? 4000, 'Sales quota'),
    staffRates: Object.fromEntries(
      Object.entries(config.staffRates || {}).map(([name, rate]) => [
        name,
        {
          dailyRate: amount(rate.dailyRate, `${name}: daily rate`, true),
          quotaBonus: amount(rate.quotaBonus ?? 50, `${name}: quota bonus`),
          otRate: amount(rate.otRate ?? 50, `${name}: OT rate`),
        },
      ]),
    ),
  };
}

export function staffRate(payroll, name) {
  return { ...DEFAULT_STAFF_RATE, ...payroll?.staffRates?.[name] };
}

export function normalizeAttendance(records, start, payroll) {
  const end = addDays(start, 6);
  const seen = new Set();
  return records.map((record) => {
    const date = String(record.date || '');
    const staff = String(record.staff || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < start || date > end || !staff)
      throw new Error('Every attendance entry needs a staff name and a date within this week.');
    const key = `${staff}\n${date}`;
    if (seen.has(key)) throw new Error(`Duplicate attendance entry for ${staff} on ${date}.`);
    seen.add(key);
    if (typeof record.onDuty !== 'boolean') throw new Error('On duty must be true or false.');
    const overtimeHours = Number(record.overtimeHours ?? 0);
    if (!Number.isFinite(overtimeHours) || overtimeHours < 0 || overtimeHours > 24)
      throw new Error(`${staff}: overtime must be between 0 and 24 hours per day.`);
    if (!record.onDuty && overtimeHours > 0)
      throw new Error(`${staff}: mark the day on duty before adding overtime.`);
    // Preserve saved rates when editing an older week. New entries use the current staff settings.
    const rate = record.rates || { ...staffRate(payroll, staff), quotaTarget: payroll.quotaTarget };
    const rates = {
      dailyRate: amount(rate.dailyRate, `${staff}: daily rate`, true),
      quotaBonus: amount(rate.quotaBonus, `${staff}: quota bonus`),
      otRate: amount(rate.otRate, `${staff}: OT rate`),
      quotaTarget: amount(rate.quotaTarget, 'Sales quota'),
    };
    if (record.scheduled != null && typeof record.scheduled !== 'boolean')
      throw new Error('Scheduled must be true or false.');
    return {
      date,
      staff,
      scheduled: record.scheduled == null ? record.onDuty : record.scheduled,
      onDuty: record.onDuty,
      overtimeHours: money(overtimeHours),
      rates,
    };
  });
}

export function buildPayslip(name, start, records, salesByDate, payroll) {
  const normalized = normalizeAttendance(
    records.filter((row) => row.staff === name),
    start,
    payroll,
  );
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const record = normalized.find((row) => row.date === date);
    const rates = record?.rates || { ...staffRate(payroll, name), quotaTarget: payroll.quotaTarget };
    const onDuty = !!record?.onDuty;
    const sales = Number(salesByDate[date] || 0);
    const quotaHit = onDuty && sales > rates.quotaTarget;
    const overtimeHours = onDuty ? record?.overtimeHours || 0 : 0;
    const base = onDuty ? rates.dailyRate || 0 : 0;
    const bonus = quotaHit ? rates.quotaBonus : 0;
    const overtime = money(overtimeHours * rates.otRate);
    return {
      date,
      onDuty,
      sales,
      quotaHit,
      overtimeHours,
      rates,
      base,
      bonus,
      overtime,
      total: money(base + bonus + overtime),
    };
  });
  const totals = days.reduce(
    (sum, day) => ({
      days: sum.days + Number(day.onDuty),
      quotaDays: sum.quotaDays + Number(day.quotaHit),
      overtimeHours: money(sum.overtimeHours + day.overtimeHours),
      base: money(sum.base + day.base),
      bonus: money(sum.bonus + day.bonus),
      overtime: money(sum.overtime + day.overtime),
      total: money(sum.total + day.total),
    }),
    { days: 0, quotaDays: 0, overtimeHours: 0, base: 0, bonus: 0, overtime: 0, total: 0 },
  );
  return {
    staff: name,
    start,
    end: addDays(start, 6),
    days,
    totals,
    missingRate: days.some((day) => day.onDuty && day.rates.dailyRate == null),
  };
}
