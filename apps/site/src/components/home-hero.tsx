import Image from 'next/image';

import { ACCESS_HREF } from '@/content';

import { Button } from './button';
import { HeroFrame } from './hero-frame';

const rise = (index: number) => ({ '--i': index }) as React.CSSProperties;

/**
 * A full-bleed first screen: the product itself is the scene, with a paper wash on the left keeping the headline
 * legible. On scroll it pins and pulls back into a rounded card (see HeroFrame).
 */
export function HomeHero() {
  return (
    <>
      <HeroFrame>
        {/* The product is the scene: the Overview screen, bled off the right edge and tilted back a little. */}
        <div aria-hidden="true" className="absolute inset-0 -z-20 bg-paper" />
        <div className="absolute inset-0 -z-20 flex items-center justify-end overflow-hidden max-lg:hidden">
          <div data-hero-image className="mr-[-22%] w-[74%] [perspective:1800px]">
          <div data-hero-tilt className="origin-center [transform:rotateY(-14deg)_rotateX(4deg)_rotateZ(-1deg)] overflow-hidden rounded-[1.5rem] shadow-[0_80px_140px_-50px_rgb(20_23_28/0.45),0_40px_80px_-40px_rgb(30_101_227/0.35)] ring-1 ring-ink/10">
            <Image src="/screens/p-overview.png" alt="The Overview screen of the idraft app: SEO visibility and the mention rate in ChatGPT, Gemini and AI Mode, a trend chart and the rank distribution." width={2880} height={1760} priority sizes="70vw" className="h-auto w-full" />
          </div>
          </div>
        </div>
        <div aria-hidden="true" className="absolute top-1/3 right-0 -z-10 h-[40rem] w-[50rem] rounded-full bg-cobalt/15 blur-[130px]" />
        {/* The scene fades into the page at its bottom edge, so the cropped product never ends on a hard line. */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 z-0 h-32 bg-gradient-to-t from-paper to-transparent" />
        <div aria-hidden="true" data-hero-wash className="absolute inset-y-0 left-0 -z-10 w-[64%] bg-gradient-to-r from-paper via-paper/92 to-transparent" />

        <div data-hero-copy className="mx-auto w-full max-w-[1320px] px-6 pt-28 pb-16 md:px-10">
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
    </>
  );
}
