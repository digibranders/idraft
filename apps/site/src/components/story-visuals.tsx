import Image from 'next/image';

/** Rank by day, 1 is best. Illustrative: the shape of a climb, not customer data. */
const CLIMB = [14, 13, 13, 12, 11, 11, 10, 9, 9, 8, 9, 7, 7, 6, 6, 5, 6, 5, 4, 4, 3];

const W = 640;
const H = 420;
const PAD = { left: 56, right: 28, top: 36, bottom: 40 };
const xAt = (index: number) => PAD.left + (index / (CLIMB.length - 1)) * (W - PAD.left - PAD.right);
const yAt = (rank: number) => PAD.top + ((rank - 1) / 19) * (H - PAD.top - PAD.bottom);

const LINE = CLIMB.map((rank, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)} ${yAt(rank).toFixed(1)}`).join(' ');

/** Step 1: a rank line that draws itself. Ranks are plotted inverted, so up is better. */
export function RankChart() {
  const last = CLIMB.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustrative line chart: a keyword climbing from position 14 to position 3 over three weeks." className="h-full w-full">
      {[3, 10, 20].map((rank) => (
        <g key={rank}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yAt(rank)} y2={yAt(rank)} stroke="#E1E5EB" strokeDasharray="3 5" />
          <text x={PAD.left - 10} y={yAt(rank) + 4} textAnchor="end" className="fill-ink-3 font-mono text-[11px]">
            {rank}
          </text>
        </g>
      ))}
      <path d={LINE} data-line pathLength={1} strokeDasharray="1" fill="none" stroke="#1E65E3" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <g data-end>
        <circle cx={xAt(last)} cy={yAt(CLIMB[last] ?? 3)} r="11" fill="#1E65E3" opacity=".15" />
        <circle cx={xAt(last)} cy={yAt(CLIMB[last] ?? 3)} r="5.5" fill="#1E65E3" />
        <text x={xAt(last) - 14} y={yAt(CLIMB[last] ?? 3) - 18} textAnchor="end" className="fill-ink font-mono text-[13px] font-medium">
          #3
        </text>
      </g>
      <text x={PAD.left} y={H - 12} className="fill-ink-3 font-mono text-[11px]">
        Illustrative example
      </text>
    </svg>
  );
}

/** Step 2: the answer, read through a lens. */
export function LensVisual() {
  return (
    <Image
      src="/images/lens.png"
      alt="A glass lens bending a blue grid into curved lines."
      fill
      sizes="(min-width: 1024px) 58vw, 100vw"
      className="object-cover"
    />
  );
}

const MATRIX = [
  { keyword: 'rank tracker', rank: 3, named: false },
  { keyword: 'ai visibility tool', rank: 11, named: true },
  { keyword: 'seo reporting', rank: 2, named: true },
  { keyword: 'keyword research', rank: 8, named: false },
] as const;

/** Step 3: keywords and prompts on one row. The highlighted row ranks well and is still not named. */
export function GapMatrix() {
  return (
    <div className="flex h-full flex-col justify-center gap-5 p-6 sm:p-10">
      <div className="grid grid-cols-[1fr_5rem_6rem] items-center gap-4 text-xs text-ink-3">
        <span>Topic</span>
        <span className="text-right">Google</span>
        <span className="text-right">Named by AI</span>
      </div>
      <ul className="flex flex-col gap-2">
        {MATRIX.map((row) => {
          const gap = row.rank <= 3 && !row.named;
          return (
            <li
              key={row.keyword}
              className={`grid grid-cols-[1fr_5rem_6rem] items-center gap-4 rounded-2xl px-4 py-3.5 ${gap ? 'bg-wash ring-1 ring-cobalt/30' : 'bg-surface ring-1 ring-ink/[0.06]'}`}
            >
              <span className="text-[15px] font-medium text-ink">{row.keyword}</span>
              <span className="text-right font-mono text-sm text-ink">#{row.rank}</span>
              <span className={`text-right text-sm ${row.named ? 'text-ink' : 'text-cobalt-deep'}`}>{row.named ? 'Named' : 'Not named'}</span>
            </li>
          );
        })}
      </ul>
      <p className="font-mono text-[11px] text-ink-3">Illustrative example</p>
    </div>
  );
}
