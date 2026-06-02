export default function TextInput({ label, value, onChange, placeholder, inputMode, rightAddon, disabled }) {
  return (
    <label className="md-field">
      {label ? <span className="md-label">{label}</span> : null}
      {rightAddon ? (
        <div className="flex">
          <input
            className="md-input rounded-r-none"
            inputMode={inputMode}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
          />
          <span className="grid h-[42px] place-items-center rounded-r-xl border border-l-0 border-slate-300 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            {rightAddon}
          </span>
        </div>
      ) : (
        <input
          className="md-input"
          inputMode={inputMode}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </label>
  );
}
