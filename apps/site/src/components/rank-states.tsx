import { Reveal } from './reveal';

const STATES = [
  { cell: '#7', cellClass: 'text-ink', label: 'Ranked', body: 'The position at the last check, with the page that ranks and the change since the previous check.' },
  { cell: '>20', cellClass: 'text-ink-3', label: 'Beyond the depth checked', body: 'Not in the top 20 that day. We say so instead of inventing a number.' },
  { cell: 'Pending', cellClass: 'text-ink-3', label: 'Not checked yet', body: 'A new keyword waiting for its first check, shown as waiting, not as zero.' },
  { cell: 'n/a', cellClass: 'text-ink-3', label: 'Check failed', body: 'The last check did not complete. The row says so and keeps the last good result.' },
  { cell: 'Stale', cellClass: 'text-cobalt-deep', label: 'Out of date', body: 'No successful check for longer than the schedule allows, flagged on the row.' },
] as const;

/** The honest states of a rank cell, shown as the cell itself. The product detail that most trackers hide. */
export function RankStates() {
  return (
    <section className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
      <Reveal>
        <h2 className="max-w-[20ch] text-[clamp(2.1rem,3.8vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">A rank is only useful if you can tell what it means.</h2>
        <p className="mt-5 max-w-[56ch] text-lg leading-relaxed text-ink-2">Every cell in idraft is one of five honest states. Nothing is rounded up, filled in or hidden.</p>
      </Reveal>
      <ul className="mt-14 flex flex-col">
        {STATES.map((state, index) => (
          <li key={state.label}>
            <Reveal delay={index * 0.04}>
              <div className="grid items-center gap-4 border-t border-line py-7 sm:grid-cols-12 sm:gap-8">
                <span className={`font-mono text-3xl font-medium tracking-[-0.04em] sm:col-span-3 sm:text-4xl ${state.cellClass}`}>{state.cell}</span>
                <h3 className="text-xl font-semibold tracking-[-0.03em] sm:col-span-3">{state.label}</h3>
                <p className="leading-relaxed text-ink-2 sm:col-span-6">{state.body}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
