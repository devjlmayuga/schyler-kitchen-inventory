export default function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="md-card border-red-200 bg-red-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold text-red-800">{message}</div>
        {onRetry ? (
          <button type="button" className="md-btn md-btn-outline h-9 px-3" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
