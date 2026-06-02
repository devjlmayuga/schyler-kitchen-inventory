/** Code.gs — Google Apps Script Web App (per-day CRUD + admin thresholds)
 *
 * Script Properties required:
 * - SPREADSHEET_ID
 * - API_TOKEN
 *
 * Tabs:
 * - Inventory
 * - Inventory_History
 * - Sales_Finance
 * - Needs_Replenish
 */

const SHEET_INVENTORY = 'Inventory';
const SHEET_INV_HISTORY = 'Inventory_History';
const SHEET_SALES = 'Sales_Finance';
const OTHER_EXPENSES_REMARK_KEY = 'Other_Expenses_Remark';
const SHEET_NEEDS = 'Needs_Replenish';
const SHEET_CONFIG = 'Config';
const SHEET_USERS = 'Users';
const SHEET_PRODUCTS = 'Products';

const SESSION_TTL_SECONDS = 21600; // 6 hours (Apps Script cache max)

// ---------------- Performance (Cache + in-memory) ----------------

const CACHE_PREFIX = 'simple_inventory_v1';
const CACHE_TTL = {
  itemsList: 300, // 5 min
  thresholdsGet: 300, // 5 min
  salesConfigGet: 300, // 5 min
  productsList: 300, // 5 min
  inventoryGet: 45, // 45s
  salesFinanceGetByDate: 45, // 45s
  needsList: 45, // 45s (manual needs)
};

function cacheKey(parts) {
  return [CACHE_PREFIX].concat(parts).join('|');
}

function cacheGetJson(key) {
  const cache = CacheService.getScriptCache();
  const raw = cache.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cachePutJson(key, value, ttlSeconds) {
  const cache = CacheService.getScriptCache();
  try {
    cache.put(key, JSON.stringify(value), ttlSeconds);
  } catch {
    // Ignore cache write failures (e.g. payload too large); correctness must not depend on cache.
  }
}

function cacheRemove(key) {
  const cache = CacheService.getScriptCache();
  try {
    cache.remove(key);
  } catch {
    // Ignore
  }
}

let _SPREADSHEET = null;
const _SHEETS = {};

function doGet(e) {
  try {
    const action = (e?.parameter?.action || '').toString();
    const token = (e?.parameter?.token || '').toString();
    const session = (e?.parameter?.session || '').toString();
    if (!action) return jsonError('BAD_REQUEST', 'Missing action');

    switch (action) {
      case 'auth.me':
        {
          const user = requireAuth({ token, session });
          return jsonOk({ user });
        }
      case 'inventory.get':
        {
          requireAuth({ token, session });
          const date = (e?.parameter?.date || '').toString();
          if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'date is required (YYYY-MM-DD)');
          return jsonOk(inventoryGet({ date }));
        }
      case 'inventory.getOrSeed':
        {
          requireAuth({ token, session });
          const date = (e?.parameter?.date || '').toString();
          if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'date is required (YYYY-MM-DD)');
          return jsonOk(inventoryGetOrSeed({ date }));
        }
      case 'inventory.seedTemplate':
        {
          requireAuth({ token, session });
          const date = (e?.parameter?.date || '').toString();
          if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'date is required (YYYY-MM-DD)');
          return jsonOk(inventorySeedTemplate({ date }));
        }
      case 'salesFinance.list':
        requireAuth({ token, session });
        return jsonOk(
          salesFinanceList({
            from: (e?.parameter?.from || '').toString(),
            to: (e?.parameter?.to || '').toString(),
          }),
        );
      case 'salesFinance.getByDate':
        requireAuth({ token, session });
        return jsonOk(salesFinanceGetByDate({ date: (e?.parameter?.date || '').toString() }));
      case 'needs.list':
        requireAuth({ token, session });
        return jsonOk(
          needsList({
            date: (e?.parameter?.date || '').toString(),
            source: (e?.parameter?.source || 'derived').toString(),
          }),
        );
      case 'thresholds.get':
        requireAuth({ token, session });
        return jsonOk(thresholdsGet());
      case 'items.list':
        requireAuth({ token, session });
        return jsonOk(itemsList());
      case 'salesConfig.get':
        requireAuth({ token, session });
        return jsonOk(salesConfigGet());
      case 'products.list':
        requireAuth({ token, session });
        return jsonOk(productsList());
      case 'sales.bootstrap':
        {
          requireAuth({ token, session });
          const date = (e?.parameter?.date || '').toString();
          if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'date is required (YYYY-MM-DD)');
          return jsonOk(salesBootstrap({ date }));
        }
      default:
        return jsonError('NOT_FOUND', `Unknown action: ${action}`);
    }
  } catch (err) {
    const msg = safeMessage(err);
    const lower = msg.toLowerCase();
    const code =
      lower.includes('unauthorized') ||
      lower.includes('not authenticated') ||
      lower.includes('invalid username') ||
      lower.includes('account is disabled')
        ? 'UNAUTHENTICATED'
        : 'SERVER_ERROR';
    return jsonError(code, msg);
  }
}

