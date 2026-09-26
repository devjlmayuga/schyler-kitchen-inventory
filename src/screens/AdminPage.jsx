'use client';

import { useState } from 'react';
import { BarChart3, Package, Settings2, Users, UtensilsCrossed } from 'lucide-react';
import ReportsPanel from '../components/admin/ReportsPanel.jsx';
import CatalogSettings from '../components/admin/CatalogSettings.jsx';
import SalesSettings from '../components/admin/SalesSettings.jsx';
import AttendancePanel from '../components/admin/AttendancePanel.jsx';
import useUnsavedChanges from '../lib/useUnsavedChanges.js';

const sections = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'items', label: 'Inventory items', icon: Package },
  { key: 'products', label: 'Menu products', icon: UtensilsCrossed },
  { key: 'attendance', label: 'Attendance', icon: Users },
  { key: 'settings', label: 'Sales settings', icon: Settings2 },
];

export default function AdminPage() {
  const [section, setSection] = useState('overview');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useUnsavedChanges(dirty);
  function changeSection(next) {
    if (next === section || busy) return;
    if (dirty && !window.confirm('Discard your unsaved edits and switch sections?')) return;
    setDirty(false);
    setSection(next);
  }
  return (
    <div className="workspace-page">
      <header>
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">Keep your kitchen running smoothly.</p>
      </header>
      <nav aria-label="Admin sections" className="hidden sm:block">
        <div className="segmented-control">
          {sections.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className="segment"
              aria-pressed={section === key}
              disabled={busy}
              onClick={() => changeSection(key)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </nav>
      <label className="md-field sm:hidden">
        <span className="md-label">Admin section</span>
        <select
          className="md-select"
          aria-label="Admin section"
          value={section}
          disabled={busy}
          onChange={(event) => changeSection(event.target.value)}
        >
          {sections.map(({ key, label }) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {section === 'overview' && <ReportsPanel />}
      {(section === 'items' || section === 'products') && (
        <CatalogSettings key={section} kind={section} onDirtyChange={setDirty} onBusyChange={setBusy} />
      )}
      {section === 'attendance' && (
        <AttendancePanel
          onDirtyChange={setDirty}
          onBusyChange={setBusy}
          onOpenSettings={() => changeSection('settings')}
        />
      )}
      {section === 'settings' && <SalesSettings onDirtyChange={setDirty} onBusyChange={setBusy} />}
    </div>
  );
}
