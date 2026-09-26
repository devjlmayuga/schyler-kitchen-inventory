import { parseQty } from './numbers.js';

export function closingQuantity(item) {
  return (
    Math.round((parseQty(item.Current_Qty) + parseQty(item.In_Stock) - parseQty(item.Out_Stock)) * 1e6) / 1e6
  );
}

export function isLowStock(item) {
  return closingQuantity(item) <= parseQty(item.Threshold_Limit);
}

export function prepareInventory(items) {
  return items.map((item) => {
    for (const key of ['Current_Qty', 'In_Stock', 'Out_Stock']) {
      const value = Number(item[key] || 0);
      if (!Number.isFinite(value) || value < 0)
        throw new Error(`${item.Product}: enter a valid quantity of 0 or more.`);
    }
    const closing = closingQuantity(item);
    if (closing < 0)
      throw new Error(`${item.Product}: used stock cannot exceed opening stock plus stock added.`);
    return {
      ...item,
      Current_Qty: parseQty(item.Current_Qty),
      In_Stock: parseQty(item.In_Stock),
      Out_Stock: parseQty(item.Out_Stock),
      Closing_Qty: closing,
    };
  });
}
