import Image from 'next/image';

import { ACCESS_HREF } from '@/content';

import { Button } from './button';
import { HeroFrame } from './hero-frame';

const rise = (index: number) => ({ '--i': index }) as React.CSSProperties;

/**
 * An inset, framed hero: the atrium render fills a large rounded frame, a paper wash on the left keeps the
 * headline legible. The image settles from a slight zoom as the page loads.
 */
export function HomeHero() {
  return (
    <section className="p-3">
      <HeroFrame>
        <Image
          src="/images/atrium.png"
          alt="A bright atrium where a staircase of blue glass steps climbs into a shaft of daylight."
          fill
          priority
          sizes="100vw"
          className="hero-zoom -z-20 object-cover object-[70%_50%]"
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-paper via-paper/80 to-paper/0 lg:via-paper/55" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-paper/70 to-transparent" />

        <div className="mx-auto w-full max-w-[1320px] px-6 pt-28 pb-16 md:px-10">
          <h1 className="max-w-[12ch] text-[clamp(3rem,6.4vw,6rem)] leading-[0.98] font-semibold tracking-[-0.055em] text-ink">
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
          <p className="rise mt-8 max-w-[38ch] text-lg leading-relaxed text-pretty text-ink-2 md:text-xl" style={rise(2)}>
            One place to track where you rank in search and what ChatGPT, Gemini and Google AI say about you.
          </p>
          <div className="rise mt-10 flex flex-wrap items-center gap-3" style={rise(3)}>
            <Button href={ACCESS_HREF}>Request access</Button>
            <Button href="/how-it-works" variant="secondary">
              See how it works
            </Button>
          </div>
        </div>
      </HeroFrame>
    </section>
  );
}
