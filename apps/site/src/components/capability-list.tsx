import type { Icon } from '@phosphor-icons/react';

import { Reveal } from './reveal';

export type Capability = { icon: Icon; title: string; body: string };

type CapabilityListProps = { title: string; lead?: string; items: readonly Capability[] };

/** A heading on the left and a two-column list of capabilities on the right, divided by hairlines. */
export function CapabilityList({ title, lead, items }: CapabilityListProps) {
  return (
    <section className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className="lg:col-span-4">
          <div className="lg:sticky lg:top-32">
            <h2 className="text-[clamp(2.1rem,3.6vw,3.2rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">{title}</h2>
            {lead ? <p className="mt-5 max-w-[34ch] text-lg leading-relaxed text-ink-2">{lead}</p> : null}
          </div>
        </Reveal>
        <ul className="grid gap-x-10 sm:grid-cols-2 lg:col-span-8">
          {items.map((item, index) => {
            const Glyph = item.icon;
            return (
              <li key={item.title}>
                <Reveal delay={(index % 2) * 0.07}>
                  <div className="border-t border-line py-9">
                    <Glyph size={34} weight="thin" aria-hidden="true" className="text-ink" />
                    <h3 className="mt-6 text-xl font-semibold tracking-[-0.03em]">{item.title}</h3>
                    <p className="mt-2 max-w-[40ch] leading-relaxed text-ink-2">{item.body}</p>
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
