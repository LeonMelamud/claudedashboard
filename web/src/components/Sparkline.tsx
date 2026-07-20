import { useId } from 'react';

export function Sparkline({
  data,
  width = 96,
  height = 28,
  stroke = 'var(--accent)',
  fill = true,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
  className?: string;
}) {
  const gradId = useId();
  if (data.length === 0) return <div style={{ width, height }} className={className} />;
  const max = Math.max(...data, 1);
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const step = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((v, i) => {
    const x = pad + i * step;
    const y = pad + h - (v / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M${points.join(' L')}`;
  const areaPath = `${linePath} L${(pad + (data.length - 1) * step).toFixed(1)},${height - pad} L${pad},${height - pad} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={areaPath} fill={`url(#${gradId})`} />}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
