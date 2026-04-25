/**
 * Tiny inline SVG sparkline. Server-renderable, no client JS.
 * Pass an array of numbers — we normalize and draw a polyline.
 */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  className = '',
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}): React.ReactElement {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} className={className}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeWidth={1}
        />
      </svg>
    );
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
