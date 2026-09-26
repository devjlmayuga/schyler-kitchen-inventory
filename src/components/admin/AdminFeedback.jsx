import { Check } from 'lucide-react';
import ErrorBanner from '../ErrorBanner.jsx';

export function AdminFeedback({ error, success, onRetry }) {
  return (
    <>
      <ErrorBanner message={error} onRetry={onRetry} />
      {success && (
        <div role="status" className="notice-success">
          <Check size={16} className="shrink-0" />
          {success}
        </div>
      )}
    </>
  );
}

export function AdminSaveBar({
  dirty,
  saving,
  pendingDraft = false,
  onSave,
  onDiscard,
  label = 'Save changes',
}) {
  return (
    <div className="save-bar">
      <span className="flex min-w-0 items-center gap-2 text-sm text-slate-500">
        {pendingDraft ? (
          'Add or clear the new entry above'
        ) : dirty ? (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--p-3)]" />
            Unsaved changes
          </>
        ) : (
          <>
            <Check size={16} />
            All changes saved
          </>
        )}
      </span>
      <div className="flex shrink-0 gap-2">
        {dirty && (
          <button className="md-btn md-btn-ghost hidden sm:inline-flex" onClick={onDiscard} disabled={saving}>
            Discard
          </button>
        )}
        <button
          className="md-btn md-btn-primary min-h-11"
          disabled={saving || !dirty || pendingDraft}
          onClick={onSave}
        >
          {saving ? 'Saving…' : label}
        </button>
      </div>
    </div>
  );
}
