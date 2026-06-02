import NeedsPage from '../../../screens/NeedsPage.jsx';

export default async function Page({ searchParams }) {
  const sp = await Promise.resolve(searchParams);
  const q = sp?.q;
  return <NeedsPage q={q} />;
}
