export default function FullscreenLoading({ show, title = 'Saving…', subtitle = 'Please wait' }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-[#E03348]" />
          <div>
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            <div className="text-xs text-slate-600">{subtitle}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
