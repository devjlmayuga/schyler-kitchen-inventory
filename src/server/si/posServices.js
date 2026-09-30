import crypto from 'node:crypto';
import {
  addOrderToLedger,
  normalizeOrderRequest,
  priceOrder,
  orderError,
  validBusinessDate,
  validOrderId,
  normalizeOrderEdit,
  replaceOrderInLedger,
  normalizeOrderDeletion,
  removeOrderFromLedger,
} from '../../lib/pos.js';
import {
  lockOrder,
  lockSalesDay,
  findOrder,
  insertOrder,
  listOrders,
  mapOrder,
  orderSummary,
  findOrderEdit,
  updateOrder,
  markOrderDeleted,
} from './postgres/posRepository.js';
import { salesBootstrap, salesFinanceGetByDate, salesFinanceUpsertByDate } from './_services.js';

export async function posBootstrap({ date }) {
  if (!validBusinessDate(date)) throw orderError('A valid date is required.');
  const [sales, history] = await Promise.all([salesBootstrap({ date }), listOrders(date)]);
  return { products: sales.products, sales: sales.row, ...history };
}

export async function posOrderGet({ id }) {
  if (!validOrderId(id)) throw orderError('A valid order reference is required.');
  const row = await findOrder(id);
  if (!row) throw orderError('This order could not be found.');
  if (row.deleted_at) {
    const { row: sales } = await salesFinanceGetByDate({ date: row.business_date });
    return { order: mapOrder(row), sales, summary: await orderSummary(row.business_date) };
  }
  return { order: mapOrder(row) };
}

export async function posDelete(raw, cashier) {
  const request = normalizeOrderDeletion(raw);
  await lockOrder(request.id);
  const existing = await findOrder(request.id);
  if (!existing) throw orderError('This order could not be found.');
  const date = existing.business_date;
  await lockSalesDay(date);
  const { row } = await salesFinanceGetByDate({ date });
  // Retain the order identity so retries (including the original checkout) cannot recreate revenue.
  if (existing.deleted_at)
    return { order: mapOrder(existing), sales: row, summary: await orderSummary(date), repeated: true };
  if (Number(existing.revision) !== request.revision)
    throw orderError(
      'This sale changed on another screen. Reload and review it before deleting.',
      'ORDER_CONFLICT',
    );
  if (!row) throw orderError('The daily sales record is missing. Reload and review this day.');
  await salesFinanceUpsertByDate({ date, row: removeOrderFromLedger(row, existing.details), fromPos: true });
  const order = await markOrderDeleted({ ...request, cashier });
  const { row: sales } = await salesFinanceGetByDate({ date });
  return { order, sales, summary: await orderSummary(date), repeated: false };
}

export async function posEdit(raw, cashier) {
  const request = normalizeOrderEdit(raw);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
  await lockOrder(request.id);
  const existing = await findOrder(request.id);
  if (!existing) throw orderError('This order could not be found.');
  if (existing.deleted_at)
    throw orderError('This sale was deleted. Close the editor and refresh saved orders.', 'ORDER_CONFLICT');
  if (request.date !== existing.business_date) throw orderError('The original sale date cannot be changed.');
  await lockSalesDay(request.date);
  const recordedEdit = await findOrderEdit(request.editId);
  if (recordedEdit) {
    if (
      recordedEdit.request_hash !== fingerprint ||
      recordedEdit.created_by !== cashier ||
      recordedEdit.order_id !== request.id
    )
      throw orderError(
        'This correction reference was already used. Reload the saved order.',
        'ORDER_CONFLICT',
      );
    const { row } = await salesFinanceGetByDate({ date: request.date });
    return {
      order: mapOrder(existing),
      sales: row,
      summary: await orderSummary(request.date),
      repeated: true,
    };
  }
  if (Number(existing.revision) !== request.revision)
    throw orderError(
      'This sale was edited on another screen. Reload the latest order before saving.',
      'ORDER_CONFLICT',
    );
  const { products, row } = await salesBootstrap({ date: request.date });
  if (!row) throw orderError('The daily sales record is missing. Reload and review this day.');
  const details = priceOrder(request, products, existing.details);
  const ledger = replaceOrderInLedger(row, existing.details, details);
  await salesFinanceUpsertByDate({ date: request.date, row: ledger, fromPos: true });
  const order = await updateOrder({ request, fingerprint, details, previous: existing.details, cashier });
  const { row: sales } = await salesFinanceGetByDate({ date: request.date });
  return { order, sales, summary: await orderSummary(request.date), repeated: false };
}

export async function posOrdersList({ date, before }) {
  if (!validBusinessDate(date)) throw orderError('A valid date is required.');
  if (before && !/^[1-9]\d{0,17}$/.test(String(before))) throw orderError('Invalid order history page.');
  return listOrders(date, before || null);
}

export async function posComplete(raw, cashier) {
  const request = normalizeOrderRequest(raw);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
  await lockOrder(request.id);
  const existing = await findOrder(request.id);
  if (existing) {
    if (existing.request_hash !== fingerprint || existing.created_by !== cashier)
      throw orderError(
        'This order reference has already been used. Reload POS to review saved orders.',
        'ORDER_CONFLICT',
      );
    if (existing.deleted_at)
      throw orderError('This sale was deleted and cannot be restored by retrying checkout.');
    const { row } = await salesFinanceGetByDate({ date: request.date });
    return {
      order: mapOrder(existing),
      sales: row,
      summary: await orderSummary(request.date),
      repeated: true,
    };
  }
  await lockSalesDay(request.date);
  const { products, row } = await salesBootstrap({ date: request.date });
  const details = priceOrder(request, products);
  const ledger = addOrderToLedger(row || {}, details);
  await salesFinanceUpsertByDate({ date: request.date, row: ledger, fromPos: true });
  const order = await insertOrder({ ...request, fingerprint, details, cashier });
  const { row: sales } = await salesFinanceGetByDate({ date: request.date });
  return { order, sales, summary: await orderSummary(request.date), repeated: false };
}
