'use client';

import Layout from './Layout.jsx';
import RequireAuth from './RequireAuth.jsx';

export default function AuthedShell({ children }) {
  return (
    <RequireAuth>
      <Layout>{children}</Layout>
    </RequireAuth>
  );
}