function doPost(e) {
  try {
    const bodyText = e?.postData?.contents ? String(e.postData.contents) : '';
    const body = bodyText ? JSON.parse(bodyText) : {};
    const action = body.action ? String(body.action) : '';
    const token = body.token ? String(body.token) : '';
    const session = body.session ? String(body.session) : '';
    if (!action) return jsonError('BAD_REQUEST', 'Missing action');

    switch (action) {
      case 'auth.login': {
        const username = String(body?.payload?.username || '');
        const password = String(body?.payload?.password || '');
        const result = authLogin({ username, password });
        return jsonOk(result);
      }
      case 'auth.admin.upsertUser': {
        const ctx = requireAuth({ token, session });
        requireAdmin(ctx);
        const username = String(body?.payload?.username || '');
        const password = String(body?.payload?.password || '');
        const role = String(body?.payload?.role || 'staff');
        const active = body?.payload?.active == null ? 'Y' : String(body?.payload?.active);
        const result = authAdminUpsertUser({ username, password, role, active });
        return jsonOk(result);
      }
      case 'inventory.submit': {
        requireAuth({ token, session });
        const date = String(body?.payload?.date || '');
        const items = body?.payload?.items;
        if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'payload.date must be YYYY-MM-DD');
        if (!Array.isArray(items)) return jsonError('BAD_REQUEST', 'payload.items must be an array');
        const updated = inventorySubmit({ date, items });
        return jsonOk({ updated });
      }
      case 'inventory.deleteDay': {
        requireAuth({ token, session });
        const date = String(body?.payload?.date || '');
        if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'payload.date must be YYYY-MM-DD');
        const deleted = inventoryDeleteDay({ date });
        return jsonOk({ deleted });
      }
      case 'inventory.setClosed': {
        requireAuth({ token, session });
        const date = String(body?.payload?.date || '');
        const closed = body?.payload?.closed;
        if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'payload.date must be YYYY-MM-DD');
        if (typeof closed !== 'boolean') return jsonError('BAD_REQUEST', 'payload.closed must be boolean');
        const result = inventorySetClosed({ date, closed });
        return jsonOk(result);
      }
      case 'salesFinance.upsertByDate': {
        requireAuth({ token, session });
        const date = String(body?.payload?.date || '');
        const row = body?.payload?.row || null;
        if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'payload.date must be YYYY-MM-DD');
        if (!row) return jsonError('BAD_REQUEST', 'payload.row is required');
        const saved = salesFinanceUpsertByDate({ date, row });
        return jsonOk({ saved });
      }
      case 'salesFinance.deleteByDate': {
        requireAuth({ token, session });
        const date = String(body?.payload?.date || '');
        if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'payload.date must be YYYY-MM-DD');
        const deleted = salesFinanceDeleteByDate({ date });
        return jsonOk({ deleted });
      }
      case 'needs.manual.upsert': {
        requireAuth({ token, session });
        const date = String(body?.payload?.date || '');
        const item = body?.payload?.item || null;
        if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'payload.date must be YYYY-MM-DD');
        if (!item?.Product) return jsonError('BAD_REQUEST', 'payload.item.Product is required');
        needsManualUpsert({ date, item });
        return jsonOk({ ok: true });
      }
      case 'needs.manual.remove': {
        requireAuth({ token, session });
        const date = String(body?.payload?.date || '');
        const product = String(body?.payload?.Product || body?.payload?.product || '');
        if (!isIsoDate(date)) return jsonError('BAD_REQUEST', 'payload.date must be YYYY-MM-DD');
        if (!product) return jsonError('BAD_REQUEST', 'payload.Product is required');
        needsManualRemove({ date, product });
        return jsonOk({ ok: true });
      }
      case 'thresholds.update': {
        requireAuth({ token, session });
        const product = String(body?.payload?.product || '');
        const threshold = Number(body?.payload?.threshold || 0);
        if (!product) return jsonError('BAD_REQUEST', 'payload.product is required');
        thresholdsUpdate({ product, threshold });
        return jsonOk({ ok: true });
      }
      case 'items.upsert': {
        requireAuth({ token, session });
        const item = body?.payload?.item || null;
        if (!item?.Product) return jsonError('BAD_REQUEST', 'payload.item.Product is required');
        itemsUpsert(item);
        return jsonOk({ ok: true });
      }
      case 'items.upsertMany': {
        requireAuth({ token, session });
        const items = body?.payload?.items || null;
        if (!Array.isArray(items)) return jsonError('BAD_REQUEST', 'payload.items must be an array');
        const result = itemsUpsertMany(items);
        return jsonOk(result);
      }
      case 'items.delete': {
        requireAuth({ token, session });
        const product = String(body?.payload?.product || '');
        if (!product) return jsonError('BAD_REQUEST', 'payload.product is required');
        const deleted = itemsDelete({ product });
        return jsonOk({ deleted });
      }
      case 'salesConfig.save': {
        requireAuth({ token, session });
        const config = body?.payload?.config || null;
        if (!config) return jsonError('BAD_REQUEST', 'payload.config is required');
        salesConfigSave(config);
        return jsonOk({ ok: true });
      }
      case 'products.upsert': {
        requireAuth({ token, session });
        const item = body?.payload?.item || null;
        if (!item?.Name) return jsonError('BAD_REQUEST', 'payload.item.Name is required');
        productsUpsert(item);
        return jsonOk({ ok: true });
      }
      case 'products.upsertMany': {
        requireAuth({ token, session });
        const items = body?.payload?.items || null;
        if (!Array.isArray(items)) return jsonError('BAD_REQUEST', 'payload.items must be an array');
        const result = productsUpsertMany(items);
        return jsonOk(result);
      }
      case 'products.delete': {
        requireAuth({ token, session });
        const name = String(body?.payload?.name || body?.payload?.Name || '');
        if (!name) return jsonError('BAD_REQUEST', 'payload.name is required');
        const deleted = productsDelete({ name });
        return jsonOk({ deleted });
      }
      default:
        return jsonError('NOT_FOUND', `Unknown action: ${action}`);
    }
  } catch (err) {
    const msg = safeMessage(err);
    const lower = msg.toLowerCase();
    const code =
      lower.includes('unauthorized') ||
      lower.includes('not authenticated') ||
      lower.includes('invalid username') ||
      lower.includes('account is disabled')
        ? 'UNAUTHENTICATED'
        : 'SERVER_ERROR';
    return jsonError(code, msg);
  }
}

