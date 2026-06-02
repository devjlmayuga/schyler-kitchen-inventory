'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import FullscreenLoading from './FullscreenLoading.jsx';
import { getUser } from '../lib/auth.js';

export default function RequireAdmin({ children }) {
  const router = useRouter();
  const user = getUser();
  const ok = !!user && user.role === 'admin';

  useEffect(() => {
    if (!ok) router.replace('/inventory');
  }, [ok, router]);

  if (!ok) return <FullscreenLoading show title="Admin only" subtitle="Redirecting…" />;
  return <>{children}</>;
}
