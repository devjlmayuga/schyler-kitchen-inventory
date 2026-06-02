'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  X,
} from 'lucide-react';
import { clearSession, getSessionToken, getUser, isLoggedIn, setLocked } from '../lib/auth.js';
import { apiGet } from '../lib/googleSheetsApi.js';
import { isoDateToday } from '../lib/dates.js';
import { parseQty } from '../lib/numbers.js';

const routes = [
  { path: '/inventory', label: 'Inventory' },
  { path: '/sales', label: 'Sales' },
  { path: '/needs', label: 'Needs!' },
  { path: '/admin', label: 'Admin' },
];

const iconByPath = {
  '/inventory': Package,
  '/sales': ClipboardList,
  '/needs': LayoutDashboard,
  '/admin': Settings,
};

function Icon({ IconCmp }) {
  if (!IconCmp) return null;
  return <IconCmp className="h-5 w-5" />;
}

function AppNavItem({ to, label, onNavigate }) {
  const IconCmp = iconByPath[to];
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link
      href={to}
      onClick={onNavigate}
      className={[
        'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition',
        isActive ? 'bg-[rgba(224,51,72,0.10)] text-[var(--p-5)]' : 'text-slate-700 hover:bg-white/70 hover:text-slate-900',
      ].join(' ')}
      style={{ textDecoration: 'none' }}
    >
      <span className={['grid h-8 w-8 place-items-center rounded-lg border', 'border-slate-200 bg-white'].join(' ')}>
        <Icon IconCmp={IconCmp} />
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="mt-10 w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-bold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Dropdown({ open, anchorRef, onClose, children, width = 340 }) {
  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      const anchor = anchorRef?.current;
      if (anchor && anchor.contains(e.target)) return;
      onClose?.();
    }
    function onEsc(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;
  return (
    <div
      className="absolute right-0 top-[calc(100%+10px)] z-50 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
      style={{ width }}
    >
      {children}
    </div>
  );
}

export default function Layout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  const sessionToken = getSessionToken();
  const loggedIn = isLoggedIn();
  const today = isoDateToday();

  const visibleRoutes = useMemo(() => {
    if (user?.role === 'admin') return routes;
    return routes.filter((r) => r.path !== '/admin');
  }, [user?.role]);

  const title = useMemo(() => {
    const match = routes.find((r) => pathname.startsWith(r.path));
    return match ? match.label : 'Dashboard';
  }, [pathname]);

  // Sidebar
  const [mobileOpen, setMobileOpen] = useState(false);

  // Notifications dropdown
  const notifBtnRef = useRef(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState('');
  const [notifSummary, setNotifSummary] = useState({ lowStock: 0, manualNeeds: 0 });

  async function loadNotifications() {
    setNotifError('');
    setNotifLoading(true);
    try {
      const [inv, needs] = await Promise.all([
        apiGet('inventory.get', { date: today }),
        apiGet('needs.list', { date: today, source: 'derived' }),
      ]);
      const invItems = Array.isArray(inv.items) ? inv.items : [];
      const lowStock = invItems.filter((r) => parseQty(r.Closing_Qty) <= parseQty(r.Threshold_Limit)).length;
      const manualNeeds = Array.isArray(needs.items) ? needs.items.length : 0;
      setNotifSummary({ lowStock, manualNeeds });
    } catch (e) {
      setNotifError(e?.message || 'Failed to load notifications');
    } finally {
      setNotifLoading(false);
    }
  }

  function logout() {
    if (!sessionToken) setLocked(true);
    clearSession();
    router.replace('/login');
  }

  const showDot = notifSummary.lowStock + notifSummary.manualNeeds > 0;

  return (
    <div className="md-shell flex bg-transparent">
      {/* Mobile backdrop */}
      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        />
      ) : null}

      {/* Sidebar */}
      <aside
        className={[
          'fixed left-0 top-0 z-50 flex h-dvh w-[290px] flex-col border-r border-slate-200 bg-white shadow-sm transition-transform lg:translate-x-0 lg:shadow-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <button
            type="button"
            className="flex items-center gap-2"
            onClick={() => router.push('/inventory')}
            aria-label="Home"
          >
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(229,84,102,0.18),rgba(224,51,72,0.10))]">
              <img src="/favicon.svg" alt="Takoyaki Ops" className="h-7 w-7" />
            </span>
            <span className="text-sm font-extrabold tracking-tight text-slate-900">Takoyaki Ops</span>
          </button>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleRoutes.map((r) => (
            <AppNavItem key={r.path} to={r.path} label={r.label} onNavigate={() => setMobileOpen(false)} />
          ))}
        </nav>

        {loggedIn ? (
          <div className="border-t border-slate-200 p-3">
            <button
              type="button"
              onClick={logout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        ) : null}
      </aside>

      {/* Main */}
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col lg:ml-[290px]">
        <header className="md-topbar">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              type="button"
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold text-slate-900">{title}</div>
              <div className="truncate text-xs text-slate-600">Takoyaki Daily Ops</div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <button
                  ref={notifBtnRef}
                  type="button"
                  className="relative grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  onClick={async () => {
                    const next = !notifOpen;
                    setNotifOpen(next);
                    if (next) await loadNotifications();
                  }}
                  aria-label="Notifications"
                >
                  <Bell className="h-5 w-5" />
                  {showDot ? (
                    <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-[var(--p-3)]" />
                  ) : null}
                </button>
                <Dropdown open={notifOpen} anchorRef={notifBtnRef} onClose={() => setNotifOpen(false)}>
                  <div className="border-b border-slate-200 px-4 py-3">
                    <div className="text-sm font-extrabold text-slate-900">Notifications</div>
                    <div className="text-xs text-slate-600">Today: {today}</div>
                  </div>
                  <div className="space-y-3 px-4 py-3">
                    {notifLoading ? (
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-[var(--p-3)]" />
                        Loading…
                      </div>
                    ) : notifError ? (
                      <div className="text-sm text-red-700">{notifError}</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-800">Low stock items</span>
                          <span className="md-badge-danger">{notifSummary.lowStock}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-800">Other needs</span>
                          <span className="md-chip">{notifSummary.manualNeeds}</span>
                        </div>
                        <button
                          type="button"
                          className="md-btn md-btn-primary w-full"
                          onClick={() => {
                            setNotifOpen(false);
                            router.push('/needs');
                          }}
                        >
                          Open Needs
                        </button>
                      </div>
                    )}
                  </div>
                </Dropdown>
              </div>

              <div className="hidden items-center gap-2 md:flex">
                <div className="text-right">
                  <div className="text-xs font-extrabold text-slate-900">{user?.username || 'User'}</div>
                  <div className="text-xs text-slate-600">{user?.role || 'staff'}</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-x-hidden px-4 pb-8 pt-4">{children}</main>
      </div>
    </div>
  );
}