// ---------------- Inventory ----------------

const INV_DAY_CLOSED_COL = 'Is_Closed';

function addDaysIso(dateStr, deltaDays) {
  // dateStr must be YYYY-MM-DD
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function inventoryGet({ date }) {
  const dateKey = date;

  const ck = cacheKey(['inventory.get', dateKey]);
  const cached = cacheGetJson(ck);
  if (cached) return cached;

  const historySheet = getSheet(SHEET_INV_HISTORY);
  // Backwards-compatible: ensure the day-closed column exists (older sheets won't have it).
  ensureHeaders(historySheet, [INV_DAY_CLOSED_COL]);
  const history = readSheetAsObjects(historySheet);
  assertHeaders(SHEET_INV_HISTORY, history.headers, ['Date', 'Product']);

  const histRows = history.values
    .filter((r) => normalizeDateKey(r.Date) === dateKey)
    .map((r) => normalizeInventoryHistoryRow(r, history.headers));

  // Only return per-day rows. If none exist for date, return empty list.
  const closed = histRows.some((r) => isClosedFlag(r[INV_DAY_CLOSED_COL]));
  const out = { date: dateKey, closed, items: histRows };
  cachePutJson(ck, out, CACHE_TTL.inventoryGet);
  return out;
}

function inventoryGetOrSeed({ date }) {
  const existing = inventoryGet({ date });
  if (existing && Array.isArray(existing.items) && existing.items.length) {
    return { date: existing.date || date, seeded: false, closed: !!existing.closed, items: existing.items };
  }
  const seeded = inventorySeedTemplate({ date });
  return { ...seeded, seeded: true, closed: false };
}

function inventorySubmit({ date, items }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Upsert Inventory_History for this date: delete existing date rows then append new
    inventoryDeleteDay({ date });
    const historySheet = getSheet(SHEET_INV_HISTORY);
    ensureHeaders(historySheet, [INV_DAY_CLOSED_COL]);
    const history = readSheetAsObjects(historySheet);
    assertHeaders(SHEET_INV_HISTORY, history.headers, ['Date', 'Product']);

    const historyRows = items.map((raw) => {
      const product = String(raw.Product || '').trim();
      const rowObj = {
        Date: date,
        Product: product,
        Current_Qty: toNumber(raw.Current_Qty),
        In_Stock: toNumber(raw.In_Stock),
        Out_Stock: toNumber(raw.Out_Stock),
        Closing_Qty: toNumber(raw.Closing_Qty),
        Unit: raw.Unit != null ? String(raw.Unit) : '',
        Threshold_Limit: toNumber(raw.Threshold_Limit),
        [INV_DAY_CLOSED_COL]: isClosedFlag(raw[INV_DAY_CLOSED_COL]) ? 'Y' : '',
      };
      return history.headers.map((h) => (h in rowObj ? rowObj[h] : ''));
    });

    if (historyRows.length) {
      historySheet.getRange(historySheet.getLastRow() + 1, 1, historyRows.length, history.headers.length).setValues(historyRows);
    }

    cacheRemove(cacheKey(['inventory.get', date]));

    return items.length;
  } finally {
    lock.releaseLock();
  }
}

function inventoryDeleteDay({ date }) {
  cacheRemove(cacheKey(['inventory.get', date]));
  const sheet = getSheet(SHEET_INV_HISTORY);
  ensureHeaders(sheet, [INV_DAY_CLOSED_COL]);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_INV_HISTORY, data.headers, ['Date']);
  const values = data.values;
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const d = normalizeDateKey(values[i].Date);
    if (d === date) {
      sheet.deleteRow(i + 2);
      deleted += 1;
    }
  }
  return deleted;
}

function normalizeInventoryRow(r, headers) {
  const out = Object.assign({}, r);
  ['Current_Qty', 'In_Stock', 'Out_Stock', 'Closing_Qty', 'Threshold_Limit'].forEach((k) => {
    if (headers.indexOf(k) >= 0) out[k] = toNumber(out[k]);
  });
  out.Product = String(out.Product || '');
  out.Unit = String(out.Unit || '');
  if (headers.indexOf(INV_DAY_CLOSED_COL) >= 0) out[INV_DAY_CLOSED_COL] = String(out[INV_DAY_CLOSED_COL] || '');
  return out;
}

function normalizeInventoryHistoryRow(r, headers) {
  const out = normalizeInventoryRow(r, headers);
  out.Date = String(r.Date || '').slice(0, 10);
  return out;
}

function isClosedFlag(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const s = String(value).trim().toUpperCase();
  return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1';
}

