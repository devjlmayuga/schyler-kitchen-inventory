export function parseMoney(value) {
  if (value === null || value === undefined) return 0;
  const s = String(value).trim();
  if (s === '') return 0;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  return n;
}

export function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
