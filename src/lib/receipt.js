import { orderNumber } from './pos.js';

export const receiptTime = (value) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

// ESC/POS text mode uses printable ASCII. Never pass user-supplied control bytes to a printer.
export const printerText = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/₱/g, 'PHP ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();

export function wrapPrinterText(value, width) {
  const words = printerText(value).split(' ');
  const lines = [];
  let line = '';
  for (let word of words) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = '';
    }
    while (word.length > width) {
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    line += `${line ? ' ' : ''}${word}`;
  }
  if (line) lines.push(line);
  return lines;
}

export function receiptLines(order, width = 32) {
  const lines = [];
  const add = (value) => lines.push(...wrapPrinterText(value, width));
  const pair = (label, amount) => {
    const right = Number(amount).toFixed(2);
    const chunks = wrapPrinterText(label, Math.max(1, width - right.length - 1));
    chunks.slice(0, -1).forEach((line) => lines.push(line));
    const left = chunks.at(-1) || '';
    lines.push(left + ' '.repeat(Math.max(1, width - left.length - right.length)) + right);
  };
  add("SCHYLER'S KITCHEN");
  add('ORDER SLIP');
  add(orderNumber(order.number));
  add(receiptTime(order.createdAt));
  if (order.revision > 1) add(`Corrected - Revision ${order.revision}`);
  add(order.type);
  if (order.customer) add(`For: ${order.customer}`);
  if (order.cashier) add(`Staff: ${order.cashier}`);
  lines.push('-'.repeat(width));
  order.items.forEach((item) => {
    add(`${item.quantity} x ${item.name}`);
    pair(`  @ ${item.unitPrice.toFixed(2)}`, item.lineTotal);
  });
  lines.push('-'.repeat(width));
  pair('TOTAL PHP', order.total);
  pair('Cash', order.cashReceived);
  pair('Change', order.change);
  if (order.notes) {
    lines.push('');
    add(`Notes: ${order.notes}`);
  }
  lines.push('');
  add('Thank you!');
  return lines;
}

export function escPosReceipt(order, { paperWidth = 58, cut = false } = {}) {
  const content = receiptLines(order, Number(paperWidth) === 80 ? 48 : 32).join('\n');
  const data = new TextEncoder().encode(content + '\n\n\n\n');
  // Initialize; left alignment; normal font/size. Optional partial cut only for printers with a cutter.
  return new Uint8Array([0x1b, 0x40, 0x1b, 0x61, 0, 0x1b, 0x21, 0, ...data, ...(cut ? [0x1d, 0x56, 1] : [])]);
}
