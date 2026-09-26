import { parseMoney } from './money.js';

export function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function weekStart(date) {
  return addDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
}

export function buildReport(rows, from, to) {
  const days = new Map();
  const quantities = new Map();
  for (const row of rows) {
    const date = String(row.Date || '').slice(0, 10);
    if (!date || date < from || date > to) continue;
    const day = days.get(date) || { date, sales: 0, expenses: 0, net: 0 };
    day.sales += parseMoney(row.Takoyaki_Sales);
    day.expenses += parseMoney(row.Expenses_Total);
    day.net = day.sales - day.expenses;
    days.set(date, day);
    try {
      const items =
        typeof row.Product_Sales_JSON === 'string'
          ? JSON.parse(row.Product_Sales_JSON)
          : row.Product_Sales_JSON;
      if (items && typeof items === 'object' && !Array.isArray(items)) {
        Object.entries(items).forEach(([name, value]) =>
          quantities.set(name, (quantities.get(name) || 0) + parseMoney(value)),
        );
      }
    } catch {
      /* Older entries may contain totals without readable product details. */
    }
  }
  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totals = daily.reduce(
    (sum, day) => ({
      sales: sum.sales + day.sales,
      expenses: sum.expenses + day.expenses,
      net: sum.net + day.net,
    }),
    { sales: 0, expenses: 0, net: 0 },
  );
  const products = [...quantities]
    .map(([name, qty]) => ({ name, qty }))
    .filter((item) => item.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  const span = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  const monthly = span > 31;
  let chart;
  if (monthly) {
    const months = new Map();
    for (const day of daily) {
      const key = day.date.slice(0, 7);
      const month = months.get(key) || { date: key, sales: 0, expenses: 0 };
      month.sales += day.sales;
      month.expenses += day.expenses;
      months.set(key, month);
    }
    chart = [...months.values()];
  } else {
    chart = Array.from({ length: Math.max(0, span) }, (_, index) => {
      const date = addDays(from, index);
      return days.get(date) || { date, sales: 0, expenses: 0 };
    });
  }
  return { daily, totals, products, chart, monthly };
}

export function normalizeCatalog(rows, kind) {
  const menu = kind === 'products';
  const nameKey = menu ? 'Name' : 'Product';
  const amountKey = menu ? 'Price' : 'Threshold_Limit';
  const seen = new Set();
  return rows.map((row) => {
    const name = String(row[nameKey] || '').trim();
    if (!name) throw new Error('Every item needs a name.');
    if (seen.has(name.toLowerCase())) throw new Error(`${name} is already in the list.`);
    seen.add(name.toLowerCase());
    const amount = Number(row[amountKey] || 0);
    if (!Number.isFinite(amount) || amount < 0)
      throw new Error(`${name}: enter a ${menu ? 'price' : 'low-stock alert'} of 0 or more.`);
    const identity = row.Original_Name ? { Original_Name: String(row.Original_Name) } : {};
    return menu
      ? {
          ...identity,
          Name: name,
          Category: String(row.Category || '').trim(),
          Price: amount,
          Active: String(row.Active || 'Y').toUpperCase() === 'N' ? 'N' : 'Y',
        }
      : { ...identity, Product: name, Unit: String(row.Unit || '').trim(), Threshold_Limit: amount };
  });
}

export function nextExpenseKey(label, fields) {
  const slug =
    label
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'Expense';
  let key = `Breakdown_${slug}`;
  let suffix = 2;
  while (fields.some((field) => field.key.toLowerCase() === key.toLowerCase()))
    key = `Breakdown_${slug}_${suffix++}`;
  return key;
}
