'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { AnswerCard } from './mock/fragments';
import { Wave } from './wave';

gsap.registerPlugin(ScrollTrigger);

const PANELS = [
  { name: 'Google AI Overviews', body: 'The summary above the results, with the sources it links to and the brands it names.', logo: '/logos/google.svg', width: 77 },
  { name: 'Google AI Mode', body: 'Follow-up answers in a conversation, each with its own cited sources.', logo: '/logos/google.svg', width: 77 },
  { name: 'ChatGPT', body: 'Answers that recommend brands and cite the pages they drew on.', logo: '/logos/openai.svg', width: 86 },
  { name: 'Gemini', body: 'Answers with citations, collected on the same schedule as the rest.', logo: '/logos/gemini.svg', width: 98 },
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
      <Wave edge="top" />
      <section ref={root} aria-label="The four answer engines" className="relative overflow-hidden bg-wash">
        <div ref={track} className="flex min-h-[100dvh] items-center gap-6 overflow-x-auto px-5 py-20 [scrollbar-width:none] md:px-8 lg:overflow-visible lg:py-0 [&::-webkit-scrollbar]:hidden">
          <div className="w-[min(86vw,32rem)] shrink-0 lg:pr-10">
            <h2 className="text-[clamp(2.4rem,4.6vw,4.4rem)] leading-[1] font-semibold tracking-[-0.05em] text-balance">Four places people get answers.</h2>
            <p className="mt-6 max-w-[34ch] text-lg leading-relaxed text-ink-2">idraft reads all of them on a schedule and keeps what each one said.</p>
          </div>
          {PANELS.map((panel, index) => (
            <article key={panel.name} className="grid h-[min(70dvh,34rem)] w-[min(88vw,46rem)] shrink-0 overflow-hidden rounded-[2.5rem] bg-surface shadow-lift ring-1 ring-ink/[0.07] sm:grid-cols-2">
              <div className="flex flex-col justify-between gap-8 p-8 sm:p-10">
                <Image src={panel.logo} alt="" width={panel.width} height={24} unoptimized className="h-6 w-auto opacity-80" />
                <div>
                  <h3 className="text-[clamp(1.8rem,2.6vw,2.4rem)] leading-tight font-semibold tracking-[-0.04em]">{panel.name}</h3>
                  <p className="mt-3 max-w-[30ch] leading-relaxed text-ink-2">{panel.body}</p>
                </div>
              </div>
              <div className="hidden items-center bg-paper p-5 sm:flex">
                <AnswerCard index={index} className="w-full shadow-lift" />
              </div>
            </article>
          ))}
        </div>
      </section>
      <Wave edge="bottom" />
    </div>
  );
}
