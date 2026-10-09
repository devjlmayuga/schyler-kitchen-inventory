import { parseMoney } from './money.js';

export const peso = (value) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(parseMoney(value));

export function readAmountMap(raw) {
  if (!raw) return {};
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Saved sales details could not be read. Reload before making changes.');
  return Object.fromEntries(
    Object.entries(value).map(([name, amount]) => {
      const number = Number(String(amount ?? '').replace(/,/g, ''));
      if (!Number.isFinite(number))
        throw new Error(`Invalid saved amount for ${name}. Correct the amount before saving.`);
      return [name, number];
    }),
  );
}

export function groupProductSalesByCategory(sold, products) {
  const catalog = new Map(
    (Array.isArray(products) ? products : []).map((product) => [
      String(product?.Name || '').trim().toLocaleLowerCase(),
      {
        category: String(product?.Category || '').trim() || 'Uncategorized',
        price: parseMoney(product?.Price),
      },
    ]),
  );
  const groups = new Map();
  Object.entries(sold || {}).forEach(([name, rawQuantity]) => {
    const qty = Number(rawQuantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const product = catalog.get(String(name).trim().toLocaleLowerCase());
    const category = product?.category || 'Uncategorized';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ name, qty, amount: qty * (product?.price || 0) });
  });
  return [...groups].map(([category, items]) => ({
    category,
    items,
    quantity: items.reduce((sum, item) => sum + item.qty, 0),
    amount: items.reduce((sum, item) => sum + item.amount, 0),
  }));
}

export function orderLines(products, quantities) {
  return products
    .filter((product) => Object.hasOwn(quantities, product.Name))
    .map((product) => {
      const qty = Number(quantities[product.Name]);
      const price = Number(product.Price);
      if (!Number.isSafeInteger(qty) || qty < 1)
        throw new Error(`${product.Name}: quantity must be a whole number of at least 1.`);
      if (!Number.isFinite(price) || price < 0) throw new Error(`${product.Name}: price is invalid.`);
      return { ...product, qty, lineTotal: (Math.round(price * 100) * qty) / 100 };
    });
}

export function readCustomEntries(raw) {
  if (!raw) return [];
  let entries;
  try {
    entries = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('Custom entries could not be read. Reload before saving.');
  }
  if (!Array.isArray(entries)) throw new Error('Custom entries must be a list.');
  return entries.map((entry) => {
    const description = String(entry?.description || '').trim();
    const amount = Number(entry?.amount);
    if (!description || description.length > 200)
      throw new Error('Add a description of up to 200 characters.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000)
      throw new Error('Enter an amount greater than 0 and no more than 10,000,000.');
    const rounded = Math.round(amount * 100) / 100;
    if (!rounded) throw new Error('Enter an amount of at least ₱0.01.');
    return { description, amount: rounded };
  });
}

export function appendSale(row, products, quantities, customEntries = []) {
  const lines = orderLines(products, quantities);
  const custom = readCustomEntries(customEntries);
  if (!lines.length && !custom.length)
    throw new Error('Add at least one product or custom sale to this order.');
  if (lines.length !== Object.keys(quantities).length)
    throw new Error('An order product is no longer available. Remove it and try again.');
  const sold = readAmountMap(row.Product_Sales_JSON);
  lines.forEach((line) => {
    sold[line.Name] = (sold[line.Name] || 0) + line.qty;
  });
  const cents = lines.reduce(
    (sum, line) => sum + Math.round(line.lineTotal * 100),
    Math.round(parseMoney(row.Takoyaki_Sales) * 100) +
      custom.reduce((sum, entry) => sum + Math.round(entry.amount * 100), 0),
  );
  // Add new sales to the recorded amount; never reprice historical quantities from the current catalog.
  return {
    ...row,
    Takoyaki_Sales: cents / 100,
    Product_Sales_JSON: JSON.stringify(sold),
    Custom_Sales_JSON: JSON.stringify([...readCustomEntries(row.Custom_Sales_JSON), ...custom]),
  };
}

export function ledgerTotals(row, fields) {
  const expenses =
    fields.reduce((sum, field) => sum + parseMoney(row[field.key]), 0) +
    readCustomEntries(row.Custom_Expenses_JSON).reduce((sum, entry) => sum + entry.amount, 0) +
    Object.values(readAmountMap(row.Staff_Expenses_JSON)).reduce((sum, value) => sum + value, 0);
  const sales = parseMoney(row.Takoyaki_Sales);
  const addedCash = parseMoney(row.Previous_Cash_Added);
  const payouts = parseMoney(row.Payout_Mykah) + parseMoney(row.Payout_Natalie);
  return { sales, expenses, addedCash, payouts, cash: sales - expenses + addedCash - payouts };
}
