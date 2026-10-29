import { ACCESS_HREF } from '@/content';

import { Button } from './button';
import { HeroVisual } from './hero-visual';

const rise = (index: number) => ({ '--i': index }) as React.CSSProperties;

export function Hero() {
  return (
    <section id="top" className="mx-auto grid min-h-[100dvh] max-w-[1320px] items-center gap-12 px-5 pb-12 pt-24 md:px-8 lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-5">
        <h1 className="text-[clamp(2.5rem,4.6vw,4.1rem)] leading-[1.03] font-semibold tracking-[-0.045em] text-ink">
          <span className="rise block" style={rise(0)}>
            Rank on Google.
          </span>
          <span className="rise block text-cobalt" style={rise(1)}>
            Get{' '}
            <span className="relative inline-block">
              named
              <svg viewBox="0 0 170 14" preserveAspectRatio="none" aria-hidden="true" className="absolute -bottom-1 left-0 h-3 w-full overflow-visible">
                <path d="M2 9 C 38 2, 92 13, 168 4" pathLength={1} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="draw" />
              </svg>
            </span>{' '}
            by AI.
          </span>
        </h1>
        <p className="rise mt-7 max-w-[36ch] text-lg leading-relaxed text-pretty text-ink-2" style={rise(2)}>
          One place to track where you rank in search and what ChatGPT, Gemini and Google AI say about you.
        </p>
        <div className="rise mt-9 flex flex-wrap items-center gap-3" style={rise(3)}>
          <Button href={ACCESS_HREF}>Request access</Button>
          <Button href="#how" variant="secondary">
            See how it works
          </Button>
        </div>
      </div>
      <div className="lg:col-span-7 lg:pl-6">
        <HeroVisual />
      </div>
    </section>
  );
}
