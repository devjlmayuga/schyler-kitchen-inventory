'use client';

import { useEffect, useRef } from 'react';
import { MoreHorizontal, Search, X } from 'lucide-react';

export function ActionMenu({ children, disabled = false, label = 'More actions' }) {
  const ref = useRef(null);
  useEffect(() => {
    function close(event) {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && ref.current?.contains(event.target)) return;
      if (ref.current?.open) {
        ref.current.open = false;
        if (event.type === 'keydown') ref.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details
      ref={ref}
      className="relative"
      onClick={(event) => {
        if (event.target.closest('button')) ref.current.open = false;
      }}
    >
      <summary
        aria-label={label}
        aria-disabled={disabled}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        className={`action-menu-trigger md-btn md-btn-outline h-[42px] w-[42px] cursor-pointer list-none px-0 ${disabled ? 'opacity-50' : ''}`}
      >
        <MoreHorizontal size={20} />
      </summary>
      <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
        {children}
      </div>
    </details>
  );
}

export function SearchField({ value, onChange, placeholder, label }) {
  return (
    <div className="relative min-w-0">
      <Search
        size={17}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      />
      <input
        type="search"
        aria-label={label || placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="md-input search-field pl-10 pr-10"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-0 top-0 grid h-[42px] w-10 place-items-center rounded-xl text-slate-500 focus-visible:ring-2 focus-visible:ring-[var(--p-2)]"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center px-5 py-14 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-slate-50 text-slate-400">
        <Icon size={25} strokeWidth={1.5} />
      </span>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <div className="mt-1.5 max-w-xs text-sm leading-relaxed text-slate-500">{children}</div>
    </div>
  );
}
