import { KEYWORDS, PROMPTS, SOURCES } from './data';
import { Spark } from './spark';

/** The first three keyword rows, as a small table for use inside a feature card. */
export function MiniRanks() {
  return (
    <ul className="overflow-hidden rounded-xl bg-surface/95 ring-1 ring-ink/[0.07] backdrop-blur" aria-label="Example keywords">
      {KEYWORDS.slice(0, 3).map((row, index) => {
        const delta = row.previous !== null && row.rank !== null ? row.previous - row.rank : 0;
        return (
          <li key={row.keyword} className={`flex h-11 items-center gap-3 px-4 text-[13px] ${index === 0 ? '' : 'border-t border-line'}`}>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{row.keyword}</span>
            <Spark series={row.series} width={64} />
            <span className="w-6 text-right font-mono text-ink">{row.rank}</span>
            <span className={`w-7 text-right font-mono text-[12px] ${delta > 0 ? 'text-[#0F7B4F]' : delta < 0 ? 'text-[#B42318]' : 'text-ink-3'}`}>{delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '0'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** One prompt and the answer it got, with your brand and a rival picked out. */
export function AnswerCard({ index = 0, className = '' }: { index?: number; className?: string }) {
  const prompt = PROMPTS[index % PROMPTS.length] ?? PROMPTS[0];
  if (!prompt) return null;
  return (
    <div className={`rounded-xl bg-surface p-4 text-[13px] ring-1 ring-ink/[0.07] ${className}`}>
      <p className="text-[11px] text-ink-3">Prompt</p>
      <p className="mt-0.5 font-semibold tracking-[-0.01em]">{prompt.prompt}</p>
      <p className="mt-3 leading-relaxed text-ink-2">
        {prompt.answer.map((part, i) => (
          <span key={i} className={part.mention ? 'rounded bg-wash px-0.5 font-medium text-cobalt-deep' : part.rival ? 'rounded bg-ink/5 px-0.5 font-medium text-ink' : ''}>
            {part.text}
          </span>
        ))}
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Cited sources">
        {prompt.sources.map((source) => (
          <li key={source.domain} className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${source.own ? 'bg-wash text-cobalt-deep' : 'bg-ink/5 text-ink-2'}`}>
            {source.domain}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The three most cited domains, as bars. */
export function MiniSources() {
  const top = SOURCES.slice(0, 4);
  const max = Math.max(...top.map((source) => source.citations));
  return (
    <ul className="overflow-hidden rounded-xl bg-surface ring-1 ring-ink/[0.07]" aria-label="Example cited domains">
      {top.map((source, index) => (
        <li key={source.domain} className={`flex h-10 items-center gap-3 px-4 ${index === 0 ? '' : 'border-t border-line'}`}>
          <span className="w-28 shrink-0 truncate font-mono text-[12px] text-ink">{source.domain}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
            <span className={`block h-full rounded-full ${source.kind === 'You' ? 'bg-cobalt' : 'bg-ink/30'}`} style={{ width: `${(source.citations / max) * 100}%` }} />
          </span>
          <span className="w-7 text-right font-mono text-[12px] text-ink-2">{source.citations}</span>
        </li>
      ))}
    </ul>
  );
}
