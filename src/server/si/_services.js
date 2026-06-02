import crypto from 'node:crypto';
import {
  ensureHeaders,
  ensureSheet,
  readSheetAsObjects,
  overwriteSheetFromObjects,
} from './_sheets.js';
import { getAuthDebugInfo } from './_sheets.js';

const SHEET_INVENTORY = 'Inventory';
const SHEET_INV_HISTORY = 'Inventory_History';
const SHEET_SALES = 'Sales_Finance';
const SHEET_NEEDS = 'Needs_Replenish';
const SHEET_CONFIG = 'Config';
const SHEET_USERS = 'Users';
const SHEET_PRODUCTS = 'Products';

const INV_DAY_CLOSED_COL = 'Is_Closed';

// ---------------- Utilities ----------------

export function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
}

function safeMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err?.message ? String(err.message) : 'Unknown error';
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function normalizeDateKey(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (isIsoDate(s)) return s;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s.slice(0, 10);
}

function addDaysIso(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isClosedFlag(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const s = String(value).trim().toUpperCase();
  return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1';
}

function assertHeaders(sheetName, headers, required) {
  const missing = (required || []).filter((h) => headers.indexOf(h) < 0);
  if (missing.length) {
    const shown = headers.filter(Boolean).join(', ') || '(none)';
    throw new Error(`${sheetName} sheet is missing required header(s): ${missing.join(', ')}. Found: ${shown}`);
  }
}

function constantTimeEq(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function base64urlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
}

function base64urlDecodeToString(input) {
  const s = String(input || '').replaceAll('-', '+').replaceAll('_', '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64').toString('utf8');
}

function jwtSign(payload, secret, ttlSeconds) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Number(ttlSeconds || 0));
  const body = { ...(payload || {}), exp };
  const h = base64urlEncode(JSON.stringify(header));
  const p = base64urlEncode(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${base64urlEncode(sig)}`;
}

function jwtVerify(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  if (!constantTimeEq(base64urlEncode(expected), s)) return null;
  let payload;
  try {
    payload = JSON.parse(base64urlDecodeToString(p));
  } catch {
    return null;
  }
  const exp = Number(payload?.exp || 0);
  if (!exp || exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function getApiToken() {
  // Prefer SI_API_TOKEN on the server. NEXT_PUBLIC_* is only a fallback for local/dev convenience.
  return (
    String(process.env.SI_API_TOKEN || '').trim() ||
    String(process.env.NEXT_PUBLIC_GOOGLE_SHEETS_API_TOKEN || '').trim()
  );
}

function getJwtSecret() {
  return String(process.env.SI_JWT_SECRET || '').trim();
}

function hashPassword(password, salt) {
  const pepper = String(process.env.SI_AUTH_PEPPER || '').trim();
  const input = `${String(salt || '')}${String(password || '')}${pepper}`;
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function defaultSalesConfig() {
  return {
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
  };
}

function normalizeStaffExpenses(value) {
  if (!value) return { json: '', total: 0 };
  let obj = null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return { json: '', total: 0 };
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  } else if (typeof value === 'object') {
    obj = value;
  }
  if (!obj || typeof obj !== 'object') return { json: '', total: 0 };

  const normalized = {};
  let total = 0;
  Object.keys(obj).forEach((k) => {
    const name = String(k || '').trim();
    if (!name) return;
    const amount = toNumber(obj[k]);
    if (!amount) return;
    normalized[name] = amount;
    total += amount;
  });
  const json = Object.keys(normalized).length ? JSON.stringify(normalized) : '';
  return { json, total };
}

// ---------------- Auth ----------------

export async function requireAuth({ token, session }) {
  const expectedToken = getApiToken();
  if (!expectedToken) throw new Error('Missing SI_API_TOKEN (or NEXT_PUBLIC_GOOGLE_SHEETS_API_TOKEN) environment variable');

  if (token && constantTimeEq(token, expectedToken)) {
    return { username: 'api-token', role: 'admin' };
  }

  const st = String(session || '').trim();
  if (!st) throw new Error('Unauthorized: missing session');
  const secret = getJwtSecret();
  if (!secret) throw new Error('Missing SI_JWT_SECRET environment variable');
  const payload = jwtVerify(st, secret);
  if (!payload?.username) throw new Error('Unauthorized: invalid session');
  return { username: String(payload.username), role: String(payload.role || 'staff') };
}

export function requireAdmin(ctx) {
  if (!ctx || String(ctx.role || '') !== 'admin') throw new Error('Unauthorized: admin only');
}

async function getOrCreateUsersSheet() {
  await ensureSheet({ title: SHEET_USERS, headers: ['Username', 'Password_Hash', 'Salt', 'Role', 'Active'] });
  await ensureHeaders(SHEET_USERS, ['Username', 'Password_Hash', 'Salt', 'Role', 'Active']);
}

export async function authLogin({ username, password }) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) throw new Error('Username and password are required');

  const secret = getJwtSecret();
  if (!secret) throw new Error('Missing SI_JWT_SECRET environment variable');

  await getOrCreateUsersSheet();
  const data = await readSheetAsObjects(SHEET_USERS);
  assertHeaders(SHEET_USERS, data.headers, ['Username', 'Password_Hash', 'Salt', 'Role', 'Active']);

  const row = data.values.find((r) => String(r.Username || '').trim().toLowerCase() === u.toLowerCase());
  if (!row) throw new Error('Invalid username or password');
  const active = String(row.Active || '').trim().toUpperCase();
  if (active && active !== 'Y' && active !== 'YES' && active !== 'TRUE') throw new Error('Account is disabled');

  const salt = String(row.Salt || '').trim();
  const expected = String(row.Password_Hash || '').trim();
  const actual = hashPassword(p, salt);
  if (!expected || actual !== expected) throw new Error('Invalid username or password');

  const role = String(row.Role || 'staff').trim() || 'staff';
  const sessionToken = jwtSign({ username: u, role }, secret, 6 * 60 * 60);
  return { sessionToken, user: { username: u, role } };
}

export async function authAdminUpsertUser({ username, password, role, active }) {
  const u = String(username || '').trim();
  const p = String(password || '');
  const r = String(role || 'staff').trim() || 'staff';
  if (!u) throw new Error('username is required');
  if (!p) throw new Error('password is required');

  await getOrCreateUsersSheet();
  const data = await readSheetAsObjects(SHEET_USERS);
  assertHeaders(SHEET_USERS, data.headers, ['Username', 'Password_Hash', 'Salt', 'Role', 'Active']);

  const salt = crypto.randomUUID().replaceAll('-', '');
  const hash = hashPassword(p, salt);
  const rowObj = {
    Username: u,
    Password_Hash: hash,
    Salt: salt,
    Role: r,
    Active: String(active || 'Y'),
  };

  const nextRows = [...data.values];
  let updated = false;
  for (let i = 0; i < nextRows.length; i++) {
    const existing = String(nextRows[i].Username || '').trim();
    if (!existing) continue;
    if (existing.toLowerCase() !== u.toLowerCase()) continue;
    nextRows[i] = rowObj;
    updated = true;
    break;
  }
  if (!updated) nextRows.push(rowObj);

  await overwriteSheetFromObjects(SHEET_USERS, data.headers, nextRows);
  return { username: u, role: r, updated };
}

// ---------------- Items (Inventory master CRUD) ----------------

async function ensureInventorySheet() {
  await ensureSheet({ title: SHEET_INVENTORY, headers: ['Product', 'Unit', 'Threshold_Limit'] });
  await ensureHeaders(SHEET_INVENTORY, ['Product', 'Unit', 'Threshold_Limit']);
}

function indexByProduct(values) {
  const map = {};
  values.forEach((r, idx) => {
    const p = String(r.Product || '').trim();
    if (!p) return;
    map[p] = idx;
  });
  return map;
}

export async function itemsList() {
  await ensureInventorySheet();
  const data = await readSheetAsObjects(SHEET_INVENTORY);
  assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Unit', 'Threshold_Limit']);
  return {
    items: data.values.map((r) => ({
      Product: String(r.Product || ''),
      Unit: String(r.Unit || ''),
      Threshold_Limit: toNumber(r.Threshold_Limit),
    })),
  };
}

export async function itemsUpsert(item) {
  if (!item?.Product) throw new Error('payload.item.Product is required');
  await ensureInventorySheet();
  const data = await readSheetAsObjects(SHEET_INVENTORY);
  assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Unit', 'Threshold_Limit']);

  const product = String(item.Product || '').trim();
  const unit = item.Unit != null ? String(item.Unit) : '';
  const threshold = toNumber(item.Threshold_Limit);

  const idx = indexByProduct(data.values);
  const rowObj = { Product: product, Unit: unit, Threshold_Limit: threshold };
  const next = [...data.values];
  if (idx[product] != null) next[idx[product]] = rowObj;
  else next.push(rowObj);
  await overwriteSheetFromObjects(SHEET_INVENTORY, data.headers, next);
}

export async function itemsUpsertMany(items) {
  if (!Array.isArray(items)) throw new Error('payload.items must be an array');
  await ensureInventorySheet();
  const data = await readSheetAsObjects(SHEET_INVENTORY);
  assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Unit', 'Threshold_Limit']);

  const idx = indexByProduct(data.values);
  const next = [...data.values];
  let updated = 0;
  let inserted = 0;

  items.forEach((raw) => {
    const product = String(raw?.Product || '').trim();
    if (!product) return;
    const rowObj = {
      Product: product,
      Unit: raw?.Unit != null ? String(raw.Unit) : '',
      Threshold_Limit: toNumber(raw?.Threshold_Limit),
    };
    if (idx[product] != null) {
      next[idx[product]] = rowObj;
      updated += 1;
    } else {
      idx[product] = next.length;
      next.push(rowObj);
      inserted += 1;
    }
  });

  await overwriteSheetFromObjects(SHEET_INVENTORY, data.headers, next);
  return { updated, inserted, total: updated + inserted };
}

export async function itemsDelete({ product }) {
  const target = String(product || '').trim();
  if (!target) return { deleted: { inventory: 0, inventoryHistory: 0, needs: 0 } };

  await ensureInventorySheet();
  await ensureSheet({ title: SHEET_INV_HISTORY, headers: ['Date', 'Product', 'Current_Qty', 'In_Stock', 'Out_Stock', 'Closing_Qty', 'Unit', 'Threshold_Limit', INV_DAY_CLOSED_COL] });
  await ensureSheet({ title: SHEET_NEEDS, headers: ['Date', 'Product', 'Current_Closing_Qty', 'Status'] });

  const inv = await readSheetAsObjects(SHEET_INVENTORY);
  const invNext = inv.values.filter((r) => String(r.Product || '').trim() !== target);
  await overwriteSheetFromObjects(SHEET_INVENTORY, inv.headers, invNext);

  const hist = await readSheetAsObjects(SHEET_INV_HISTORY);
  const histNext = hist.values.filter((r) => String(r.Product || '').trim() !== target);
  await overwriteSheetFromObjects(SHEET_INV_HISTORY, hist.headers, histNext);

  const needs = await readSheetAsObjects(SHEET_NEEDS);
  const needsNext = needs.values.filter((r) => String(r.Product || '').trim() !== target);
  await overwriteSheetFromObjects(SHEET_NEEDS, needs.headers, needsNext);

  return {
    deleted: {
      inventory: inv.values.length - invNext.length,
      inventoryHistory: hist.values.length - histNext.length,
      needs: needs.values.length - needsNext.length,
    },
  };
}

export async function thresholdsGet() {
  // Same underlying sheet as itemsList; keep response shape identical to Apps Script.
  await ensureInventorySheet();
  const data = await readSheetAsObjects(SHEET_INVENTORY);
  assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Unit', 'Threshold_Limit']);
  return {
    items: data.values.map((r) => ({
      Product: String(r.Product || ''),
      Unit: String(r.Unit || ''),
      Threshold_Limit: toNumber(r.Threshold_Limit),
    })),
  };
}

export async function thresholdsUpdate({ product, threshold }) {
  const p = String(product || '').trim();
  if (!p) throw new Error('payload.product is required');
  await ensureInventorySheet();
  const data = await readSheetAsObjects(SHEET_INVENTORY);
  assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Threshold_Limit']);
  const idx = indexByProduct(data.values);
  const i = idx[p];
  if (i == null) throw new Error(`Product not found in Inventory: ${p}`);
  const next = [...data.values];
  next[i] = { ...next[i], Threshold_Limit: toNumber(threshold) };
  await overwriteSheetFromObjects(SHEET_INVENTORY, data.headers, next);
}

// ---------------- Inventory History (per-day CRUD) ----------------

async function ensureInventoryHistorySheet() {
  await ensureSheet({
    title: SHEET_INV_HISTORY,
    headers: ['Date', 'Product', 'Current_Qty', 'In_Stock', 'Out_Stock', 'Closing_Qty', 'Unit', 'Threshold_Limit', INV_DAY_CLOSED_COL],
  });
  await ensureHeaders(SHEET_INV_HISTORY, [INV_DAY_CLOSED_COL]);
}

function normalizeInventoryHistoryRow(r) {
  const out = { ...r };
  out.Date = String(r.Date || '').slice(0, 10);
  out.Product = String(r.Product || '');
  out.Unit = String(r.Unit || '');
  out.Current_Qty = toNumber(r.Current_Qty);
  out.In_Stock = toNumber(r.In_Stock);
  out.Out_Stock = toNumber(r.Out_Stock);
  out.Closing_Qty = toNumber(r.Closing_Qty);
  out.Threshold_Limit = toNumber(r.Threshold_Limit);
  out[INV_DAY_CLOSED_COL] = String(r[INV_DAY_CLOSED_COL] || '');
  return out;
}

export async function inventoryGet({ date }) {
  if (!isIsoDate(date)) throw new Error('date is required (YYYY-MM-DD)');
  await ensureInventoryHistorySheet();
  const history = await readSheetAsObjects(SHEET_INV_HISTORY);
  assertHeaders(SHEET_INV_HISTORY, history.headers, ['Date', 'Product']);
  const histRows = history.values
    .filter((r) => normalizeDateKey(r.Date) === date)
    .map((r) => normalizeInventoryHistoryRow(r));
  const closed = histRows.some((r) => isClosedFlag(r[INV_DAY_CLOSED_COL]));
  return { date, closed, items: histRows };
}

export async function inventoryGetOrSeed({ date }) {
  const existing = await inventoryGet({ date });
  if (existing.items?.length) return { date: existing.date || date, seeded: false, closed: !!existing.closed, items: existing.items };
  const seeded = await inventorySeedTemplate({ date });
  return { ...seeded, seeded: true, closed: false };
}

export async function inventoryDeleteDay({ date }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  await ensureInventoryHistorySheet();
  const sheet = await readSheetAsObjects(SHEET_INV_HISTORY);
  assertHeaders(SHEET_INV_HISTORY, sheet.headers, ['Date']);
  const next = sheet.values.filter((r) => normalizeDateKey(r.Date) !== date);
  await overwriteSheetFromObjects(SHEET_INV_HISTORY, sheet.headers, next);
  return sheet.values.length - next.length;
}

export async function inventorySubmit({ date, items }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  if (!Array.isArray(items)) throw new Error('payload.items must be an array');
  await ensureInventoryHistorySheet();
  const history = await readSheetAsObjects(SHEET_INV_HISTORY);
  assertHeaders(SHEET_INV_HISTORY, history.headers, ['Date', 'Product']);

  const remaining = history.values.filter((r) => normalizeDateKey(r.Date) !== date);
  const newRows = items.map((raw) => ({
    Date: date,
    Product: String(raw?.Product || '').trim(),
    Current_Qty: toNumber(raw?.Current_Qty),
    In_Stock: toNumber(raw?.In_Stock),
    Out_Stock: toNumber(raw?.Out_Stock),
    Closing_Qty: toNumber(raw?.Closing_Qty),
    Unit: raw?.Unit != null ? String(raw.Unit) : '',
    Threshold_Limit: toNumber(raw?.Threshold_Limit),
    [INV_DAY_CLOSED_COL]: isClosedFlag(raw?.[INV_DAY_CLOSED_COL]) ? 'Y' : '',
  }));

  await overwriteSheetFromObjects(SHEET_INV_HISTORY, history.headers, remaining.concat(newRows));
  return items.length;
}

async function inventoryFindLastOpenDateBefore({ date }) {
  await ensureInventoryHistorySheet();
  const history = await readSheetAsObjects(SHEET_INV_HISTORY);
  assertHeaders(SHEET_INV_HISTORY, history.headers, ['Date', 'Product']);

  const datesWithAnyRows = new Set();
  const closedDates = new Set();
  history.values.forEach((r) => {
    const d = normalizeDateKey(r.Date);
    if (!d || d >= date) return;
    const product = String(r.Product || '').trim();
    if (!product) return;
    datesWithAnyRows.add(d);
    if (isClosedFlag(r[INV_DAY_CLOSED_COL])) closedDates.add(d);
  });

  const candidates = Array.from(datesWithAnyRows).sort();
  for (let i = candidates.length - 1; i >= 0; i--) {
    const d = candidates[i];
    if (!closedDates.has(d)) return d;
  }
  return candidates.length ? candidates[candidates.length - 1] : '';
}

export async function inventorySeedTemplate({ date }) {
  if (!isIsoDate(date)) throw new Error('date is required (YYYY-MM-DD)');
  const seedFrom = await inventoryFindLastOpenDateBefore({ date });
  const itemsRes = await itemsList();
  const prevRes = seedFrom ? await inventoryGet({ date: seedFrom }) : { items: [] };
  const prevItems = Array.isArray(prevRes.items) ? prevRes.items : [];
  const prevClosingByProduct = {};
  prevItems.forEach((r) => {
    const p = String(r.Product || '').trim();
    if (!p) return;
    prevClosingByProduct[p] = toNumber(r.Closing_Qty);
  });

  const template = (itemsRes.items || []).map((it) => {
    const p = String(it.Product || '').trim();
    const prev = prevClosingByProduct[p] || 0;
    return {
      Date: date,
      Product: p,
      Current_Qty: prev,
      In_Stock: 0,
      Out_Stock: 0,
      Closing_Qty: prev,
      Unit: it.Unit != null ? String(it.Unit) : '',
      Threshold_Limit: toNumber(it.Threshold_Limit),
      [INV_DAY_CLOSED_COL]: '',
    };
  });

  return { date, seededFrom: seedFrom || null, items: template };
}

export async function inventorySetClosed({ date, closed }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  if (typeof closed !== 'boolean') throw new Error('payload.closed must be boolean');

  const existing = await inventoryGet({ date });
  const hasRows = Array.isArray(existing.items) && existing.items.length;

  if (!closed) {
    if (!hasRows) return { date, closed: false, updated: 0 };
    const opened = existing.items.map((r) => ({ ...r, [INV_DAY_CLOSED_COL]: '' }));
    const updated = await inventorySubmit({ date, items: opened });
    return { date, closed: false, updated };
  }

  const seeded = await inventorySeedTemplate({ date });
  const baseRows = seeded.items || [];
  const closedRows = baseRows.map((r) => {
    const qty = toNumber(r.Current_Qty);
    return {
      ...r,
      Current_Qty: qty,
      In_Stock: 0,
      Out_Stock: 0,
      Closing_Qty: qty,
      Threshold_Limit: toNumber(r.Threshold_Limit),
      [INV_DAY_CLOSED_COL]: 'Y',
    };
  });
  const updated = await inventorySubmit({ date, items: closedRows });
  return { date, closed: true, updated, seededFrom: seeded ? seeded.seededFrom : null };
}

// ---------------- Needs ----------------

async function ensureNeedsSheet() {
  await ensureSheet({ title: SHEET_NEEDS, headers: ['Date', 'Product', 'Current_Closing_Qty', 'Status'] });
}

export async function needsList({ date, source }) {
  const dateKey = isIsoDate(date) ? date : '';
  if (!dateKey) throw new Error('date is required (YYYY-MM-DD)');
  await ensureNeedsSheet();
  const sheet = await readSheetAsObjects(SHEET_NEEDS);
  assertHeaders(SHEET_NEEDS, sheet.headers, ['Date', 'Product', 'Status']);
  const items = sheet.values
    .filter((r) => normalizeDateKey(r.Date) === dateKey)
    .map((r) => ({
      Date: normalizeDateKey(r.Date),
      Product: String(r.Product || ''),
      Current_Closing_Qty: toNumber(r.Current_Closing_Qty),
      Status: String(r.Status || ''),
    }))
    .filter((i) => i.Product);

  if (source === 'derived') return { items: items.filter((i) => i.Status === 'NEEDS_MANUAL') };
  return { items };
}

export async function needsManualUpsert({ date, item }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  if (!item?.Product) throw new Error('payload.item.Product is required');
  await ensureNeedsSheet();
  const sheet = await readSheetAsObjects(SHEET_NEEDS);
  assertHeaders(SHEET_NEEDS, sheet.headers, ['Date', 'Product', 'Status']);

  const product = String(item.Product || '').trim();
  const remaining = sheet.values.filter(
    (r) => !(normalizeDateKey(r.Date) === date && String(r.Product || '').trim() === product && String(r.Status || '') === 'NEEDS_MANUAL'),
  );
  const rowObj = {
    Date: date,
    Product: product,
    Current_Closing_Qty: toNumber(item.Current_Closing_Qty),
    Status: 'NEEDS_MANUAL',
  };

  await overwriteSheetFromObjects(SHEET_NEEDS, sheet.headers, remaining.concat([rowObj]));
}

export async function needsManualRemove({ date, product }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  const target = String(product || '').trim();
  if (!target) throw new Error('payload.Product is required');
  await ensureNeedsSheet();
  const sheet = await readSheetAsObjects(SHEET_NEEDS);
  assertHeaders(SHEET_NEEDS, sheet.headers, ['Date', 'Product']);
  const next = sheet.values.filter((r) => !(normalizeDateKey(r.Date) === date && String(r.Product || '').trim() === target));
  await overwriteSheetFromObjects(SHEET_NEEDS, sheet.headers, next);
}

// ---------------- Config (Sales config) ----------------

async function ensureConfigSheet() {
  await ensureSheet({ title: SHEET_CONFIG, headers: ['Key', 'Value'] });
  await ensureHeaders(SHEET_CONFIG, ['Key', 'Value']);
}

export async function salesConfigGet() {
  await ensureConfigSheet();
  const sheet = await readSheetAsObjects(SHEET_CONFIG);
  const data = sheet.values;
  const row = data.find((r) => String(r.Key || '').trim() === 'sales_config');
  const raw = row ? String(row.Value || '').trim() : '';
  if (!raw) return { config: defaultSalesConfig() };
  try {
    const parsed = JSON.parse(raw);
    return { config: { ...defaultSalesConfig(), ...(parsed || {}) } };
  } catch {
    return { config: defaultSalesConfig() };
  }
}

export async function salesConfigSave(config) {
  await ensureConfigSheet();
  const sheet = await readSheetAsObjects(SHEET_CONFIG);
  const json = JSON.stringify(config);
  const next = [...sheet.values];
  let updated = false;
  for (let i = 0; i < next.length; i++) {
    const key = String(next[i].Key || '').trim();
    if (key !== 'sales_config') continue;
    next[i] = { ...next[i], Key: 'sales_config', Value: json };
    updated = true;
    break;
  }
  if (!updated) next.push({ Key: 'sales_config', Value: json });
  await overwriteSheetFromObjects(SHEET_CONFIG, sheet.headers, next);
}

// ---------------- Products ----------------

async function ensureProductsSheet() {
  await ensureSheet({ title: SHEET_PRODUCTS, headers: ['Category', 'Name', 'Price', 'Active'] });
  await ensureHeaders(SHEET_PRODUCTS, ['Category', 'Name', 'Price', 'Active']);
}

export async function productsList() {
  await ensureProductsSheet();
  const sheet = await readSheetAsObjects(SHEET_PRODUCTS);
  assertHeaders(SHEET_PRODUCTS, sheet.headers, ['Category', 'Name', 'Price']);
  const items = sheet.values
    .map((r) => ({
      Category: String(r.Category || '').trim(),
      Name: String(r.Name || '').trim(),
      Price: toNumber(r.Price),
      Active: String(r.Active || '').trim() || 'Y',
    }))
    .filter((r) => r.Name);
  return { items };
}

export async function productsUpsert(raw) {
  if (!raw?.Name) throw new Error('payload.item.Name is required');
  await ensureProductsSheet();
  const sheet = await readSheetAsObjects(SHEET_PRODUCTS);
  assertHeaders(SHEET_PRODUCTS, sheet.headers, ['Name', 'Price']);

  const name = String(raw.Name || '').trim();
  const category = String(raw.Category || '').trim();
  const price = toNumber(raw.Price);
  const active = raw.Active == null ? 'Y' : String(raw.Active || '').trim() || 'Y';

  const next = [...sheet.values];
  let updated = false;
  for (let i = 0; i < next.length; i++) {
    const n = String(next[i].Name || '').trim();
    if (n !== name) continue;
    next[i] = { ...next[i], Category: category, Name: name, Price: price, Active: active };
    updated = true;
    break;
  }
  if (!updated) next.push({ Category: category, Name: name, Price: price, Active: active });
  await overwriteSheetFromObjects(SHEET_PRODUCTS, sheet.headers, next);
}

export async function productsUpsertMany(items) {
  if (!Array.isArray(items)) throw new Error('payload.items must be an array');
  await ensureProductsSheet();
  const sheet = await readSheetAsObjects(SHEET_PRODUCTS);
  assertHeaders(SHEET_PRODUCTS, sheet.headers, ['Name', 'Price']);

  const next = [...sheet.values];
  const index = new Map(next.map((r, i) => [String(r.Name || '').trim(), i]));
  let upserts = 0;
  let appends = 0;

  items.forEach((raw) => {
    const name = String(raw?.Name || '').trim();
    if (!name) return;
    const rowObj = {
      Category: String(raw?.Category || '').trim(),
      Name: name,
      Price: toNumber(raw?.Price),
      Active: raw?.Active == null ? 'Y' : String(raw.Active || '').trim() || 'Y',
    };
    const i = index.get(name);
    if (i != null) {
      next[i] = rowObj;
      upserts += 1;
    } else {
      index.set(name, next.length);
      next.push(rowObj);
      appends += 1;
    }
  });

  await overwriteSheetFromObjects(SHEET_PRODUCTS, sheet.headers, next);
  return { upserts, appends, total: upserts + appends };
}

export async function productsDelete({ name }) {
  const target = String(name || '').trim();
  if (!target) return 0;
  await ensureProductsSheet();
  const sheet = await readSheetAsObjects(SHEET_PRODUCTS);
  assertHeaders(SHEET_PRODUCTS, sheet.headers, ['Name']);
  const next = sheet.values.filter((r) => String(r.Name || '').trim() !== target);
  await overwriteSheetFromObjects(SHEET_PRODUCTS, sheet.headers, next);
  return sheet.values.length - next.length;
}

// ---------------- Sales / Finance ----------------

async function ensureSalesSheet(extraHeaders = []) {
  const base = [
    'Date',
    'Takoyaki_Sales',
    'Expenses_Total',
    'Total_Cash_Calculated',
    'Previous_Cash_Added',
    'Final_Total_Cash',
    'Payout_Mykah',
    'Payout_Natalie',
    'Remaining_Balance',
  ];
  await ensureSheet({ title: SHEET_SALES, headers: base });
  await ensureHeaders(SHEET_SALES, base.concat(extraHeaders || []));
}

function normalizeSalesRow(row) {
  const out = { ...row };
  Object.keys(out).forEach((k) => {
    if (k === 'Date' || k === 'Staff' || k === 'Staff_Expenses_JSON' || k === 'Product_Sales_JSON') return;
    out[k] = toNumber(out[k]);
  });
  if (out.Date != null) out.Date = String(out.Date);
  if (out.Staff != null) out.Staff = String(out.Staff);
  if (out.Staff_Expenses_JSON != null) out.Staff_Expenses_JSON = String(out.Staff_Expenses_JSON);
  if (out.Product_Sales_JSON != null) out.Product_Sales_JSON = String(out.Product_Sales_JSON);
  return out;
}

export async function salesFinanceGetByDate({ date }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  await ensureSalesSheet();
  const sheet = await readSheetAsObjects(SHEET_SALES);
  assertHeaders(SHEET_SALES, sheet.headers, ['Date']);
  const matches = sheet.values.filter((r) => normalizeDateKey(r.Date) === date);
  if (!matches.length) return { date, row: null };
  return { date, row: normalizeSalesRow(matches[matches.length - 1]) };
}

export async function salesFinanceDeleteByDate({ date }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  await ensureSalesSheet();
  const sheet = await readSheetAsObjects(SHEET_SALES);
  assertHeaders(SHEET_SALES, sheet.headers, ['Date']);
  const next = sheet.values.filter((r) => normalizeDateKey(r.Date) !== date);
  await overwriteSheetFromObjects(SHEET_SALES, sheet.headers, next);
  return sheet.values.length - next.length;
}

export async function salesFinanceUpsertByDate({ date, row }) {
  if (!isIsoDate(date)) throw new Error('payload.date must be YYYY-MM-DD');
  if (!row) throw new Error('payload.row is required');

  const cfgRes = await salesConfigGet();
  const cfg = cfgRes?.config || defaultSalesConfig();
  const breakdownKeys = (Array.isArray(cfg.expenseBreakdown) ? cfg.expenseBreakdown : [])
    .map((f) => String(f && f.key ? f.key : '').trim())
    .filter((k) => k);

  const extraHeaders = breakdownKeys.concat(['Staff_Expenses_JSON', 'Staff_Expenses_Total', 'Product_Sales_JSON', 'Product_Sales_Total']);
  await ensureSalesSheet(extraHeaders);
  const sheet = await readSheetAsObjects(SHEET_SALES);

  // Build computed fields (mirrors Apps Script)
  const takoyakiSales = toNumber(row.Takoyaki_Sales);
  const breakdownTotal = breakdownKeys.reduce((sum, k) => sum + toNumber(row[k]), 0);
  const staffExpenses = normalizeStaffExpenses(row.Staff_Expenses_JSON);
  const expensesTotal = breakdownTotal + staffExpenses.total;
  const totalCash = takoyakiSales - expensesTotal;
  const prevCash = toNumber(row.Previous_Cash_Added);
  const finalCash = totalCash + prevCash;
  const payoutMykah = toNumber(row.Payout_Mykah);
  const payoutNatalie = toNumber(row.Payout_Natalie);
  const remaining = finalCash - payoutMykah - payoutNatalie;

  const normalized = {
    Date: `${date}T00:00:00.000Z`,
    Takoyaki_Sales: takoyakiSales,
    Expenses_Total: expensesTotal,
    Total_Cash_Calculated: totalCash,
    Previous_Cash_Added: prevCash,
    Final_Total_Cash: finalCash,
    Payout_Mykah: payoutMykah,
    Payout_Natalie: payoutNatalie,
    Remaining_Balance: remaining,
  };
  breakdownKeys.forEach((k) => {
    normalized[k] = toNumber(row[k]);
  });
  if (row.Staff != null) normalized.Staff = String(row.Staff);
  if (staffExpenses.json) normalized.Staff_Expenses_JSON = staffExpenses.json;
  normalized.Staff_Expenses_Total = staffExpenses.total;
  if (row.Product_Sales_JSON != null) normalized.Product_Sales_JSON = String(row.Product_Sales_JSON || '');
  normalized.Product_Sales_Total = takoyakiSales;

  const remainingRows = sheet.values.filter((r) => normalizeDateKey(r.Date) !== date);
  await overwriteSheetFromObjects(SHEET_SALES, sheet.headers, remainingRows.concat([normalized]));
  return { date };
}

export async function salesFinanceList({ from, to }) {
  const fromKey = from && isIsoDate(from) ? from : '';
  const toKey = to && isIsoDate(to) ? to : '';
  await ensureSalesSheet();
  const sheet = await readSheetAsObjects(SHEET_SALES);
  assertHeaders(SHEET_SALES, sheet.headers, ['Date']);
  const rows = sheet.values
    .map((r) => normalizeSalesRow(r))
    .filter((r) => {
      const d = normalizeDateKey(r.Date);
      if (fromKey && d < fromKey) return false;
      if (toKey && d > toKey) return false;
      return true;
    })
    .sort((a, b) => String(a.Date || '').localeCompare(String(b.Date || '')));
  return { rows };
}

export async function salesBootstrap({ date }) {
  if (!isIsoDate(date)) throw new Error('date is required (YYYY-MM-DD)');
  const [cfg, prods, row] = await Promise.all([
    salesConfigGet(),
    productsList(),
    salesFinanceGetByDate({ date }),
  ]);
  return { date, config: cfg.config, products: prods.items || [], row: row.row };
}

// ---------------- Debug helpers ----------------

export async function __healthcheck() {
  try {
    await ensureInventorySheet();
    await ensureInventoryHistorySheet();
    await ensureSalesSheet();
    await ensureNeedsSheet();
    await ensureConfigSheet();
    await ensureProductsSheet();
    await getOrCreateUsersSheet();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: safeMessage(err) };
  }
}

export async function debugAuthInfo() {
  return getAuthDebugInfo();
}
