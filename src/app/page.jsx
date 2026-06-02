'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import FullscreenLoading from '../components/FullscreenLoading.jsx';
import { isLoggedIn } from '../lib/auth.js';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(isLoggedIn() ? '/inventory' : '/login');
  }, [router]);

  return <FullscreenLoading show title="Loading…" subtitle="Preparing dashboard" />;
}

