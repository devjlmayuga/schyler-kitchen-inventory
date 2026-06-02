import AuthedShell from '../../components/AuthedShell.jsx';

export default function AppLayout({ children }) {
  return <AuthedShell>{children}</AuthedShell>;
}

