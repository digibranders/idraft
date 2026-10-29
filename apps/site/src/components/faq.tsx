import { Plus } from '@phosphor-icons/react/dist/ssr';

import { FAQ_ITEMS } from '@/content';

import { Reveal } from './reveal';

/** Native details elements: keyboard and screen reader behavior comes from the platform. */
export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
      <Reveal>
        <p className="mb-5 inline-block rounded-full bg-wash px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-cobalt-deep uppercase">FAQ</p>
        <h2 className="text-[clamp(2.1rem,3.6vw,3.2rem)] leading-[1.05] font-semibold tracking-[-0.04em]">Questions, answered.</h2>
      </Reveal>
      <div className="mt-12 grid items-start gap-x-6 gap-y-3 md:grid-cols-2">
        {FAQ_ITEMS.map((item, index) => (
          <Reveal key={item.q} delay={(index % 2) * 0.06}>
            <details className="group rounded-3xl bg-surface px-6 py-5 ring-1 ring-ink/[0.07] transition duration-500 ease-heavy open:shadow-lift hover:ring-ink/20">
              <summary className="flex cursor-pointer items-center justify-between gap-6 text-lg font-medium tracking-[-0.02em] outline-none focus-visible:text-cobalt-deep">
                {item.q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink/5 transition duration-500 ease-heavy group-open:rotate-45 group-open:bg-cobalt group-open:text-white">
                  <Plus size={16} weight="bold" aria-hidden="true" />
                </span>
              </summary>
              <p className="mt-4 max-w-[60ch] leading-relaxed text-ink-2">{item.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
