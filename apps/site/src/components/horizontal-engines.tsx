'use client';

import Image from 'next/image';
import { ArrowRight } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { ChatGptArt, GeminiArt, ModeArt, OverviewArt, SearchArt } from './art/illustrations';
import { Wave } from './wave';

gsap.registerPlugin(ScrollTrigger);

const SEARCH_PANEL = {
  name: 'Google Search',
  category: 'Rankings',
  body: 'Daily positions for every keyword, country and device, with the page that ranks.',
  logo: '/logos/google.svg',
  width: 77,
  art: <SearchArt />,
  tint: 'from-wash via-surface to-wash',
  marker: 'bg-cobalt',
} as const;

const PANELS = [
  { name: 'Google AI Overviews', category: 'Search summaries', body: 'See the brands named and pages cited in the answer above the search results.', logo: '/logos/google.svg', width: 77, art: <OverviewArt />, tint: 'from-amber-wash via-surface to-amber-wash', marker: 'bg-amber' },
  { name: 'Google AI Mode', category: 'Follow-up answers', body: 'Follow the conversation, with the sources behind each answer kept together.', logo: '/logos/google.svg', width: 77, art: <ModeArt />, tint: 'from-violet-wash via-surface to-violet-wash', marker: 'bg-violet' },
  { name: 'ChatGPT', category: 'Recommendations', body: 'See which brands make the shortlist and which pages support the answer.', logo: '/logos/openai.svg', width: 86, art: <ChatGptArt />, tint: 'from-mint-wash via-surface to-mint-wash', marker: 'bg-mint' },
  { name: 'Gemini', category: 'Cited answers', body: 'Read the mentions and citations, checked on the same schedule as the rest.', logo: '/logos/gemini.svg', width: 98, art: <GeminiArt />, tint: 'from-wash via-surface to-coral-wash', marker: 'bg-coral' },
] as const;

type HorizontalEnginesProps = {
  /** The homepage waves connect this section to its neighboring scenes. */
  withWaves?: boolean;
  /** Adds classic Google Search as the first card. The AI visibility page leaves it out, rankings have their own page. */
  withSearch?: boolean;
};

/** A scroll-driven desktop story with native swiping on phones and a static reduced-motion fallback. */
export function HorizontalEngines({ withWaves = true, withSearch = true }: HorizontalEnginesProps): ReactElement {
  const panels = withSearch ? [SEARCH_PANEL, ...PANELS] : PANELS;
  const total = String(panels.length).padStart(2, '0');
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    const scene = track.current;
    if (!scope || !scene) return;

    const media = gsap.matchMedia();
    media.add('(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)', () => {
      scope.dataset.scrollPinned = 'true';
      const distance = (): number => Math.max(0, scene.scrollWidth - scope.clientWidth);

      gsap.to(scene, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          trigger: scope,
          start: 'top top',
          end: () => `+=${distance()}`,
          pin: true,
          scrub: 0.8,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });

      return () => { delete scope.dataset.scrollPinned; };
    }, scope);

    return () => media.revert();
  }, []);

  return (
    <div>
      {withWaves ? (
        <div className="bg-amber-wash">
          <Wave edge="top" />
        </div>
      ) : null}
      <section ref={root} aria-label={withSearch ? 'The five places answers come from' : 'The four answer engines'} className="engine-story overflow-hidden bg-wash py-8 md:py-12">
        <div ref={track} className="engine-scene mx-auto max-w-[1320px]">
          <div className="engine-intro px-5 md:px-8">
            <h2 className="max-w-[20ch] text-[clamp(2.2rem,4.2vw,3.8rem)] leading-[1.05] font-semibold tracking-[-0.05em] text-balance">{withSearch ? 'Five places people find answers.' : 'Four places people get answers.'}</h2>
            <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-ink-2 md:text-lg">idraft reads all of them on a schedule and keeps what each one said.</p>
          </div>
          <div className="mt-8 flex items-center justify-between px-5 text-xs font-medium text-ink-2 md:hidden">
            <span>{panels.length} places. Every answer on record.</span>
            <span aria-hidden="true" className="flex items-center gap-2">Swipe to explore <ArrowRight size={16} /></span>
          </div>
          <div
            role="region"
            aria-label="Answer engine cards"
            // A native scroll region needs a tab stop so keyboard users can scroll with arrow keys.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className={`engine-cards mt-4 grid auto-cols-[min(84vw,22rem)] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain px-5 pt-1 pb-6 [scroll-padding-inline:1.25rem] [scrollbar-width:none] snap-x snap-mandatory focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cobalt md:mt-9 md:auto-cols-auto md:grid-flow-row md:grid-cols-2 md:overflow-x-visible md:px-8 ${withSearch ? 'xl:grid-cols-3' : 'xl:grid-cols-4'} [&::-webkit-scrollbar]:hidden`}
          >
            {panels.map((panel, index) => (
              <article key={panel.name} className="engine-card flex min-w-0 snap-start flex-col overflow-hidden rounded-[2rem] bg-surface shadow-[0_12px_24px_-18px_rgb(96_72_26/0.22)] ring-1 ring-ink/[0.07] motion-safe:transition-transform motion-safe:duration-300 motion-safe:md:hover:-translate-y-1">
                <div className={`relative overflow-hidden bg-gradient-to-br ${panel.tint}`}>
                  <div className="relative z-10 flex h-16 items-center justify-between gap-3 px-5">
                    <Image src={panel.logo} alt="" width={panel.width} height={24} unoptimized className="h-5 w-auto" />
                    <span aria-hidden="true" className="font-mono text-[11px] text-ink-2">0{index + 1} / {total}</span>
                  </div>
                  <div aria-hidden="true" className="engine-card-art relative h-52 overflow-hidden [&>div]:rounded-none [&>div]:bg-none">
                    {panel.art}
                  </div>
                </div>
                <div className="engine-card-copy px-5 pt-5 pb-6">
                  <p className="flex items-center gap-2 text-xs font-medium text-ink-2">
                    <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${panel.marker}`} />
                    {panel.category}
                  </p>
                  <h3 className="engine-card-title mt-2.5 text-[1.375rem] leading-tight font-semibold tracking-[-0.04em]">{panel.name}</h3>
                  <p className="engine-card-body mt-2.5 text-sm leading-relaxed text-pretty text-ink-2">{panel.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      {withWaves ? <Wave edge="bottom" /> : null}
    </div>
  );
}
