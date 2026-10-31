'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { ChatGptArt, GeminiArt, ModeArt, OverviewArt } from './art/illustrations';
import { Wave } from './wave';

gsap.registerPlugin(ScrollTrigger);

const PANELS = [
  { name: 'Google AI Overviews', body: 'The summary above the results, with the sources it links to and the brands it names.', logo: '/logos/google.svg', width: 77, art: <OverviewArt />, tint: 'bg-amber-wash' },
  { name: 'Google AI Mode', body: 'Follow-up answers in a conversation, each with its own cited sources.', logo: '/logos/google.svg', width: 77, art: <ModeArt />, tint: 'bg-violet-wash' },
  { name: 'ChatGPT', body: 'Answers that recommend brands and cite the pages they drew on.', logo: '/logos/openai.svg', width: 86, art: <ChatGptArt />, tint: 'bg-mint-wash' },
  { name: 'Gemini', body: 'Answers with citations, collected on the same schedule as the rest.', logo: '/logos/gemini.svg', width: 98, art: <GeminiArt />, tint: 'bg-coral-wash' },
] as const;

/**
 * Direction change: the page stops scrolling down and the four engines slide in sideways. The track moves by
 * the scroll distance, so the reader controls the pace. Under 1024px or reduced motion it is a normal swipe row.
 */
export function HorizontalEngines() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    const rail = track.current;
    if (!scope || !rail) return;
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const distance = () => rail.scrollWidth - window.innerWidth + 64;
      gsap.to(rail, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: { trigger: scope, start: 'top top', end: () => `+=${distance()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true, anticipatePin: 1 },
      });
    }, scope);
    return () => mm.revert();
  }, []);

  return (
    <div>
      {/* The journey above ends in yellow; the wave's gap shows that color, so one scene flows into the next. */}
      <div className="bg-amber-wash">
        <Wave edge="top" />
      </div>
      <section ref={root} aria-label="The four answer engines" className="relative overflow-hidden bg-wash">
        <div ref={track} className="flex min-h-[76dvh] items-center gap-6 overflow-x-auto px-5 py-20 [scrollbar-width:none] md:px-8 lg:overflow-visible lg:py-20 [&::-webkit-scrollbar]:hidden">
          <div className="w-[min(86vw,32rem)] shrink-0 lg:pr-10">
            <h2 className="text-[clamp(2.4rem,4.6vw,4.4rem)] leading-[1] font-semibold tracking-[-0.05em] text-balance">Four places people get answers.</h2>
            <p className="mt-6 max-w-[34ch] text-lg leading-relaxed text-ink-2">idraft reads all of them on a schedule and keeps what each one said.</p>
          </div>
          {PANELS.map((panel) => (
            <article key={panel.name} className="grid h-[min(64dvh,32rem)] w-[min(88vw,46rem)] shrink-0 overflow-hidden rounded-[2.5rem] bg-surface shadow-[0_28px_44px_-26px_rgb(30_101_227/0.3)] ring-1 ring-ink/[0.07] sm:grid-cols-2">
              <div className="flex flex-col justify-between gap-8 p-8 sm:p-10">
                <Image src={panel.logo} alt="" width={panel.width} height={24} unoptimized className="h-6 w-auto opacity-80" />
                <div>
                  <h3 className="text-[clamp(1.8rem,2.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.04em]">{panel.name}</h3>
                  <p className="mt-3 max-w-[30ch] leading-relaxed text-ink-2">{panel.body}</p>
                </div>
              </div>
              <div aria-hidden="true" className={`relative hidden sm:block ${panel.tint}`}>
                {panel.art}
              </div>
            </article>
          ))}
        </div>
      </section>
      <Wave edge="bottom" />
    </div>
  );
}
