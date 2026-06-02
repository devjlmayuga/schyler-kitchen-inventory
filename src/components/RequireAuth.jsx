'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import FullscreenLoading from './FullscreenLoading.jsx';
import { isLoggedIn } from '../lib/auth.js';

export default function RequireAuth({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const loggedIn = isLoggedIn();

  useEffect(() => {
    if (!loggedIn) {
      router.replace(`/login?from=${encodeURIComponent(pathname || '/')}`);
    }
  }, [loggedIn, pathname, router]);

  if (!loggedIn) {
    return <FullscreenLoading show title="Please sign in" subtitle="Redirecting to login…" />;
  }

  return <>{children}</>;
}
