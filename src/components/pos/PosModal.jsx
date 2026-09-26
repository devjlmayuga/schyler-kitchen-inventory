'use client';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function PosModal({ title, onClose, children, footer, busy = false, rootId, className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const focus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (focus?.isConnected) focus.focus({ preventScroll: true });
    };
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  return createPortal(
    <div id={rootId}>
      <dialog
        ref={ref}
        className={`pos-dialog ${className}`}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = [
            ...ref.current.querySelectorAll('button,input,textarea,select,a[href],[tabindex]'),
          ].filter((el) => !el.matches(':disabled') && el.tabIndex >= 0 && el.getClientRects().length);
          if (!controls.length) return event.preventDefault();
          if (event.shiftKey && document.activeElement === controls[0]) {
            event.preventDefault();
            controls.at(-1).focus();
          }
          if (!event.shiftKey && document.activeElement === controls.at(-1)) {
            event.preventDefault();
            controls[0].focus();
          }
        }}
      >
        <header className="pos-modal-controls flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 p-5">
          <h2 id={titleId} className="section-title">
            {title}
          </h2>
          <button className="admin-icon-button" aria-label={`Close ${title}`} disabled={busy} onClick={close}>
            <X size={18} />
          </button>
        </header>
        <div className="pos-modal-body min-h-0 overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <footer className="pos-modal-controls shrink-0 border-t border-slate-100 bg-slate-50 p-4">
            {footer}
          </footer>
        )}
      </dialog>
    </div>,
    document.body,
  );
}
