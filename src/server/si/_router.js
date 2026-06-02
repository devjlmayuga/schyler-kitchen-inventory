import {
  authAdminUpsertUser,
  authLogin,
  inventoryDeleteDay,
  inventoryGet,
  inventoryGetOrSeed,
  inventorySeedTemplate,
  inventorySetClosed,
  inventorySubmit,
  itemsDelete,
  itemsList,
  itemsUpsert,
  itemsUpsertMany,
  needsList,
  needsManualRemove,
  needsManualUpsert,
  productsDelete,
  productsList,
  productsUpsert,
  productsUpsertMany,
  requireAdmin,
  requireAuth,
  salesBootstrap,
  salesConfigGet,
  salesConfigSave,
  salesFinanceDeleteByDate,
  salesFinanceGetByDate,
  salesFinanceList,
  salesFinanceUpsertByDate,
  thresholdsGet,
  thresholdsUpdate,
  debugAuthInfo,
} from './_services.js';

export async function dispatchAction({ action, token, session, payload }) {
  switch (String(action || '')) {
    // Auth
    case 'auth.me': {
      const user = await requireAuth({ token, session });
      return { user };
    }
    case 'auth.login': {
      const username = String(payload?.username || '');
      const password = String(payload?.password || '');
      return await authLogin({ username, password });
    }
    case 'auth.admin.upsertUser': {
      const ctx = await requireAuth({ token, session });
      requireAdmin(ctx);
      const username = String(payload?.username || '');
      const password = String(payload?.password || '');
      const role = String(payload?.role || 'staff');
      const active = payload?.active == null ? 'Y' : String(payload.active);
      return await authAdminUpsertUser({ username, password, role, active });
    }

    // Inventory
    case 'inventory.get': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      return await inventoryGet({ date });
    }
    case 'inventory.getOrSeed': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      return await inventoryGetOrSeed({ date });
    }
    case 'inventory.seedTemplate': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      return await inventorySeedTemplate({ date });
    }
    case 'inventory.submit': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      const items = payload?.items;
      const updated = await inventorySubmit({ date, items });
      return { updated };
    }
    case 'inventory.deleteDay': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      const deleted = await inventoryDeleteDay({ date });
      return { deleted };
    }
    case 'inventory.setClosed': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      const closed = payload?.closed;
      return await inventorySetClosed({ date, closed });
    }

    // Sales / Finance
    case 'sales.bootstrap': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      return await salesBootstrap({ date });
    }
    case 'salesFinance.list': {
      await requireAuth({ token, session });
      return await salesFinanceList({ from: String(payload?.from || ''), to: String(payload?.to || '') });
    }
    case 'salesFinance.getByDate': {
      await requireAuth({ token, session });
      return await salesFinanceGetByDate({ date: String(payload?.date || '') });
    }
    case 'salesFinance.upsertByDate': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      const row = payload?.row || null;
      const saved = await salesFinanceUpsertByDate({ date, row });
      return { saved };
    }
    case 'salesFinance.deleteByDate': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      const deleted = await salesFinanceDeleteByDate({ date });
      return { deleted };
    }

    // Needs
    case 'needs.list': {
      await requireAuth({ token, session });
      return await needsList({ date: String(payload?.date || ''), source: String(payload?.source || 'derived') });
    }
    case 'needs.manual.upsert': {
      await requireAuth({ token, session });
      await needsManualUpsert({ date: String(payload?.date || ''), item: payload?.item || null });
      return { ok: true };
    }
    case 'needs.manual.remove': {
      await requireAuth({ token, session });
      const date = String(payload?.date || '');
      const product = String(payload?.Product || payload?.product || '');
      await needsManualRemove({ date, product });
      return { ok: true };
    }

    // Thresholds / Items
    case 'thresholds.get': {
      await requireAuth({ token, session });
      return await thresholdsGet();
    }
    case 'thresholds.update': {
      await requireAuth({ token, session });
      const product = String(payload?.product || '');
      const threshold = Number(payload?.threshold || 0);
      await thresholdsUpdate({ product, threshold });
      return { ok: true };
    }
    case 'items.list': {
      await requireAuth({ token, session });
      return await itemsList();
    }
    case 'items.upsert': {
      await requireAuth({ token, session });
      await itemsUpsert(payload?.item || null);
      return { ok: true };
    }
    case 'items.upsertMany': {
      await requireAuth({ token, session });
      return await itemsUpsertMany(payload?.items || null);
    }
    case 'items.delete': {
      await requireAuth({ token, session });
      return await itemsDelete({ product: String(payload?.product || '') });
    }

    // Products
    case 'products.list': {
      await requireAuth({ token, session });
      return await productsList();
    }
    case 'products.upsert': {
      await requireAuth({ token, session });
      await productsUpsert(payload?.item || null);
      return { ok: true };
    }
    case 'products.upsertMany': {
      await requireAuth({ token, session });
      return await productsUpsertMany(payload?.items || null);
    }
    case 'products.delete': {
      await requireAuth({ token, session });
      const name = String(payload?.name || payload?.Name || '');
      const deleted = await productsDelete({ name });
      return { deleted };
    }

    // Sales config
    case 'salesConfig.get': {
      await requireAuth({ token, session });
      return await salesConfigGet();
    }
    case 'salesConfig.save': {
      await requireAuth({ token, session });
      const config = payload?.config || null;
      if (!config) throw new Error('payload.config is required');
      await salesConfigSave(config);
      return { ok: true };
    }

    // Debug (requires auth)
    case 'debug.auth': {
      await requireAuth({ token, session });
      return await debugAuthInfo();
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
