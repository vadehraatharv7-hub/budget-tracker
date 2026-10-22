interface Props {
  value: number; // 0..1+ (can exceed 1 when over budget)
  marker?: number; // 0..1 position of a reference mark (even-pace point)
  label: string;
  style?: React.CSSProperties;
}

export const toneFor = (ratio: number) => (ratio >= 1 ? 'neg' : ratio >= 0.75 ? 'warn' : 'ok');

export function Progress({ value, marker, label, style }: Props) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} style={style}>
      <div className="progress__bar" data-tone={toneFor(value)} style={{ width: `${clamped * 100}%` }} />
      {marker !== undefined && <i className="progress__marker" style={{ left: `${Math.min(1, Math.max(0, marker)) * 100}%` }} />}
    </div>
  );
}
