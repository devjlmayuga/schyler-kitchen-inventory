'use client';

import { Plus, Trash2 } from 'lucide-react';
import { peso, readCustomEntries } from '../lib/sales.js';

export default function CustomAmountEntries({
  title,
  entries,
  onChange,
  draft,
  onDraftChange,
  onError,
  disabled,
  example,
  maxLength = 200,
}) {
  function add() {
    try {
      const [entry] = readCustomEntries([draft]);
      onChange([...entries, entry]);
      onDraftChange({ description: '', amount: '' });
      onError('');
    } catch (error) {
      onError(error.message);
    }
  }
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <legend className="mb-3 text-sm font-semibold text-slate-800">{title}</legend>
      {!!entries.length && (
        <ul className="divide-y divide-slate-100">
          {entries.map((entry, index) => (
            <li key={index} className="flex items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 break-words">{entry.description}</span>
              <span className="shrink-0 font-medium tabular-nums">{peso(entry.amount)}</span>
              <button
                type="button"
                className="admin-icon-button shrink-0"
                aria-label={`Remove ${title.toLowerCase()} ${entry.description}`}
                onClick={() => onChange(entries.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label className="md-field">
          <span className="md-label">Description</span>
          <input
            className="md-input"
            aria-label={`${title} description`}
            maxLength={maxLength}
            placeholder={example}
            value={draft.description}
            onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
          />
        </label>
        <label className="md-field">
          <span className="md-label">Amount (₱)</span>
          <input
            className="md-input"
            aria-label={`${title} amount`}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={draft.amount}
            onChange={(event) => onDraftChange({ ...draft, amount: event.target.value })}
          />
        </label>
      </div>
      <button
        type="button"
        className="md-btn md-btn-outline min-h-11"
        disabled={!draft.description.trim() || !draft.amount}
        onClick={add}
      >
        <Plus size={16} />
        Add {title.toLowerCase()}
      </button>
    </fieldset>
  );
}
