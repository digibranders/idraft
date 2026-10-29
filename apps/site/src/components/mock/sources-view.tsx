import { SOURCES } from './data';

/** Sources: the domains AI answers cite for your topics, with the kind of site and how often. */
export function SourcesView() {
  const max = Math.max(...SOURCES.map((source) => source.citations));
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      <ul className="overflow-hidden rounded-lg bg-surface ring-1 ring-ink/[0.06]" aria-label="Most cited domains">
        {SOURCES.map((source, index) => (
          <li key={source.domain} className={`flex h-11 items-center gap-3 px-3 ${index === 0 ? '' : 'border-t border-line'}`}>
            <span className="w-32 shrink-0 truncate font-mono text-[12px] font-medium text-ink">{source.domain}</span>
            <span className={`hidden w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] sm:inline-block ${source.kind === 'You' ? 'bg-wash text-cobalt-deep' : 'bg-ink/5 text-ink-2'}`}>{source.kind}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
              <span className={`block h-full rounded-full ${source.kind === 'You' ? 'bg-cobalt' : 'bg-ink/30'}`} style={{ width: `${(source.citations / max) * 100}%` }} />
            </span>
            <span className="w-8 shrink-0 text-right font-mono text-[12px] text-ink-2">{source.citations}</span>
          </li>
        ))}
      </ul>
      <p className="font-mono text-[10px] text-ink-3">Citations in the last 28 days · Illustrative data</p>
    </div>
  );
}