function inventoryFindLastOpenDateBefore({ date }) {
  const historySheet = getSheet(SHEET_INV_HISTORY);
  ensureHeaders(historySheet, [INV_DAY_CLOSED_COL]);
  const history = readSheetAsObjects(historySheet);
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
  // Prefer latest date that is not marked closed.
  for (let i = candidates.length - 1; i >= 0; i--) {
    const d = candidates[i];
    if (!closedDates.has(d)) return d;
  }
  // Fallback: if all prior dates are closed, pick the latest one.
  return candidates.length ? candidates[candidates.length - 1] : '';
}

function inventorySeedTemplate({ date }) {
  const seedFrom = inventoryFindLastOpenDateBefore({ date });
  const itemsRes = itemsList();
  const prevRes = seedFrom ? inventoryGet({ date: seedFrom }) : { items: [] };
  const prevItems = prevRes && Array.isArray(prevRes.items) ? prevRes.items : [];
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

function inventorySetClosed({ date, closed }) {
  const existing = inventoryGet({ date });
  const hasRows = existing && Array.isArray(existing.items) && existing.items.length;

  if (!closed) {
    if (!hasRows) return { date, closed: false, updated: 0 };
    const opened = existing.items.map((r) => ({ ...r, [INV_DAY_CLOSED_COL]: '' }));
    const normalized = opened.map((r) => ({
      ...r,
      Current_Qty: toNumber(r.Current_Qty),
      In_Stock: toNumber(r.In_Stock),
      Out_Stock: toNumber(r.Out_Stock),
      Closing_Qty: toNumber(r.Closing_Qty),
      Threshold_Limit: toNumber(r.Threshold_Limit),
    }));
    const updated = inventorySubmit({ date, items: normalized });
    return { date, closed: false, updated };
  }

  // Mark day as CLOSED. Always seed from the last open day so closed days never change QTY.
  const seeded = inventorySeedTemplate({ date });
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
  const updated = inventorySubmit({ date, items: closedRows });
  return { date, closed: true, updated, seededFrom: seeded ? seeded.seededFrom : null };
}

// ---------------- Sales_Finance ----------------

function salesBootstrap({ date }) {
  const ck = cacheKey(['sales.bootstrap', date]);
  const cached = cacheGetJson(ck);
  if (cached) return cached;
  const out = {
    date,
    config: salesConfigGet(),
    products: productsList().items || [],
    row: salesFinanceGetByDate({ date }).row,
  };
  // Small response; cache briefly.
  cachePutJson(ck, out, 30);
  return out;
}

function salesFinanceGetByDate({ date }) {
  const ck = cacheKey(['salesFinance.getByDate', date]);
  const cached = cacheGetJson(ck);
  if (cached) return cached;

  const sheet = getSheet(SHEET_SALES);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_SALES, data.headers, ['Date']);
  const values = data.values;
  const matches = values.filter((r) => normalizeDateKey(r.Date) === date);
  if (!matches.length) {
    const out = { date, row: null };
    cachePutJson(ck, out, CACHE_TTL.salesFinanceGetByDate);
    return out;
  }
  // If multiple, pick the last one in sheet order (most recent)
  const row = matches[matches.length - 1];
  const out = { date, row: normalizeSalesRow(row) };
  cachePutJson(ck, out, CACHE_TTL.salesFinanceGetByDate);
  return out;
}

function salesFinanceUpsertByDate({ date, row }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEET_SALES);
    const cfg = readSalesConfig();
    const breakdownKeys = (cfg && Array.isArray(cfg.expenseBreakdown) ? cfg.expenseBreakdown : [])
      .map((f) => String(f && f.key ? f.key : '').trim())
      .filter((k) => k);
    ensureHeaders(
      sheet,
      breakdownKeys.concat([OTHER_EXPENSES_REMARK_KEY, 'Staff_Expenses_JSON', 'Staff_Expenses_Total', 'Product_Sales_JSON', 'Product_Sales_Total']),
    );
    const data = readSheetAsObjects(sheet);

    // Build computed fields
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
    // Persist configured breakdown columns
    breakdownKeys.forEach((k) => {
      normalized[k] = toNumber(row[k]);
    });
    normalized[OTHER_EXPENSES_REMARK_KEY] = String(row[OTHER_EXPENSES_REMARK_KEY] || '').trim();
    if (row.Staff != null) normalized.Staff = String(row.Staff);
    if (staffExpenses.json) normalized.Staff_Expenses_JSON = staffExpenses.json;
    normalized.Staff_Expenses_Total = staffExpenses.total;
    if (row.Product_Sales_JSON != null) normalized.Product_Sales_JSON = String(row.Product_Sales_JSON || '');
    // Convenience: store computed sales total for reporting/debug.
    normalized.Product_Sales_Total = takoyakiSales;

    // Delete existing rows for date, then append one fresh row (simple deterministic CRUD)
    salesFinanceDeleteByDate({ date });
    const rowArr = data.headers.map((h) => (h in normalized ? normalized[h] : ''));
    sheet.appendRow(rowArr);

    cacheRemove(cacheKey(['salesFinance.getByDate', date]));

    return { date };
  } finally {
    lock.releaseLock();
  }
}

function salesFinanceDeleteByDate({ date }) {
  cacheRemove(cacheKey(['salesFinance.getByDate', date]));
  const sheet = getSheet(SHEET_SALES);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_SALES, data.headers, ['Date']);
  const values = data.values;
  let deleted = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    const d = normalizeDateKey(values[i].Date);
    if (d === date) {
      sheet.deleteRow(i + 2);
      deleted += 1;
    }
  }
  return deleted;
}

