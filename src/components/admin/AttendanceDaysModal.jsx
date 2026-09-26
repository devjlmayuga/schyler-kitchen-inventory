'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ErrorBanner from '../ErrorBanner.jsx';

export default function AttendanceDaysModal({
  staff,
  week,
  weekEnd,
  saving,
  canSave,
  dirty,
  error,
  onClose,
  onSave,
  children,
}) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const target = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    target.showModal();
    return () => {
      target.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  function close() {
    if (!saving) onClose();
  }

  return createPortal(
    <dialog
      ref={dialog}
      className="attendance-dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'),
        ].filter(
          (element) =>
            !element.matches(':disabled') && element.tabIndex >= 0 && element.getClientRects().length,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) {
          event.preventDefault();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          close();
      }}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-5">
        <div className="min-w-0">
          <h2 id={titleId} className="section-title break-words">
            {staff} · Edit days
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {week} – {weekEnd}
          </p>
        </div>
        <button
          className="admin-icon-button shrink-0"
          aria-label="Close attendance editor"
          disabled={saving}
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      <footer className="shrink-0 space-y-3 border-t border-slate-200 bg-slate-50 p-4 sm:p-5">
        <ErrorBanner message={error} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {dirty
              ? 'Unsaved edits are kept if you close this window.'
              : 'Save this week’s attendance before printing payslips.'}
          </p>
          <div className="flex shrink-0 justify-end gap-2">
            <button className="md-btn md-btn-outline min-h-11" disabled={saving} onClick={close}>
              Close
            </button>
            <button className="md-btn md-btn-primary min-h-11" disabled={saving || !canSave} onClick={onSave}>
              {saving ? 'Saving…' : 'Save attendance'}
            </button>
          </div>
        </div>
      </footer>
    </dialog>,
    document.body,
  );
}
