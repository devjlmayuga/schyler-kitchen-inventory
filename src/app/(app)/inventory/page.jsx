import InventoryPage from '../../../screens/InventoryPage.jsx';

export default async function Page({ searchParams }) {
  const sp = await Promise.resolve(searchParams);
  const q = sp?.q;
  const date = sp?.date;
  const timestamp = typeof date === 'string' ? Date.parse(`${date}T00:00:00Z`) : NaN;
  const initialDate =
    /^\d{4}-\d{2}-\d{2}$/.test(date || '') &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === date
      ? date
      : undefined;
  return <InventoryPage q={q} initialDate={initialDate} />;
}
