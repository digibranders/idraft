type SparkProps = { series: readonly number[]; width?: number; height?: number; className?: string };

/** A rank sparkline. Ranks are plotted inverted so a climb draws upward. Color says nothing; direction does. */
export function Spark({ series, width = 72, height = 22, className = '' }: SparkProps) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(1, max - min);
  const x = (i: number) => (i / (series.length - 1)) * (width - 4) + 2;
  const y = (rank: number) => ((rank - min) / span) * (height - 6) + 3;
  const d = series.map((rank, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(rank).toFixed(1)}`).join(' ');
  const last = series[series.length - 1] ?? min;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className={className}>
      <path d={d} fill="none" stroke="#1E65E3" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(series.length - 1)} cy={y(last)} r="2.2" fill="#1E65E3" />
    </svg>
  );
}