function salesFinanceList({ from, to }) {
  const sheet = getSheet(SHEET_SALES);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_SALES, data.headers, ['Date']);
  const values = data.values;
  const fromDate = from && isIsoDate(from) ? from : '';
  const toDate = to && isIsoDate(to) ? to : '';

  const rows = values
    .map((r) => normalizeSalesRow(r))
    .filter((r) => {
      const d = normalizeDateKey(r.Date);
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    });

  return { rows };
}

function normalizeSalesRow(r) {
  const out = Object.assign({}, r);
  out.Date = String(out.Date || '');
  if (out.Staff != null) out.Staff = String(out.Staff);
  if (out.Staff_Expenses_JSON != null) out.Staff_Expenses_JSON = String(out.Staff_Expenses_JSON || '');
  if (out.Product_Sales_JSON != null) out.Product_Sales_JSON = String(out.Product_Sales_JSON || '');
  if (out[OTHER_EXPENSES_REMARK_KEY] != null) out[OTHER_EXPENSES_REMARK_KEY] = String(out[OTHER_EXPENSES_REMARK_KEY] || '');
  Object.keys(out).forEach((k) => {
    if (
      k === 'Takoyaki_Sales' ||
      k === 'Expenses_Total' ||
      k === 'Total_Cash_Calculated' ||
      k === 'Previous_Cash_Added' ||
      k === 'Final_Total_Cash' ||
      k === 'Payout_Mykah' ||
      k === 'Payout_Natalie' ||
      k === 'Remaining_Balance' ||
      k === 'Staff_Expenses_Total' ||
      k === 'Product_Sales_Total' ||
      String(k).indexOf('Breakdown_') === 0
    ) {
      out[k] = toNumber(out[k]);
    }
  });
  return out;
}

// ---------------- Sales Config ----------------

function salesConfigGet() {
  const ck = cacheKey(['salesConfig.get']);
  const cached = cacheGetJson(ck);
  if (cached) return cached;
  const cfg = readSalesConfig();
  cachePutJson(ck, cfg, CACHE_TTL.salesConfigGet);
  return cfg;
}

function salesConfigSave(config) {
  // Minimal validation + normalization
  const normalized = {
    expenseBreakdown: Array.isArray(config.expenseBreakdown) ? config.expenseBreakdown : [],
    partners: Array.isArray(config.partners) ? config.partners : [],
    staff: Array.isArray(config.staff) ? config.staff : [],
  };
  writeSalesConfig(normalized);
  // Ensure Sales_Finance has all configured expense columns
  const sheet = getSheet(SHEET_SALES);
  const keys = normalized.expenseBreakdown
    .map((f) => String(f && f.key ? f.key : '').trim())
    .filter((k) => k);
  if (keys.length) ensureHeaders(sheet, keys);
  cacheRemove(cacheKey(['salesConfig.get']));
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

function getOrCreateConfigSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CONFIG);
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
  } else {
    const header = sheet.getRange(1, 1, 1, Math.max(2, sheet.getLastColumn())).getValues()[0];
    const a1 = String(header[0] || '').trim();
    const b1 = String(header[1] || '').trim();
    if (a1 !== 'Key' || b1 !== 'Value') {
      sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    }
  }
  return sheet;
}

function readSalesConfig() {
  const sheet = getOrCreateConfigSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][0] || '').trim();
    if (key !== 'sales_config') continue;
    const raw = String(data[i][1] || '').trim();
    if (!raw) return defaultSalesConfig();
    try {
      const parsed = JSON.parse(raw);
      return {
        ...defaultSalesConfig(),
        ...parsed,
      };
    } catch {
      return defaultSalesConfig();
    }
  }
  return defaultSalesConfig();
}

function writeSalesConfig(config) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getOrCreateConfigSheet();
    const data = sheet.getDataRange().getValues();
    const json = JSON.stringify(config);
    for (let i = 1; i < data.length; i++) {
      const key = String(data[i][0] || '').trim();
      if (key !== 'sales_config') continue;
      sheet.getRange(i + 1, 2).setValue(json);
      return;
    }
    sheet.appendRow(['sales_config', json]);
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Products (Catalog) ----------------

function getOrCreateProductsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PRODUCTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PRODUCTS);
    sheet.getRange(1, 1, 1, 4).setValues([['Category', 'Name', 'Price', 'Active']]);
  } else {
    ensureHeaders(sheet, ['Category', 'Name', 'Price', 'Active']);
  }
  return sheet;
}

function productsList() {
  const ck = cacheKey(['products.list']);
  const cached = cacheGetJson(ck);
  if (cached) return cached;
  const sheet = getOrCreateProductsSheet();
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_PRODUCTS, data.headers, ['Category', 'Name', 'Price']);
  const items = data.values
    .map((r) => ({
      Category: String(r.Category || '').trim(),
      Name: String(r.Name || '').trim(),
      Price: toNumber(r.Price),
      Active: String(r.Active || '').trim() || 'Y',
    }))
    .filter((r) => r.Name);
  const out = { items };
  cachePutJson(ck, out, CACHE_TTL.productsList);
  return out;
}

function indexByField(values, field) {
  const map = {};
  values.forEach((r, idx) => {
    const v = String(r[field] || '').trim();
    if (!v) return;
    map[v] = idx + 2;
  });
  return map;
}

