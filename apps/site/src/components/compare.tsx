import { Check, Minus } from '@phosphor-icons/react/dist/ssr';

import { Reveal } from './reveal';

const ALONE = [
  'Positions for the ten blue links',
  'AI answers checked by hand, if at all',
  'One visibility score with hidden weights',
  'Gaps filled in or smoothed over',
  'Rankings and AI answers in separate tools',
];

const WITH = [
  'Positions with the page that ranks and SERP features',
  'AI answers collected on a schedule across four engines',
  'Separate rates, each with the number of checks behind it',
  'Missing checks shown as missing, estimates labeled',
  'Both on one record per topic, side by side',
];

/** The same five questions, answered two ways. Two unequal panels: the plain one recedes, the cobalt one leads. */
export function Compare() {
  return (
    <section className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 lg:py-20">
      <Reveal>
        <h2 className="max-w-[20ch] text-[clamp(2.1rem,3.8vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">A rank tracker shows half the picture.</h2>
      </Reveal>
      <div className="mt-14 grid gap-4 lg:grid-cols-12">
        <Reveal className="lg:col-span-5">
          <div className="h-full rounded-[2rem] ring-1 ring-ink/[0.08]">
            <div className="h-full rounded-[2rem] bg-surface p-8 sm:p-10">
              <p className="text-xl font-semibold tracking-[-0.03em] text-ink-2">A rank tracker alone</p>
              <ul className="mt-8 flex flex-col gap-5">
                {ALONE.map((item) => (
                  <li key={item} className="flex gap-4 text-ink-3">
                    <Minus size={20} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="lg:col-span-7">
          <div className="h-full rounded-[2rem]">
            <div className="relative h-full overflow-hidden rounded-[2rem] bg-cobalt p-8 text-white sm:p-10">
              <div aria-hidden="true" className="absolute -top-1/3 -right-1/4 size-[32rem] rounded-full bg-white/20 blur-[90px]" />
              <p className="relative text-xl font-semibold tracking-[-0.03em]">idraft</p>
              <ul className="relative mt-8 flex flex-col gap-5">
                {WITH.map((item) => (
                  <li key={item} className="flex gap-4">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-white text-cobalt">
                      <Check size={12} weight="bold" aria-hidden="true" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
