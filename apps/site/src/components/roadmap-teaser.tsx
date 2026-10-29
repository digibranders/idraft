import Link from 'next/link';

import { PLANNED } from '@/content';

import { Reveal } from './reveal';

/** Where the platform is heading. Planned items are marked planned and carry no dates. */
export function RoadmapTeaser() {
  return (
    <section className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
      <div className="relative isolate overflow-hidden rounded-[2.5rem] bg-violet-wash px-6 py-14 sm:px-12 lg:px-16 lg:py-20">
        <div aria-hidden="true" className="absolute -top-1/3 -right-1/4 -z-10 size-[40rem] rounded-full bg-violet/20 blur-[110px]" />
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <Reveal className="lg:col-span-5">
            <h2 className="text-[clamp(2.1rem,3.8vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">It starts with rankings and AI answers. It will not stop there.</h2>
            <p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-ink-2">idraft is built around one record per topic, so every new tool lands next to the data you already trust.</p>
            <Link href="/roadmap" className="group mt-8 inline-flex items-center gap-3 text-[15px] font-medium text-cobalt-deep">
              See the roadmap
              <span aria-hidden="true" className="transition duration-500 ease-heavy group-hover:translate-x-1">→</span>
            </Link>
          </Reveal>
          <ul className="lg:col-span-7">
            {PLANNED.map((item, index) => (
              <li key={item.title}>
                <Reveal delay={index * 0.06}>
                  <div className="flex items-start justify-between gap-6 border-t border-violet/20 py-6">
                    <div>
                      <h3 className="text-xl font-semibold tracking-[-0.03em]">{item.title}</h3>
                      <p className="mt-2 max-w-[46ch] leading-relaxed text-ink-2">{item.body}</p>
                    </div>
                    <span className="mt-1 shrink-0 rounded-full bg-surface px-3 py-1 text-xs font-medium text-violet ring-1 ring-violet/25">Planned</span>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
