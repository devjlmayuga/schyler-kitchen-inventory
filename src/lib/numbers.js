export function parseQty(value) {
  if (value === null || value === undefined) return 0;
  const s = String(value).trim();
  if (s === '') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n;
}

export function clampMin(value, min = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n;
}
