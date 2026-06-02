'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DateInput from '../components/inputs/DateInput.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FullscreenLoading from '../components/FullscreenLoading.jsx';
import TextInput from '../components/inputs/TextInput.jsx';
import { apiGet, apiPost } from '../lib/googleSheetsApi.js';
import { isoDateToday } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';

function addDays(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function listDays(from, to, maxDays = 62) {
  if (!from || !to) return [];
  if (from > to) return [];
  const days = [];
  let cur = from;
  while (cur <= to && days.length < maxDays) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  return days;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const _QTY_FORMATTER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
function formatQty(v) {
  return _QTY_FORMATTER.format(toNumber(v));
}

function parseJsonObject(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function niceCeil(n) {
  const v = Math.max(0, toNumber(n));
  if (!v) return 1;
  if (v <= 10) return Math.ceil(v);
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const lead = v / pow;
  const step = lead <= 1 ? 1 : lead <= 2 ? 2 : lead <= 5 ? 5 : 10;
  return step * pow;
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return ['M', start.x, start.y, 'A', r, r, 0, largeArcFlag, 0, end.x, end.y].join(' ');
}

function controlPoint(current, previous, next, reverse, smoothing = 0.18) {
  const p = previous || current;
  const n = next || current;
  const o = {
    length: Math.hypot(n.x - p.x, n.y - p.y),
    angle: Math.atan2(n.y - p.y, n.x - p.x),
  };
  const angle = o.angle + (reverse ? Math.PI : 0);
  const length = o.length * smoothing;
  return { x: current.x + Math.cos(angle) * length, y: current.y + Math.sin(angle) * length };
}

function smoothBezierPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const d = points.reduce((acc, p, i, arr) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const cps = controlPoint(arr[i - 1], arr[i - 2], p, false);
    const cpe = controlPoint(p, arr[i - 1], arr[i + 1], true);
    return `${acc} C ${cps.x} ${cps.y} ${cpe.x} ${cpe.y} ${p.x} ${p.y}`;
  }, '');
  return d;
}

function SalesSmoothLineChart({ points, height = 260, color = '#E03348' }) {
  const w = 820;
  const h = height;
  const padL = 54;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const labels = points.map((p) => p.label);
  const values = points.map((p) => Math.max(0, toNumber(p.sales)));
  const max = Math.max(1, ...values);
  const yMax = Math.ceil(max / 100) * 100 || 1;
  const yTicks = [0, Math.round(yMax * 0.5), yMax];
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const xAt = (idx) => padL + idx * stepX;
  const yAt = (v) => padT + (1 - Math.max(0, v) / (yMax || 1)) * innerH;

  const pts = points.map((p, idx) => ({ x: xAt(idx), y: yAt(toNumber(p.sales)), label: p.label, v: toNumber(p.sales) }));
  const d = smoothBezierPath(pts.map(({ x, y }) => ({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) })));

  const xTickIdxs = (() => {
    if (labels.length <= 1) return [0];
    if (labels.length <= 7) return labels.map((_, i) => i);
    const step = Math.ceil(labels.length / 6);
    const idxs = [];
    for (let i = 0; i < labels.length; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== labels.length - 1) idxs.push(labels.length - 1);
    return idxs;
  })();

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
        {/* Grid */}
        {yTicks.map((t) => (
          <line key={t} x1={padL} x2={w - padR} y1={yAt(t)} y2={yAt(t)} stroke="#e2e8f0" strokeWidth="1" />
        ))}

        {/* Axes */}
        <line x1={padL} x2={padL} y1={padT} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />
        <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />

        {/* Y labels */}
        {yTicks.map((t) => (
          <text key={`y-${t}`} x={padL - 10} y={yAt(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {formatMoney(t)}
          </text>
        ))}

        {/* X labels */}
        {xTickIdxs.map((idx) => (
          <text key={`x-${idx}`} x={xAt(idx)} y={h - 12} textAnchor="middle" fontSize="11" fill="#64748b">
            {labels[idx].slice(5)}
          </text>
        ))}

        {/* Line glow */}
        <path d={d} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" />
        {/* Line */}
        <path d={d} fill="none" stroke={color} strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Dots */}
        {pts.map((pt) => (
          <circle key={pt.label} cx={pt.x} cy={pt.y} r="3.75" fill={color}>
            <title>
              {pt.label} — Sales: {formatMoney(pt.v)}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function SalesExpensesBarChart({ points, height = 260, colors = { sales: '#E03348', expenses: '#8E0006' } }) {
  const w = 820;
  const h = height;
  const padL = 54;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const labels = points.map((p) => p.label);
  const max = Math.max(
    1,
    ...points.flatMap((p) => [Math.max(0, toNumber(p.sales)), Math.max(0, toNumber(p.expenses))]),
  );
  const yMax = Math.ceil(max / 100) * 100 || 1;
  const yTicks = [0, Math.round(yMax * 0.5), yMax];

  const groupW = points.length ? innerW / points.length : innerW;
  const barW = Math.max(6, Math.min(18, groupW * 0.22));
  const gap = Math.max(4, barW * 0.5);

  const xGroup = (idx) => padL + idx * groupW;
  const yAt = (v) => padT + (1 - Math.max(0, v) / (yMax || 1)) * innerH;

  const xTickIdxs = (() => {
    if (labels.length <= 1) return [0];
    if (labels.length <= 7) return labels.map((_, i) => i);
    const step = Math.ceil(labels.length / 6);
    const idxs = [];
    for (let i = 0; i < labels.length; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== labels.length - 1) idxs.push(labels.length - 1);
    return idxs;
  })();

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
        {/* Grid */}
        {yTicks.map((t) => (
          <line key={t} x1={padL} x2={w - padR} y1={yAt(t)} y2={yAt(t)} stroke="#e2e8f0" strokeWidth="1" />
        ))}

        {/* Axes */}
        <line x1={padL} x2={padL} y1={padT} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />
        <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />

        {/* Y labels */}
        {yTicks.map((t) => (
          <text key={`y-${t}`} x={padL - 10} y={yAt(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {formatMoney(t)}
          </text>
        ))}

        {/* Bars */}
        {points.map((p, idx) => {
          const gx = xGroup(idx) + groupW / 2;
          const sVal = Math.max(0, toNumber(p.sales));
          const eVal = Math.max(0, toNumber(p.expenses));
          const sY = yAt(sVal);
          const eY = yAt(eVal);
          const baseY = h - padB;
          return (
            <g key={p.label}>
              <rect
                x={gx - (barW + gap / 2)}
                y={sY}
                width={barW}
                height={Math.max(0, baseY - sY)}
                rx="6"
                fill={colors.sales}
                fillOpacity="0.85"
              >
                <title>
                  {p.label} — Sales: {formatMoney(sVal)}
                </title>
              </rect>
              <rect
                x={gx + gap / 2}
                y={eY}
                width={barW}
                height={Math.max(0, baseY - eY)}
                rx="6"
                fill={colors.expenses}
                fillOpacity="0.75"
              >
                <title>
                  {p.label} — Expenses: {formatMoney(eVal)}
                </title>
              </rect>
            </g>
          );
        })}

        {/* X labels */}
        {xTickIdxs.map((idx) => (
          <text
            key={`x-${idx}`}
            x={xGroup(idx) + groupW / 2}
            y={h - 12}
            textAnchor="middle"
            fontSize="11"
            fill="#64748b"
          >
            {labels[idx].slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function SalesExpensesPie({ slices, height = 260 }) {
  const w = 820;
  const h = height;
  const cx = 200;
  const cy = h / 2;
  const r = Math.min(120, h * 0.36);
  const innerR = r * 0.62;

  const total = slices.reduce((sum, s) => sum + Math.max(0, toNumber(s.value)), 0) || 1;
  let acc = 0;
  const arcs = slices.map((s) => {
    const v = Math.max(0, toNumber(s.value));
    const start = (acc / total) * 360;
    acc += v;
    const end = (acc / total) * 360;
    return { ...s, start, end, pct: clamp01(v / total) };
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
        {/* Donut */}
        <g>
          {arcs.map((a) => (
            <path
              key={a.key}
              d={describeArc(cx, cy, r, a.start, a.end)}
              stroke={a.color}
              strokeWidth={Math.max(18, r * 0.28)}
              strokeLinecap="round"
              fill="none"
            >
              <title>
                {a.label}: {formatMoney(toNumber(a.value))} ({Math.round(a.pct * 100)}%)
              </title>
            </path>
          ))}
          <circle cx={cx} cy={cy} r={innerR} fill="white" />
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="12" fill="#64748b" fontWeight="700">
            Total
          </text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize="16" fill="#0f172a" fontWeight="800">
            {formatMoney(total)}
          </text>
        </g>

        {/* Legend */}
        <g transform={`translate(${380}, ${24})`}>
          <text x={0} y={0} fontSize="12" fill="#0f172a" fontWeight="800">
            Sales vs Expense Groups
          </text>
          {arcs.map((a, idx) => (
            <g key={a.key} transform={`translate(0, ${18 + idx * 22})`}>
              <rect x={0} y={-10} width={12} height={12} rx={3} fill={a.color} />
              <text x={18} y={0} fontSize="12" fill="#334155" fontWeight="700">
                {a.label}
              </text>
              <text x={360} y={0} fontSize="12" fill="#0f172a" textAnchor="end" fontWeight="800">
                {formatMoney(toNumber(a.value))}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function ProductQtyBarChart({ items, height = 360, color = '#E03348' }) {
  const w = 820;
  const padR = 24;
  const padT = 18;
  const padB = 18;
  const rowH = 28;
  const maxLabelChars = Math.min(
    26,
    Math.max(
      0,
      ...items.map((i) => {
        const text = String(i?.name || '').trim();
        return text.length;
      }),
    ),
  );
  const padL = Math.round(Math.min(260, Math.max(140, 26 + maxLabelChars * 7.2)));
  const innerW = w - padL - padR;
  const computedH = padT + Math.max(1, items.length) * rowH + padB;
  const h = Math.max(height, computedH);

  const max = Math.max(1, ...items.map((i) => Math.max(0, toNumber(i.qty))));
  const xMax = niceCeil(max);
  const xTicks = [0, Math.round(xMax * 0.5), xMax].filter((v, idx, arr) => idx === 0 || v !== arr[idx - 1]);
  const xAt = (v) => padL + (Math.max(0, toNumber(v)) / (xMax || 1)) * innerW;
  const yAt = (idx) => padT + idx * rowH + rowH / 2;

  const label = (s) => {
    const text = String(s || '').trim();
    if (text.length <= 26) return text;
    return `${text.slice(0, 23)}…`;
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50">
      <div className="max-h-[420px] overflow-auto">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="xMinYMin meet"
          width="100%"
          height={h}
          className="block w-full"
        >
          {/* Grid + X labels */}
          {xTicks.map((t) => (
            <g key={`x-${t}`}>
              <line x1={xAt(t)} x2={xAt(t)} y1={padT - 6} y2={h - padB} stroke="#e2e8f0" strokeWidth="1" />
              <text x={xAt(t)} y={padT - 10} textAnchor="middle" fontSize="11" fill="#64748b">
                {formatQty(t)}
              </text>
            </g>
          ))}

          {/* Bars */}
          {items.map((it, idx) => {
            const qty = Math.max(0, toNumber(it.qty));
            const y = yAt(idx);
            const barH = 16;
            const barX = padL;
            const barW = Math.max(0, xAt(qty) - padL);
            return (
              <g key={it.name}>
                <text x={padL - 10} y={y + 4} textAnchor="end" fontSize="12" fill="#334155" fontWeight="700">
                  {label(it.name)}
                  <title>{String(it.name || '')}</title>
                </text>
                <rect x={barX} y={y - barH / 2} width={barW} height={barH} rx="7" fill={color} fillOpacity="0.78">
                  <title>
                    {String(it.name || '')}: {formatQty(qty)}
                  </title>
                </rect>
                <text x={Math.min(w - padR, barX + barW + 8)} y={y + 4} fontSize="12" fill="#0f172a" fontWeight="800">
                  {formatQty(qty)}
                </text>
              </g>
            );
          })}

          {/* Axis */}
          <line x1={padL} x2={padL} y1={padT - 4} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />
          <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}

function LineChartWithAxes({ points, height = 240, series }) {
  const w = 820;
  const h = height;
  const padL = 54;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const labels = points.map((p) => p.label);
  const allValues = series.flatMap((s) => points.map((p) => Math.max(0, toNumber(p[s.key]))));
  const max = Math.max(1, ...allValues);
  const yMax = Math.ceil(max / 100) * 100 || 1;
  const yTicks = [0, Math.round(yMax * 0.5), yMax];
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const xAt = (idx) => padL + idx * stepX;
  const yAt = (v) => padT + (1 - Math.max(0, v) / (yMax || 1)) * innerH;

  const paths = series.map((s) => {
    const d = points
      .map((p, idx) => {
        const x = xAt(idx);
        const y = yAt(toNumber(p[s.key]));
        return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
    return { ...s, d };
  });

  const xTickIdxs = (() => {
    if (labels.length <= 1) return [0];
    if (labels.length <= 7) return labels.map((_, i) => i);
    const step = Math.ceil(labels.length / 6);
    const idxs = [];
    for (let i = 0; i < labels.length; i += step) idxs.push(i);
    if (idxs[idxs.length - 1] !== labels.length - 1) idxs.push(labels.length - 1);
    return idxs;
  })();

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-gradient-to-b from-white to-slate-50">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
        {/* Grid */}
        {yTicks.map((t) => (
          <line key={t} x1={padL} x2={w - padR} y1={yAt(t)} y2={yAt(t)} stroke="#e2e8f0" strokeWidth="1" />
        ))}

        {/* Axes */}
        <line x1={padL} x2={padL} y1={padT} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />
        <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="#94a3b8" strokeWidth="1.5" />

        {/* Y labels */}
        {yTicks.map((t) => (
          <text key={`y-${t}`} x={padL - 10} y={yAt(t) + 4} textAnchor="end" fontSize="11" fill="#64748b">
            {formatMoney(t)}
          </text>
        ))}

        {/* X labels */}
        {xTickIdxs.map((idx) => (
          <text
            key={`x-${idx}`}
            x={xAt(idx)}
            y={h - 12}
            textAnchor="middle"
            fontSize="11"
            fill="#64748b"
          >
            {labels[idx].slice(5)}
          </text>
        ))}

        {/* Lines */}
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth="3"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Dots */}
        {paths.map((p) =>
          points.map((pt, idx) => {
            const x = xAt(idx);
            const y = yAt(toNumber(pt[p.key]));
            return (
              <circle key={`${p.key}-${pt.label}`} cx={x} cy={y} r="3.5" fill={p.color}>
                <title>
                  {pt.label} — {p.label}: {formatMoney(toNumber(pt[p.key]))}
                </title>
              </circle>
            );
          }),
        )}
      </svg>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState('report'); // report | items | products | sales

  // Report
  const today = isoDateToday();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [rows, setRows] = useState([]);
  const [weeklyRows, setWeeklyRows] = useState([]);

  const loadReport = useCallback(async () => {
    setReportError('');
    setReportLoading(true);
    try {
      const weekTo = to;
      const weekFrom = addDays(weekTo, -6);
      const [rangeData, weekData] = await Promise.all([
        apiGet('salesFinance.list', { from, to }),
        apiGet('salesFinance.list', { from: weekFrom, to: weekTo }),
      ]);
      setRows(Array.isArray(rangeData.rows) ? rangeData.rows : []);
      setWeeklyRows(Array.isArray(weekData.rows) ? weekData.rows : []);
    } catch (e) {
      setReportError(e?.message || 'Failed to load report');
    } finally {
      setReportLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const daily = useMemo(() => {
    // Group by YYYY-MM-DD and fill missing days with 0 for chart continuity
    const byDay = new Map();
    rows.forEach((r) => {
      const day = (r.Date || '').slice(0, 10) || 'Unknown';
      const existing = byDay.get(day) || { day, sales: 0, expenses: 0, net: 0 };
      const sales = toNumber(r.Takoyaki_Sales);
      const expenses = toNumber(r.Expenses_Total);
      existing.sales += sales;
      existing.expenses += expenses;
      existing.net += sales - expenses;
      byDay.set(day, existing);
    });

    const days = listDays(from, to);
    const filled = days.map((d) => byDay.get(d) || { day: d, sales: 0, expenses: 0, net: 0 });
    return filled.length ? filled : Array.from(byDay.values()).sort((a, b) => (a.day < b.day ? -1 : 1));
  }, [from, rows, to]);

  const chartPoints = useMemo(
    () => daily.map((d) => ({ label: d.day, sales: Math.max(0, d.sales), expenses: Math.max(0, d.expenses) })),
    [daily],
  );

  const totalsRange = useMemo(() => {
    const sales = daily.reduce((sum, d) => sum + toNumber(d.sales), 0);
    const expenses = daily.reduce((sum, d) => sum + toNumber(d.expenses), 0);
    return { sales, expenses };
  }, [daily]);

  const productQtyItems = useMemo(() => {
    const byName = new Map();
    (rows || []).forEach((r) => {
      const obj = parseJsonObject(r?.Product_Sales_JSON);
      if (!obj) return;
      Object.entries(obj).forEach(([k, v]) => {
        const name = String(k || '').trim();
        if (!name) return;
        byName.set(name, (byName.get(name) || 0) + toNumber(v));
      });
    });
    const items = Array.from(byName.entries())
      .map(([name, qty]) => ({ name, qty }))
      .filter((x) => Math.abs(toNumber(x.qty)) > 0.000001);
    items.sort((a, b) => toNumber(b.qty) - toNumber(a.qty) || a.name.localeCompare(b.name));
    return items;
  }, [rows]);

  const totalProductQty = useMemo(() => productQtyItems.reduce((sum, it) => sum + Math.max(0, toNumber(it.qty)), 0), [productQtyItems]);

  const totalsWeekly = useMemo(() => {
    const sales = (weeklyRows || []).reduce((sum, r) => sum + toNumber(r.Takoyaki_Sales), 0);
    const expenses = (weeklyRows || []).reduce((sum, r) => sum + toNumber(r.Expenses_Total), 0);
    return { sales, expenses };
  }, [weeklyRows]);

  const DEFAULT_SALES_CONFIG = useMemo(
    () => ({
      expenseBreakdown: [
        { key: 'Breakdown_Allow', label: 'Allow' },
        { key: 'Breakdown_Ipon', label: 'Ipon' },
        { key: 'Breakdown_Bill', label: 'Bill' },
        { key: 'Breakdown_Ilaw', label: 'Ilaw' },
      ],
      partners: [
        { key: 'Payout_Mykah', label: 'Mykah' },
        { key: 'Payout_Natalie', label: 'Natalie' },
      ],
      staff: [],
    }),
    [],
  );

  // Items
  const [thLoading, setThLoading] = useState(false);
  const [thError, setThError] = useState('');
  const [thSuccess, setThSuccess] = useState('');
  const [thresholds, setThresholds] = useState([]);
  const [filter, setFilter] = useState('');
  const [newProduct, setNewProduct] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newThreshold, setNewThreshold] = useState('');

  // Products (catalog)
  const [prodLoading, setProdLoading] = useState(false);
  const [prodError, setProdError] = useState('');
  const [prodSuccess, setProdSuccess] = useState('');
  const [products, setProducts] = useState([]);
  const [prodFilter, setProdFilter] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('');
  const [newProdName, setNewProdName] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');

  const loadItems = useCallback(async () => {
    setThError('');
    setThSuccess('');
    setThLoading(true);
    try {
      const data = await apiGet('items.list');
      setThresholds(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setThError(e?.message || 'Failed to load thresholds');
    } finally {
      setThLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'items') return;
    loadItems();
  }, [loadItems, tab]);

  const loadProducts = useCallback(async () => {
    setProdError('');
    setProdSuccess('');
    setProdLoading(true);
    try {
      const data = await apiGet('products.list');
      setProducts(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setProdError(e?.message || 'Failed to load products');
    } finally {
      setProdLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'products') return;
    loadProducts();
  }, [loadProducts, tab]);

  async function addProduct() {
    const name = newProdName.trim();
    if (!name) {
      setProdError('Name is required.');
      return;
    }
    setProdError('');
    setProdSuccess('');
    setProdLoading(true);
    try {
      await apiPost('products.upsert', {
        item: {
          Category: newProdCategory.trim(),
          Name: name,
          Price: Number(newProdPrice || 0),
          Active: 'Y',
        },
      });
      setNewProdCategory('');
      setNewProdName('');
      setNewProdPrice('');
      setProdSuccess(`Added product: ${name}.`);
      await loadProducts();
    } catch (e) {
      setProdError(e?.message || 'Failed to add product');
    } finally {
      setProdLoading(false);
    }
  }

  async function saveAllProducts() {
    setProdError('');
    setProdSuccess('');
    setProdLoading(true);
    try {
      const items = (products || [])
        .map((p) => ({
          Category: String(p.Category || '').trim(),
          Name: String(p.Name || '').trim(),
          Price: Number(p.Price || 0),
          Active: p.Active == null ? 'Y' : String(p.Active || '').trim() || 'Y',
        }))
        .filter((p) => p.Name);
      const result = await apiPost('products.upsertMany', { items });
      const count = Number(result?.total || items.length || 0);
      setProdSuccess(`Saved ${count} product(s).`);
      await loadProducts();
    } catch (e) {
      setProdError(e?.message || 'Failed to save products');
    } finally {
      setProdLoading(false);
    }
  }

  async function deleteProduct(name) {
    const ok = window.confirm(`Delete product "${name}"? This cannot be undone.`);
    if (!ok) return;
    setProdError('');
    setProdSuccess('');
    setProdLoading(true);
    try {
      await apiPost('products.delete', { name });
      setProdSuccess(`Deleted product: ${name}.`);
      await loadProducts();
    } catch (e) {
      setProdError(e?.message || 'Failed to delete product');
    } finally {
      setProdLoading(false);
    }
  }

  const visibleProducts = useMemo(() => {
    const q = prodFilter.trim().toLowerCase();
    if (!q) return products;
    return (products || []).filter(
      (p) =>
        String(p.Name || '').toLowerCase().includes(q) ||
        String(p.Category || '').toLowerCase().includes(q),
    );
  }, [prodFilter, products]);

  function updateThresholdCell(index, value) {
    setThresholds((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], Threshold_Limit: value };
      return next;
    });
  }

  async function saveItem(index) {
    // (deprecated) kept for backward compatibility if referenced elsewhere
    await saveAllItems();
  }

  async function saveAllItems() {
    setThError('');
    setThSuccess('');
    setThLoading(true);
    try {
      const items = (thresholds || [])
        .map((t) => ({
          Product: String(t.Product || '').trim(),
          Unit: String(t.Unit || ''),
          Threshold_Limit: Number(t.Threshold_Limit || 0),
        }))
        .filter((t) => t.Product);

      const result = await apiPost('items.upsertMany', { items });
      const count = Number(result?.total || items.length || 0);
      setThSuccess(`Saved ${count} item(s).`);
      await loadItems();
    } catch (e) {
      setThError(e?.message || 'Failed to save items');
    } finally {
      setThLoading(false);
    }
  }

  async function addItem() {
    const product = newProduct.trim();
    if (!product) {
      setThError('Item is required.');
      return;
    }
    setThError('');
    setThSuccess('');
    setThLoading(true);
    try {
      await apiPost('items.upsert', {
        item: {
          Product: product,
          Unit: newUnit.trim(),
          Threshold_Limit: Number(newThreshold || 0),
        },
      });
      setNewProduct('');
      setNewUnit('');
      setNewThreshold('');
      setThSuccess(`Added item: ${product}.`);
      await loadItems();
    } catch (e) {
      setThError(e?.message || 'Failed to add item');
    } finally {
      setThLoading(false);
    }
  }

  async function deleteItem(product) {
    const ok = window.confirm(`Delete item "${product}"? This also deletes its history + needs rows.`);
    if (!ok) return;
    setThError('');
    setThSuccess('');
    setThLoading(true);
    try {
      await apiPost('items.delete', { product });
      setThSuccess(`Deleted item: ${product}.`);
      await loadItems();
    } catch (e) {
      setThError(e?.message || 'Failed to delete item');
    } finally {
      setThLoading(false);
    }
  }

  const visibleThresholds = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return thresholds;
    return thresholds.filter((t) => String(t.Product || '').toLowerCase().includes(q));
  }, [filter, thresholds]);

  // Sales config (expense breakdown / staff / partners)
  const [salesCfg, setSalesCfg] = useState(DEFAULT_SALES_CONFIG);
  const [salesError, setSalesError] = useState('');
  const [salesSuccess, setSalesSuccess] = useState('');
  const [newStaff, setNewStaff] = useState('');
  const [newExpenseLabel, setNewExpenseLabel] = useState('');

  const loadSalesCfg = useCallback(async () => {
    setSalesError('');
    setSalesSuccess('');
    try {
      const data = await apiGet('salesConfig.get');
      setSalesCfg({ ...DEFAULT_SALES_CONFIG, ...(data || {}) });
    } catch (e) {
      setSalesError(e?.message || 'Failed to load sales settings');
    }
  }, [DEFAULT_SALES_CONFIG]);

  useEffect(() => {
    if (tab !== 'sales' && tab !== 'report') return;
    loadSalesCfg();
  }, [loadSalesCfg, tab]);

  async function saveSalesCfg() {
    setSalesError('');
    setSalesSuccess('');
    setThLoading(true);
    try {
      await apiPost('salesConfig.save', { config: salesCfg });
      setSalesSuccess('Saved sales settings.');
      await loadSalesCfg();
    } catch (e) {
      setSalesError(e?.message || 'Failed to save sales settings');
    } finally {
      setThLoading(false);
    }
  }

  function updateExpenseLabel(key, label) {
    setSalesCfg((prev) => ({
      ...prev,
      expenseBreakdown: (prev.expenseBreakdown || []).map((x) => (x.key === key ? { ...x, label } : x)),
    }));
  }

  function addExpenseField() {
    const label = newExpenseLabel.trim();
    if (!label) return;
    const slug = label
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    const key = `Breakdown_${slug || 'Other'}`;

    setSalesCfg((prev) => {
      const next = Array.isArray(prev.expenseBreakdown) ? [...prev.expenseBreakdown] : [];
      if (next.some((x) => x.key === key)) return prev;
      next.push({ key, label });
      return { ...prev, expenseBreakdown: next };
    });
    setNewExpenseLabel('');
  }

  function removeExpenseField(key) {
    setSalesCfg((prev) => ({
      ...prev,
      expenseBreakdown: (prev.expenseBreakdown || []).filter((x) => x.key !== key),
    }));
  }

  function addStaff() {
    const name = newStaff.trim();
    if (!name) return;
    setSalesCfg((prev) => {
      const next = Array.isArray(prev.staff) ? [...prev.staff] : [];
      if (!next.includes(name)) next.push(name);
      return { ...prev, staff: next };
    });
    setNewStaff('');
  }

  function removeStaff(name) {
    setSalesCfg((prev) => ({
      ...prev,
      staff: (prev.staff || []).filter((s) => s !== name),
    }));
  }

  return (
    <div className="space-y-4">
      <FullscreenLoading
        show={reportLoading || thLoading || prodLoading}
        title={
          reportLoading
            ? 'Loading report…'
            : tab === 'items'
              ? 'Updating items…'
              : tab === 'products'
                ? 'Updating products…'
              : tab === 'sales'
                ? 'Saving sales settings…'
                : 'Working…'
        }
        subtitle="Please wait"
      />
      <div className="md-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">Admin</h1>
            <p className="text-sm text-slate-600">Reports and configuration.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab('report')}
              className={['md-btn px-4 py-2', tab === 'report' ? 'md-btn-primary' : 'md-btn-outline'].join(' ')}
            >
              Sales Report
            </button>
            <button
              type="button"
              onClick={() => setTab('items')}
              className={['md-btn px-4 py-2', tab === 'items' ? 'md-btn-primary' : 'md-btn-outline'].join(' ')}
            >
              Items
            </button>
            <button
              type="button"
              onClick={() => setTab('products')}
              className={['md-btn px-4 py-2', tab === 'products' ? 'md-btn-primary' : 'md-btn-outline'].join(' ')}
            >
              Products
            </button>
            <button
              type="button"
              onClick={() => setTab('sales')}
              className={['md-btn px-4 py-2', tab === 'sales' ? 'md-btn-primary' : 'md-btn-outline'].join(' ')}
            >
              Sales
            </button>
          </div>
        </div>
      </div>

      {tab === 'report' ? (
        <div className="space-y-3">
          <div className="md-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="w-full sm:w-[180px]">
                  <DateInput label="From" value={from} onChange={setFrom} />
                </div>
                <div className="w-full sm:w-[180px]">
                  <DateInput label="To" value={to} onChange={setTo} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={loadReport}
                  disabled={reportLoading}
                  className="md-btn md-btn-primary h-[42px]"
                >
                  Refresh
                </button>
              </div>
            </div>

            <ErrorBanner message={reportError} onRetry={loadReport} />

            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-[rgba(224,51,72,0.15)] bg-[linear-gradient(135deg,rgba(243,176,184,0.35),rgba(224,51,72,0.08))] p-3">
                <div className="text-xs font-extrabold text-[var(--p-5)]">Total Sales</div>
                <div className="mt-1 text-lg font-black text-slate-900">{formatMoney(totalsRange.sales)}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-600">
                  Range: {from} → {to}
                </div>
              </div>
              <div className="rounded-2xl border border-[rgba(197,0,24,0.12)] bg-[linear-gradient(135deg,rgba(224,51,72,0.10),rgba(197,0,24,0.05))] p-3">
                <div className="text-xs font-extrabold text-[var(--p-5)]">Total Weekly Sales</div>
                <div className="mt-1 text-lg font-black text-slate-900">{formatMoney(totalsWeekly.sales)}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-600">Last 7 days ending {to}</div>
              </div>
              <div className="rounded-2xl border border-[rgba(142,0,6,0.14)] bg-[linear-gradient(135deg,rgba(142,0,6,0.06),rgba(142,0,6,0.02))] p-3">
                <div className="text-xs font-extrabold text-[var(--p-5)]">Total Expenses</div>
                <div className="mt-1 text-lg font-black text-slate-900">{formatMoney(totalsRange.expenses)}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-600">
                  Range: {from} → {to}
                </div>
              </div>
              <div className="rounded-2xl border border-[rgba(142,0,6,0.12)] bg-[linear-gradient(135deg,rgba(243,176,184,0.16),rgba(142,0,6,0.02))] p-3">
                <div className="text-xs font-extrabold text-[var(--p-5)]">Total Weekly Expenses</div>
                <div className="mt-1 text-lg font-black text-slate-900">{formatMoney(totalsWeekly.expenses)}</div>
                <div className="mt-1 text-[11px] font-semibold text-slate-600">Last 7 days ending {to}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="lg:col-span-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Total Sales</div>
                  </div>
                  <span className="md-chip">Line</span>
                </div>
                <SalesSmoothLineChart points={chartPoints} />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Sales vs Expenses</div>
                    <div className="text-xs text-slate-600">Bar chart by day.</div>
                  </div>
                  <span className="md-chip">Bar</span>
                </div>
                <SalesExpensesBarChart points={chartPoints} />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Sales + Expense Groups</div>
                    <div className="text-xs text-slate-600">Pie chart of totals for this range.</div>
                  </div>
                  <span className="md-chip">Pie</span>
                </div>
                <SalesExpensesPie
                  slices={(() => {
                    const expenseFields = Array.isArray(salesCfg?.expenseBreakdown) ? salesCfg.expenseBreakdown : [];
                    const shades = [
                      'rgba(224,51,72,0.85)',
                      'rgba(224,51,72,0.68)',
                      'rgba(224,51,72,0.52)',
                      'rgba(197,0,24,0.55)',
                      'rgba(142,0,6,0.55)',
                    ];
                    const groups = expenseFields
                      .map((f, idx) => ({
                        key: f.key,
                        label: f.label || f.key,
                        value: rows.reduce((sum, r) => sum + toNumber(r?.[f.key]), 0),
                        color: shades[idx % shades.length],
                      }))
                      .filter((g) => Math.abs(g.value) > 0.00001);
                    const staffTotal = rows.reduce((sum, r) => sum + toNumber(r?.Staff_Expenses_Total), 0);
                    if (staffTotal) {
                      groups.push({ key: 'Staff_Expenses_Total', label: 'Staff', value: staffTotal, color: 'rgba(142,0,6,0.65)' });
                    }
                    return [
                      { key: 'sales', label: 'Sales', value: totalsRange.sales, color: '#E03348' },
                      ...groups,
                    ];
                  })()}
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Products Sold (Qty)</div>
                  <div className="text-xs text-slate-600">Total quantity per product for this range ({formatQty(totalProductQty)} total).</div>
                </div>
                <span className="md-chip">Qty</span>
              </div>
              {productQtyItems.length ? (
                <ProductQtyBarChart items={productQtyItems} />
              ) : (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">
                  No product sales rows in this range.
                </div>
              )}
            </div>
          </div>

          <div className="md-table-wrap">
            <table className="min-w-[900px] w-full text-left text-sm">
              <thead className="md-table-head">
                <tr>
                  <th className="px-3 py-2 font-semibold">Day</th>
                  <th className="px-3 py-2 font-semibold">Sales</th>
                  <th className="px-3 py-2 font-semibold">Expenses</th>
                  <th className="px-3 py-2 font-semibold">Net</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d) => (
                  <tr key={d.day} className="border-t">
                    <td className="px-3 py-2 font-medium">{d.day}</td>
                    <td className="px-3 py-2">{formatMoney(d.sales)}</td>
                    <td className="px-3 py-2">{formatMoney(d.expenses)}</td>
                    <td className="px-3 py-2">{formatMoney(d.net)}</td>
                  </tr>
                ))}
                {daily.length === 0 && !reportLoading ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-600" colSpan={4}>
                      No rows in this range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'items' ? (
        <div className="space-y-3">
          <ErrorBanner message={thError} onRetry={loadItems} />
          {thSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {thSuccess}
            </div>
          ) : null}

          <div className="md-card p-4">
            <div className="grid gap-3 lg:grid-cols-3">
              <TextInput label="New item" value={newProduct} onChange={setNewProduct} placeholder="e.g., Mayo" />
              <TextInput label="Unit" value={newUnit} onChange={setNewUnit} placeholder="e.g., bottle" />
              <div className="flex items-end gap-2">
                <TextInput
                  label="Threshold"
                  value={newThreshold}
                  onChange={setNewThreshold}
                  placeholder="0"
                  inputMode="decimal"
                />
                <button
                  type="button"
                  onClick={addItem}
                  disabled={thLoading}
                  className="md-btn md-btn-primary h-[42px]"
                >
                  Add
                </button>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-sm">
                <TextInput label="Search item" value={filter} onChange={setFilter} placeholder="Type item name" />
              </div>
              <button
                type="button"
                onClick={saveAllItems}
                disabled={thLoading || thresholds.length === 0}
                className="md-btn md-btn-primary h-[42px]"
              >
                Save All
              </button>
            </div>
          </div>

          <div className="md-table-wrap">
            <table className="min-w-[700px] w-full text-left text-sm">
              <thead className="md-table-head">
                <tr>
                  <th className="px-3 py-2 font-semibold">Item</th>
                  <th className="px-3 py-2 font-semibold">Unit</th>
                  <th className="px-3 py-2 font-semibold">Threshold</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleThresholds.map((t, idx) => {
                  const globalIdx = thresholds.indexOf(t);
                  return (
                    <tr key={`${t.Product}-${idx}`} className="border-t">
                      <td className="px-3 py-2 font-medium">{t.Product}</td>
                      <td className="px-3 py-2">
                        <input
                          value={t.Unit ?? ''}
                          onChange={(e) =>
                            setThresholds((prev) => {
                              const next = [...prev];
                              next[globalIdx] = { ...next[globalIdx], Unit: e.target.value };
                              return next;
                            })
                          }
                          className="w-40 rounded-2xl bg-white/80 px-2 py-1 text-sm ring-1 ring-slate-200/60 shadow-[inset_0_2px_10px_rgba(15,23,42,0.08)] focus:outline-none focus:ring-2 focus:ring-[#F3B0B8]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          inputMode="decimal"
                          value={t.Threshold_Limit ?? ''}
                          onChange={(e) => updateThresholdCell(globalIdx, e.target.value)}
                          className="w-28 rounded-2xl bg-white/80 px-2 py-1 text-sm ring-1 ring-slate-200/60 shadow-[inset_0_2px_10px_rgba(15,23,42,0.08)] focus:outline-none focus:ring-2 focus:ring-[#F3B0B8]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => deleteItem(String(t.Product || ''))}
                            disabled={thLoading}
                            className="md-btn md-btn-outline px-3 py-2 text-xs"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!thLoading && visibleThresholds.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-600" colSpan={4}>
                      No items found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'products' ? (
        <div className="space-y-3">
          <ErrorBanner message={prodError} onRetry={loadProducts} />
          {prodSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {prodSuccess}
            </div>
          ) : null}

          <div className="md-card p-4">
            <div className="grid gap-3 lg:grid-cols-4">
              <TextInput label="Category" value={newProdCategory} onChange={setNewProdCategory} placeholder="e.g., Takoyaki" />
              <TextInput label="Name" value={newProdName} onChange={setNewProdName} placeholder="e.g., 4pcs" />
              <TextInput label="Price" value={newProdPrice} onChange={setNewProdPrice} placeholder="0" inputMode="decimal" />
              <div className="flex items-end gap-2">
                <button type="button" onClick={addProduct} disabled={prodLoading} className="md-btn md-btn-primary h-[42px]">
                  Add
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-sm">
                <TextInput label="Search" value={prodFilter} onChange={setProdFilter} placeholder="Type category or name" />
              </div>
              <button
                type="button"
                onClick={saveAllProducts}
                disabled={prodLoading || products.length === 0}
                className="md-btn md-btn-primary h-[42px]"
              >
                Save All
              </button>
            </div>
          </div>

          <div className="md-table-wrap">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="md-table-head">
                <tr>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Price</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((p, idx) => {
                  const globalIdx = products.indexOf(p);
                  return (
                    <tr key={`${p.Name}-${idx}`} className="border-t">
                      <td className="px-3 py-2">
                        <input
                          value={p.Category ?? ''}
                          onChange={(e) =>
                            setProducts((prev) => {
                              const next = [...prev];
                              next[globalIdx] = { ...next[globalIdx], Category: e.target.value };
                              return next;
                            })
                          }
                          className="w-56 rounded-2xl bg-white/80 px-2 py-1 text-sm ring-1 ring-slate-200/60 shadow-[inset_0_2px_10px_rgba(15,23,42,0.08)] focus:outline-none focus:ring-2 focus:ring-[#F3B0B8]"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{p.Name}</td>
                      <td className="px-3 py-2">
                        <input
                          inputMode="decimal"
                          value={p.Price ?? ''}
                          onChange={(e) =>
                            setProducts((prev) => {
                              const next = [...prev];
                              next[globalIdx] = { ...next[globalIdx], Price: e.target.value };
                              return next;
                            })
                          }
                          className="w-32 rounded-2xl bg-white/80 px-2 py-1 text-sm ring-1 ring-slate-200/60 shadow-[inset_0_2px_10px_rgba(15,23,42,0.08)] focus:outline-none focus:ring-2 focus:ring-[#F3B0B8]"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => deleteProduct(String(p.Name || ''))}
                          disabled={prodLoading}
                          className="md-btn md-btn-outline px-3 py-2 text-xs"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!prodLoading && visibleProducts.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-600" colSpan={4}>
                      No products found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'sales' ? (
        <div className="space-y-3">
          <ErrorBanner message={salesError} onRetry={loadSalesCfg} />
          {salesSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {salesSuccess}
            </div>
          ) : null}

          <div className="md-card p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Sales Settings</div>
                <div className="text-xs text-slate-600">Controls labels and dropdowns in the Sales page.</div>
              </div>
              <button
                type="button"
                onClick={saveSalesCfg}
                disabled={thLoading}
                className="md-btn md-btn-primary h-[42px]"
              >
                Save Settings
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div>
                <div className="text-sm font-semibold">Expense Breakdown Fields</div>
                <div className="mt-1 text-xs text-slate-600">
                  Add/edit expense fields shown in the Sales page. New fields create new columns in the sheet automatically when saving.
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={newExpenseLabel}
                    onChange={(e) => setNewExpenseLabel(e.target.value)}
                    placeholder="Add expense label (e.g., Gas, Ice, Delivery)"
                    className="md-input h-[42px] flex-1"
                  />
                  <button
                    type="button"
                    onClick={addExpenseField}
                    className="md-btn md-btn-primary h-[42px] px-4"
                  >
                    Add Field
                  </button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {(salesCfg.expenseBreakdown || []).map((f) => (
                    <div key={f.key} className="md-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-slate-700">Key</div>
                          <div className="mt-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                            {f.key}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeExpenseField(f.key)}
                          className="md-btn md-btn-outline h-9 px-3 text-xs"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-3">
                        <TextInput
                          label="Label"
                          value={f.label || ''}
                          onChange={(v) => updateExpenseLabel(f.key, v)}
                          placeholder="Label"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold">Staff (Expenses)</div>
                <div className="mt-1 text-xs text-slate-600">
                  Added staff will show in the Sales page as payout inputs and will be included in Expenses Total.
                </div>
                <div className="mt-4">
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newStaff}
                      onChange={(e) => setNewStaff(e.target.value)}
                      placeholder="Add staff name"
                      className="md-input h-[42px] flex-1"
                    />
                    <button
                      type="button"
                      onClick={addStaff}
                      className="h-[42px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Add
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {(salesCfg.staff || []).map((s) => (
                      <div
                        key={s}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm"
                      >
                        <span className="font-medium">{s}</span>
                        <button
                          type="button"
                          onClick={() => removeStaff(s)}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    {(salesCfg.staff || []).length === 0 ? (
                      <div className="text-sm text-slate-600">No staff configured yet.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
