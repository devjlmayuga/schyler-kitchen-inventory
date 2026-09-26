import { appendSale, readAmountMap, readCustomEntries } from './sales.js';

export const ORDER_TYPES = ['Takeaway', 'Dine-in', 'Delivery'];
export const moneyCents = (value) => Math.round(Number(value) * 100);
export const orderNumber = (value) => `#${String(value).padStart(6, '0')}`;
export const validOrderId = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
export const businessDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

export function orderError(message, code = 'ORDER_VALIDATION') {
  return Object.assign(new Error(message), { code });
}

export function validBusinessDate(date) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(String(date)) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  );
}

function text(value, label, max) {
  if (value != null && typeof value !== 'string') throw orderError(`${label} must be text.`);
  const clean = String(value || '').trim();
  if (clean.length > max) throw orderError(`${label} must be ${max} characters or fewer.`);
  return clean;
}

function price(value, label) {
  if (
    value === '' ||
    value == null ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0 ||
    Number(value) > 1000000
  )
    throw orderError(`${label}: enter a valid amount from 0 to 1,000,000.`);
  return moneyCents(value) / 100;
}

export function normalizeOrderRequest(raw) {
  if (!raw || !validOrderId(raw.id))
    throw orderError('A valid order reference is required. Reload POS before saving.');
  if (!validBusinessDate(raw.date)) throw orderError('A valid order date is required.');
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > 100)
    throw orderError('Add between 1 and 100 items to the order.');
  const names = new Set();
  const items = raw.items.map((item) => {
    if (!['menu', 'custom'].includes(item?.kind)) throw orderError('Unknown order item type.');
    const name = text(item.name, 'Item name', item.kind === 'custom' ? 180 : 200);
    if (!name) throw orderError('Every item needs a name.');
    const quantity = Number(item.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999)
      throw orderError(`${name}: quantity must be a whole number from 1 to 999.`);
    if (item.kind === 'menu' && names.has(name))
      throw orderError(`${name} appears twice. Combine its quantities.`);
    if (item.kind === 'menu') names.add(name);
    const unitPrice = price(item.unitPrice, name);
    if (item.kind === 'custom' && unitPrice <= 0)
      throw orderError('Custom sales need an amount greater than 0.');
    return { kind: item.kind, name, quantity, unitPrice };
  });
  const type = raw.type || 'Takeaway';
  if (!ORDER_TYPES.includes(type)) throw orderError('Choose a valid order type.');
  return {
    id: raw.id.toLowerCase(),
    date: raw.date,
    items,
    type,
    customer: text(raw.customer, 'Customer or table', 80),
    notes: text(raw.notes, 'Order notes', 500),
    cashReceived:
      raw.cashReceived === '' || raw.cashReceived == null ? null : price(raw.cashReceived, 'Cash received'),
  };
}

export function normalizeOrderEdit(raw) {
  const request = normalizeOrderRequest(raw);
  if (!validOrderId(raw.editId)) throw orderError('A valid correction reference is required.');
  if (!Number.isSafeInteger(Number(raw.revision)) || Number(raw.revision) < 1)
    throw orderError('Reload the saved order before editing.');
  return {
    ...request,
    editId: raw.editId.toLowerCase(),
    revision: Number(raw.revision),
    reason: text(raw.reason, 'Correction note', 200),
  };
}

export function normalizeOrderDeletion(raw) {
  if (!validOrderId(raw?.id)) throw orderError('A valid order reference is required.');
  if (!Number.isSafeInteger(Number(raw.revision)) || Number(raw.revision) < 1)
    throw orderError('Reload the saved order before deleting.');
  return { id: raw.id.toLowerCase(), revision: Number(raw.revision), reason: text(raw.reason, 'Deletion note', 200) };
}

// Corrections may change the price actually charged. New checkouts always use the catalog price.
export function priceOrder(request, products, previousOrder = null) {
  const items = request.items.map((item) => {
    let unitPrice = item.unitPrice;
    if (item.kind === 'menu') {
      const product = products.find(
        (entry) => entry.Name === item.name && String(entry.Active || 'Y').toUpperCase() !== 'N',
      );
      const recordedItem = previousOrder?.items.some(
        (entry) => entry.kind === 'menu' && entry.name === item.name,
      );
      if (!product && !recordedItem)
        throw orderError(`${item.name} is no longer available. Refresh the menu and review the order.`);
      unitPrice = previousOrder ? item.unitPrice : price(product.Price, item.name);
      if (!previousOrder && moneyCents(unitPrice) !== moneyCents(item.unitPrice))
        throw orderError(`${item.name}'s price has changed. Refresh the menu and review the order.`);
    }
    return { ...item, unitPrice, lineTotal: (moneyCents(unitPrice) * item.quantity) / 100 };
  });
  const total = items.reduce((sum, item) => sum + moneyCents(item.lineTotal), 0) / 100;
  if (total > 1000000) throw orderError('Order total cannot exceed 1,000,000.');
  const cashReceived = request.cashReceived ?? total;
  if (moneyCents(cashReceived) < moneyCents(total))
    throw orderError('Cash received must cover the order total.');
  return {
    type: request.type,
    customer: request.customer,
    notes: request.notes,
    items,
    total,
    cashReceived,
    change: (moneyCents(cashReceived) - moneyCents(total)) / 100,
  };
}

const customOrderEntry = (item) => ({
  description: item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name,
  amount: item.lineTotal,
});

export function removeOrderFromLedger(row, previousOrder) {
  const sold = readAmountMap(row.Product_Sales_JSON);
  const custom = readCustomEntries(row.Custom_Sales_JSON);
  const mismatch = () =>
    orderError('Saved sales no longer match this order. Reload and review the day before changing it.');
  for (const item of previousOrder.items) {
    if (item.kind === 'menu') {
      if ((sold[item.name] || 0) < item.quantity) throw mismatch();
      sold[item.name] -= item.quantity;
      if (!sold[item.name]) delete sold[item.name];
    } else {
      const entry = customOrderEntry(item);
      const index = custom.findIndex(
        (value) =>
          value.description === entry.description && moneyCents(value.amount) === moneyCents(entry.amount),
      );
      if (index < 0) throw mismatch();
      custom.splice(index, 1);
    }
  }
  const remaining = moneyCents(row.Takoyaki_Sales) - moneyCents(previousOrder.total);
  if (remaining < 0) throw mismatch();
  return {
      ...row,
      Takoyaki_Sales: remaining / 100,
      Product_Sales_JSON: JSON.stringify(sold),
      Custom_Sales_JSON: JSON.stringify(custom),
    };
}

export function replaceOrderInLedger(row, previousOrder, nextOrder) {
  return addOrderToLedger(removeOrderFromLedger(row, previousOrder), nextOrder);
}

export function addOrderToLedger(row, order) {
  const menu = order.items.filter((item) => item.kind === 'menu');
  return appendSale(
    row,
    menu.map((item) => ({ Name: item.name, Price: item.unitPrice })),
    Object.fromEntries(menu.map((item) => [item.name, item.quantity])),
    order.items.filter((item) => item.kind === 'custom').map(customOrderEntry),
  );
}
