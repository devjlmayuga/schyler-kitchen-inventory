export default function DateInput({ label, value, onChange }) {
  return (
    <label className="md-field">
      {label ? <span className="md-label">{label}</span> : null}
      <input className="md-input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