function productsUpsert(raw) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getOrCreateProductsSheet();
    const data = readSheetAsObjects(sheet);
    assertHeaders(SHEET_PRODUCTS, data.headers, ['Category', 'Name', 'Price']);

    const name = String(raw.Name || '').trim();
    const category = String(raw.Category || '').trim();
    const price = toNumber(raw.Price);
    const active = raw.Active == null ? 'Y' : String(raw.Active || '').trim() || 'Y';

    const idx = indexByField(data.values, 'Name');
    const rowObj = { Category: category, Name: name, Price: price, Active: active };
    const rowArr = data.headers.map((h) => (h in rowObj ? rowObj[h] : ''));

    if (idx[name]) sheet.getRange(idx[name], 1, 1, data.headers.length).setValues([rowArr]);
    else sheet.appendRow(rowArr);

    cacheRemove(cacheKey(['products.list']));
  } finally {
    lock.releaseLock();
  }
}

function productsUpsertMany(items) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getOrCreateProductsSheet();
    const data = readSheetAsObjects(sheet);
    assertHeaders(SHEET_PRODUCTS, data.headers, ['Category', 'Name', 'Price']);

    const idx = indexByField(data.values, 'Name');
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
      const rowArr = data.headers.map((h) => (h in rowObj ? rowObj[h] : ''));
      if (idx[name]) {
        sheet.getRange(idx[name], 1, 1, data.headers.length).setValues([rowArr]);
        upserts += 1;
      } else {
        sheet.appendRow(rowArr);
        appends += 1;
      }
    });

    cacheRemove(cacheKey(['products.list']));
    return { upserts, appends, total: upserts + appends };
  } finally {
    lock.releaseLock();
  }
}

function productsDelete({ name }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getOrCreateProductsSheet();
    const data = readSheetAsObjects(sheet);
    assertHeaders(SHEET_PRODUCTS, data.headers, ['Name']);
    const target = String(name || '').trim();
    if (!target) return 0;
    let deleted = 0;
    for (let i = data.values.length - 1; i >= 0; i--) {
      const n = String(data.values[i].Name || '').trim();
      if (n === target) {
        sheet.deleteRow(i + 2);
        deleted += 1;
      }
    }
    cacheRemove(cacheKey(['products.list']));
    return deleted;
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Needs ----------------

function needsList({ date, source }) {
  const dateKey = isIsoDate(date) ? date : '';
  const ck = cacheKey(['needs.list', dateKey || 'ALL', String(source || '')]);
  const cached = cacheGetJson(ck);
  if (cached) return cached;

  const sheet = getSheet(SHEET_NEEDS);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_NEEDS, data.headers, ['Date', 'Product', 'Status']);
  const values = data.values;

  const items = values
    .filter((r) => (dateKey ? normalizeDateKey(r.Date) === dateKey : true))
    .map((r) => ({
      Date: normalizeDateKey(r.Date),
      Product: String(r.Product || ''),
      Current_Closing_Qty: toNumber(r.Current_Closing_Qty),
      Status: String(r.Status || ''),
    }))
    .filter((i) => i.Product);

  if (source === 'derived') {
    // Return manual-only; auto needs are derived client-side from inventory.get(date)
    const out = { items: items.filter((i) => i.Status === 'NEEDS_MANUAL') };
    cachePutJson(ck, out, CACHE_TTL.needsList);
    return out;
  }
  const out = { items };
  cachePutJson(ck, out, CACHE_TTL.needsList);
  return out;
}

function needsManualUpsert({ date, item }) {
  cacheRemove(cacheKey(['needs.list', date, 'derived']));
  cacheRemove(cacheKey(['needs.list', date, 'all']));
  const sheet = getSheet(SHEET_NEEDS);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_NEEDS, data.headers, ['Date', 'Product', 'Status']);
  const product = String(item.Product || '').trim();

  // Replace existing manual need with same product for date.
  for (let i = data.values.length - 1; i >= 0; i--) {
    const row = data.values[i];
    if (normalizeDateKey(row.Date) !== date) continue;
    if (String(row.Product || '').trim() !== product) continue;
    sheet.deleteRow(i + 2);
  }

  const rowObj = {
    Date: date,
    Product: product,
    Current_Closing_Qty: toNumber(item.Current_Closing_Qty),
    Status: 'NEEDS_MANUAL',
  };
  const rowArr = data.headers.map((h) => (h in rowObj ? rowObj[h] : ''));
  sheet.appendRow(rowArr);
}

function needsManualRemove({ date, product }) {
  cacheRemove(cacheKey(['needs.list', date, 'derived']));
  cacheRemove(cacheKey(['needs.list', date, 'all']));
  const sheet = getSheet(SHEET_NEEDS);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_NEEDS, data.headers, ['Date', 'Product', 'Status']);
  const values = data.values;
  const target = String(product || '').trim();
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (normalizeDateKey(row.Date) !== date) continue;
    if (String(row.Product || '').trim() !== target) continue;
    sheet.deleteRow(i + 2);
  }
}

// ---------------- Thresholds ----------------

function thresholdsGet() {
  const ck = cacheKey(['thresholds.get']);
  const cached = cacheGetJson(ck);
  if (cached) return cached;
  const sheet = getSheet(SHEET_INVENTORY);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Threshold_Limit']);
  const out = {
    items: data.values.map((r) => ({
      Product: String(r.Product || ''),
      Unit: String(r.Unit || ''),
      Threshold_Limit: toNumber(r.Threshold_Limit),
    })),
  };
  cachePutJson(ck, out, CACHE_TTL.thresholdsGet);
  return out;
}

