import Link from 'next/link';

import { MORE_FEATURES } from '@/content';

import { Reveal } from './reveal';

/** The rest of the platform, past the three product pages: a heading that stays put while the feature list scrolls past it. */
export function FeaturesTeaser() {
  return (
    <section className="mx-auto max-w-[1320px] px-5 py-16 md:px-8 lg:py-20">
      <div className="relative isolate overflow-clip rounded-[2.5rem] bg-violet-wash px-6 py-14 sm:px-12 lg:px-16 lg:py-14">
        <div aria-hidden="true" className="absolute -top-1/3 -right-1/4 -z-10 size-[40rem] rounded-full bg-violet/20 blur-[110px]" />
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <Reveal>
                <h2 className="text-[clamp(2.1rem,3.8vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">More than a rank tracker.</h2>
                <p className="mt-5 max-w-[42ch] text-lg leading-relaxed text-ink-2">Audit your site, watch your pages, find what to track next and follow your rivals, all on the same record as your rankings and AI answers.</p>
                <Link href="/features" className="group mt-8 inline-flex items-center gap-3 text-[15px] font-medium text-cobalt-deep">
                  See every feature
                  <span aria-hidden="true" className="transition duration-500 ease-heavy group-hover:translate-x-1">→</span>
                </Link>
              </Reveal>
            </div>
          </div>
          <ul className="lg:col-span-7">
            {MORE_FEATURES.slice(0, 4).map((item, index) => (
              <li key={item.title}>
                <Reveal delay={index * 0.06}>
                  <div className="border-t border-violet/20 py-6">
                    <div>
                      <h3 className="text-xl font-semibold tracking-[-0.03em]">{item.title}</h3>
                      <p className="mt-2 max-w-[46ch] leading-relaxed text-ink-2">{item.body}</p>
                    </div>
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
