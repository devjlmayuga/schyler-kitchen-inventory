import LoginPage from '../../screens/LoginPage.jsx';

export default async function Page({ searchParams }) {
  const sp = await Promise.resolve(searchParams);
  const from = sp?.from;
  return <LoginPage from={from} />;
}