function thresholdsUpdate({ product, threshold }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEET_INVENTORY);
    const data = readSheetAsObjects(sheet);
    assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Threshold_Limit']);
    const rowNum = indexByProduct(data.values)[product];
    if (!rowNum) throw new Error(`Product not found in Inventory: ${product}`);
    const col = data.headers.indexOf('Threshold_Limit') + 1;
    if (col <= 0) throw new Error('Inventory must have Threshold_Limit column');
    sheet.getRange(rowNum, col).setValue(toNumber(threshold));
    cacheRemove(cacheKey(['thresholds.get']));
    cacheRemove(cacheKey(['items.list']));
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Items (Inventory master CRUD) ----------------

function itemsList() {
  const ck = cacheKey(['items.list']);
  const cached = cacheGetJson(ck);
  if (cached) return cached;
  const sheet = getSheet(SHEET_INVENTORY);
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Unit', 'Threshold_Limit']);
  const out = {
    items: data.values.map((r) => ({
      Product: String(r.Product || ''),
      Unit: String(r.Unit || ''),
      Threshold_Limit: toNumber(r.Threshold_Limit),
    })),
  };
  cachePutJson(ck, out, CACHE_TTL.itemsList);
  return out;
}

function itemsUpsert(item) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEET_INVENTORY);
    const data = readSheetAsObjects(sheet);
    assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Unit', 'Threshold_Limit']);
    const product = String(item.Product || '').trim();
    const unit = item.Unit != null ? String(item.Unit) : '';
    const threshold = toNumber(item.Threshold_Limit);

    const rowNum = indexByProduct(data.values)[product];
    const rowObj = { Product: product, Unit: unit, Threshold_Limit: threshold };
    const rowArr = data.headers.map((h) => (h in rowObj ? rowObj[h] : ''));
    if (rowNum) {
      sheet.getRange(rowNum, 1, 1, data.headers.length).setValues([rowArr]);
    } else {
      sheet.appendRow(rowArr);
    }

    cacheRemove(cacheKey(['items.list']));
    cacheRemove(cacheKey(['thresholds.get']));
  } finally {
    lock.releaseLock();
  }
}

function itemsUpsertMany(items) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet(SHEET_INVENTORY);
    const data = readSheetAsObjects(sheet);
    assertHeaders(SHEET_INVENTORY, data.headers, ['Product', 'Unit', 'Threshold_Limit']);
    const index = indexByProduct(data.values);
    let updated = 0;
    let inserted = 0;

    (items || []).forEach((raw) => {
      const product = String(raw?.Product || '').trim();
      if (!product) return;
      const unit = raw.Unit != null ? String(raw.Unit) : '';
      const threshold = toNumber(raw.Threshold_Limit);

      const rowObj = { Product: product, Unit: unit, Threshold_Limit: threshold };
      const rowArr = data.headers.map((h) => (h in rowObj ? rowObj[h] : ''));
      const rowNum = index[product];
      if (rowNum) {
        sheet.getRange(rowNum, 1, 1, data.headers.length).setValues([rowArr]);
        updated += 1;
      } else {
        sheet.appendRow(rowArr);
        inserted += 1;
      }
    });

    cacheRemove(cacheKey(['items.list']));
    cacheRemove(cacheKey(['thresholds.get']));

    return { updated, inserted, total: updated + inserted };
  } finally {
    lock.releaseLock();
  }
}

function itemsDelete({ product }) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const target = String(product || '').trim();
    if (!target) return { inventory: 0, inventoryHistory: 0, needs: 0 };

    // Inventory master row delete
    const invSheet = getSheet(SHEET_INVENTORY);
    const inv = readSheetAsObjects(invSheet);
    assertHeaders(SHEET_INVENTORY, inv.headers, ['Product']);
    let invDeleted = 0;
    for (let i = inv.values.length - 1; i >= 0; i--) {
      const p = String(inv.values[i].Product || '').trim();
      if (p === target) {
        invSheet.deleteRow(i + 2);
        invDeleted += 1;
      }
    }

    // Inventory history rows delete
    const histSheet = getSheet(SHEET_INV_HISTORY);
    const hist = readSheetAsObjects(histSheet);
    assertHeaders(SHEET_INV_HISTORY, hist.headers, ['Product']);
    let histDeleted = 0;
    for (let i = hist.values.length - 1; i >= 0; i--) {
      const p = String(hist.values[i].Product || '').trim();
      if (p === target) {
        histSheet.deleteRow(i + 2);
        histDeleted += 1;
      }
    }

    // Needs rows delete (all dates)
    const needsSheet = getSheet(SHEET_NEEDS);
    const needs = readSheetAsObjects(needsSheet);
    assertHeaders(SHEET_NEEDS, needs.headers, ['Product']);
    let needsDeleted = 0;
    for (let i = needs.values.length - 1; i >= 0; i--) {
      const p = String(needs.values[i].Product || '').trim();
      if (p === target) {
        needsSheet.deleteRow(i + 2);
        needsDeleted += 1;
      }
    }

    cacheRemove(cacheKey(['items.list']));
    cacheRemove(cacheKey(['thresholds.get']));

    return { inventory: invDeleted, inventoryHistory: histDeleted, needs: needsDeleted };
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Utilities ----------------

function getSpreadsheet() {
  if (_SPREADSHEET) return _SPREADSHEET;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Missing Script Property SPREADSHEET_ID');
  _SPREADSHEET = SpreadsheetApp.openById(id);
  return _SPREADSHEET;
}

