'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import FullscreenLoading from './FullscreenLoading.jsx';
import { isLoggedIn } from '../lib/auth.js';

export default function RequireAuth({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  // Start with the same shell on the server and browser, then read the local session.
  const [loggedIn, setLoggedIn] = useState(null);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, [pathname]);

  useEffect(() => {
    if (loggedIn === false) {
      router.replace(`/login?from=${encodeURIComponent(pathname || '/')}`);
    }
  }, [loggedIn, pathname, router]);

  if (!loggedIn) {
    return (
      <FullscreenLoading
        show
        title={loggedIn === null ? 'Loading your workspace…' : 'Please sign in'}
        subtitle={loggedIn === null ? '' : 'Redirecting to login…'}
      />
    );
  }

  return <>{children}</>;
}
