import AdminPage from '../../../screens/AdminPage.jsx';
import RequireAdmin from '../../../components/RequireAdmin.jsx';

export default function Page() {
  return (
    <RequireAdmin>
      <AdminPage />
    </RequireAdmin>
  );
}