function getSheet(name) {
  if (_SHEETS[name]) return _SHEETS[name];
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet tab: ${name}`);
  _SHEETS[name] = sheet;
  return _SHEETS[name];
}

function readSheetAsObjects(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues();
  if (!values.length) return { headers: [], values: [] };
  const headers = values[0].map((h) => String(h || '').trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = row[idx];
    });
    rows.push(obj);
  }
  return { headers, values: rows };
}

function assertHeaders(sheetName, headers, required) {
  const missing = required.filter((h) => headers.indexOf(h) < 0);
  if (missing.length) {
    const shown = headers.filter(Boolean).join(', ') || '(none)';
    throw new Error(`${sheetName} sheet is missing required header(s): ${missing.join(', ')}. Found: ${shown}`);
  }
}

function ensureHeaders(sheet, required) {
  const existing = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map((h) => String(h || '').trim());
  const missing = (required || []).filter((h) => existing.indexOf(h) < 0);
  if (!missing.length) return;
  const next = existing.concat(missing);
  sheet.getRange(1, 1, 1, next.length).setValues([next]);
}

function indexByProduct(values) {
  const map = {};
  values.forEach((r, idx) => {
    const p = String(r.Product || '').trim();
    if (!p) return;
    map[p] = idx + 2; // sheet row number
  });
  return map;
}

function requireToken(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) throw new Error('Missing Script Property API_TOKEN');
  if (!token || token !== expected) throw new Error('Unauthorized: invalid token');
}

function requireAuth({ token, session }) {
  const apiToken = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!apiToken) throw new Error('Missing Script Property API_TOKEN');

  if (token && token === apiToken) {
    return { username: 'api-token', role: 'admin' };
  }

  const st = String(session || '').trim();
  if (!st) throw new Error('Unauthorized: missing session');
  const cached = cacheGetJson(cacheKey(['session', st]));
  if (!cached || !cached.username) throw new Error('Unauthorized: invalid session');
  return { username: String(cached.username), role: String(cached.role || 'staff') };
}

function getOrCreateUsersSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_USERS);
    sheet.getRange(1, 1, 1, 5).setValues([['Username', 'Password_Hash', 'Salt', 'Role', 'Active']]);
  } else {
    ensureHeaders(sheet, ['Username', 'Password_Hash', 'Salt', 'Role', 'Active']);
  }
  return sheet;
}

function bytesToHex(bytes) {
  return bytes
    .map((b) => {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? `0${v}` : v;
    })
    .join('');
}

function hashPassword(password, salt) {
  const pepper = PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER') || '';
  const input = `${String(salt || '')}${String(password || '')}${pepper}`;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return bytesToHex(digest);
}

function authLogin({ username, password }) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!u || !p) throw new Error('Username and password are required');

  const sheet = getOrCreateUsersSheet();
  const data = readSheetAsObjects(sheet);
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
  const sessionToken = Utilities.getUuid();
  cachePutJson(cacheKey(['session', sessionToken]), { username: u, role }, SESSION_TTL_SECONDS);

  return { sessionToken, user: { username: u, role } };
}

function requireAdmin(ctx) {
  if (!ctx || String(ctx.role || '') !== 'admin') throw new Error('Unauthorized: admin only');
}

function authAdminUpsertUser({ username, password, role, active }) {
  const u = String(username || '').trim();
  const p = String(password || '');
  const r = String(role || 'staff').trim() || 'staff';
  if (!u) throw new Error('username is required');
  if (!p) throw new Error('password is required');

  const sheet = getOrCreateUsersSheet();
  const data = readSheetAsObjects(sheet);
  assertHeaders(SHEET_USERS, data.headers, ['Username', 'Password_Hash', 'Salt', 'Role', 'Active']);

  const salt = Utilities.getUuid().replace(/-/g, '');
  const hash = hashPassword(p, salt);
  const rowObj = {
    Username: u,
    Password_Hash: hash,
    Salt: salt,
    Role: r,
    Active: String(active || 'Y'),
  };
  const rowArr = data.headers.map((h) => (h in rowObj ? rowObj[h] : ''));

  // Upsert by Username (case-insensitive)
  let updated = false;
  for (let i = 0; i < data.values.length; i++) {
    const existing = String(data.values[i].Username || '').trim();
    if (!existing) continue;
    if (existing.toLowerCase() !== u.toLowerCase()) continue;
    sheet.getRange(i + 2, 1, 1, data.headers.length).setValues([rowArr]);
    updated = true;
    break;
  }
  if (!updated) {
    sheet.appendRow(rowArr);
  }

  return { username: u, role: r, updated };
}

function jsonOk(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data || {} })).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function jsonError(code, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: { code: String(code), message: String(message) } }),
  ).setMimeType(ContentService.MimeType.JSON);
}

function badRequest(message) {
  return jsonError('BAD_REQUEST', message);
}

function unauthenticated(message) {
  return jsonError('UNAUTHENTICATED', message);
}

function safeMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.message ? String(err.message) : 'Unknown error';
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isFinite(n) ? n : 0;
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

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim());
}

function normalizeDateKey(value) {
  if (!value) return '';
  // Apps Script may return Date objects from getValues() depending on cell formatting.
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  if (isIsoDate(s)) return s;
  // Try parsing other timestamp-like strings
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s.slice(0, 10);
}
