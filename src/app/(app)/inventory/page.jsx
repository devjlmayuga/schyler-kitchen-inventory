import InventoryPage from '../../../screens/InventoryPage.jsx';

export default async function Page({ searchParams }) {
  const sp = await Promise.resolve(searchParams);
  const q = sp?.q;
  return <InventoryPage q={q} />;
}
