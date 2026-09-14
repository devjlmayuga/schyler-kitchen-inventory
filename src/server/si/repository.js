const adapter = await import('./postgres/neonRepository.js');

export const ensureHeaders = adapter.ensureHeaders;
export const ensureSheet = adapter.ensureSheet;
export const readSheetAsObjects = adapter.readSheetAsObjects;
export const overwriteSheetFromObjects = adapter.overwriteSheetFromObjects;
export const appendRows = adapter.appendRows;
export const replaceAttendanceWeek = adapter.replaceAttendanceWeek;
export const replaceInventoryDay = adapter.replaceInventoryDay;
export const deleteInventoryDay = adapter.deleteInventoryDay;
export const getInventoryDayOrSeed = adapter.getInventoryDayOrSeed;
export const getInventorySeedTemplate = adapter.getInventorySeedTemplate;
export const findUser = adapter.findUser;
export const upsertUser = adapter.upsertUser;
export const upsertInventoryItems = adapter.upsertInventoryItems;
export const deleteInventoryItem = adapter.deleteInventoryItem;
export const updateInventoryThreshold = adapter.updateInventoryThreshold;
export const upsertManualNeed = adapter.upsertManualNeed;
export const deleteManualNeed = adapter.deleteManualNeed;
export const saveConfig = adapter.saveConfig;
export const upsertProducts = adapter.upsertProducts;
export const deleteProduct = adapter.deleteProduct;
export const getSalesBootstrapData = adapter.getSalesBootstrapData;
export const getAutoAttendanceWeek = adapter.getAutoAttendanceWeek;
export const upsertSalesDay = adapter.upsertSalesDay;
export const deleteSalesDay = adapter.deleteSalesDay;
export const getSheetTitles = adapter.getSheetTitles;
export const getAuthDebugInfo = adapter.getAuthDebugInfo;

export async function withStorageTransaction(action, operation) {
  const { withTransaction } = await import('./postgres/client.js');
  return withTransaction(action, operation);
}
