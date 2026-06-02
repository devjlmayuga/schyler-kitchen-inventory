'use client';

import { CookingPot, Lock, User } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FullscreenLoading from '../components/FullscreenLoading.jsx';
import { apiPost } from '../lib/googleSheetsApi.js';
import { isLoggedIn, setLocked, setSession } from '../lib/auth.js';

export default function LoginPage({ from: fromProp } = {}) {
  const router = useRouter();
  const from = useMemo(() => {
    const v = String(fromProp || '').trim();
    return v && v.startsWith('/') ? v : '/inventory';
  }, [fromProp]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoggedIn()) router.replace('/inventory');
  }, [router]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiPost('auth.login', { username, password });
      setLocked(false);
      setSession({ sessionToken: data.sessionToken, user: data.user });
      router.replace(from);
    } catch (err) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="md-shell flex min-h-dvh items-center justify-center p-4">
      <FullscreenLoading show={loading} title="Signing in…" subtitle="Please wait" />

      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-3xl bg-[linear-gradient(135deg,#E55466,#E03348,#C50018)] text-white shadow-[0_18px_44px_rgba(197,0,24,0.22)]">
            <CookingPot size={20} />
          </div>
          <div className="text-center">
            <div className="text-lg font-extrabold tracking-tight text-slate-900">Takoyaki Inventory</div>
            <div className="text-sm text-slate-600">Sign in to continue</div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="md-card-elevated p-5">
          <ErrorBanner message={error} />

          <div className="mt-4 space-y-3">
            <label className="md-field">
              <div className="md-label">Username</div>
              <div className="relative">
                <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  className="md-input pl-9"
                  placeholder="e.g., admin"
                />
              </div>
            </label>

            <label className="md-field">
              <div className="md-label">Password</div>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="md-input pl-9"
                  placeholder="••••••••"
                />
              </div>
            </label>
          </div>

          <button type="submit" className="md-btn md-btn-primary mt-5 h-[46px] w-full">
            Sign in
          </button>

          
        </form>
      </div>
    </div>
  );
}
