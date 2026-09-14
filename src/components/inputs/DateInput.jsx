export default function DateInput({ label, value, onChange, min, max }) {
  function handleChange(event) {
    let next = event.target.value;
    if (next && min && next < min) next = min;
    if (next && max && next > max) next = max;
    onChange(next);
  }

  return (
    <label className="md-field">
      {label ? <span className="md-label">{label}</span> : null}
      <input className="md-input" type="date" value={value} min={min} max={max} onChange={handleChange} />
    </label>
  );
}
