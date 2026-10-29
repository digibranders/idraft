'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { STORY_STEPS } from '@/content';

import { GapMatrix, LensVisual, RankChart } from './story-visuals';

gsap.registerPlugin(ScrollTrigger);

const FRAME = 'rounded-[2rem] bg-ink/[0.04] p-1.5 ring-1 ring-ink/[0.06] shadow-lift';
const CORE = 'relative overflow-hidden rounded-[calc(2rem-0.375rem)] bg-surface';
const VISUALS = [<RankChart key="chart" />, <LensVisual key="lens" />, <GapMatrix key="matrix" />];

/**
 * One keyword, two answers. On desktop the section pins and the scroll scrubs one timeline: the rank line
 * draws, then the lens takes over, then the matrix. Storytelling: the three views arrive in the order a
 * reader needs them. Below 1024px or with reduced motion nothing pins and the three steps simply stack.
 */
export function Story() {
  const root = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    const pinned = pin.current;
    if (!scope || !pinned) return;

    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const steps = gsap.utils.toArray<HTMLElement>('[data-step]', scope);
      const layers = gsap.utils.toArray<HTMLElement>('[data-layer]', scope);
      const line = scope.querySelector('[data-line]');
      const end = scope.querySelector('[data-end]');
      const rail = scope.querySelector('[data-rail]');
      if (!line || !end || !rail || steps.length !== 3 || layers.length !== 3) return;

      gsap.set(steps.slice(1), { opacity: 0.3 });
      gsap.set(layers.slice(1), { opacity: 0, scale: 0.96, y: 28 });
      gsap.set(end, { opacity: 0 });

      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: pinned, start: 'top top', end: '+=2400', pin: true, scrub: 0.6, anticipatePin: 1 },
      });
      timeline
        .fromTo(rail, { scaleY: 0 }, { scaleY: 1, duration: 3 }, 0)
        .fromTo(line, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.9 }, 0)
        .to(end, { opacity: 1, duration: 0.1 }, 0.9);

      // Hand over from view 1 to 2, then 2 to 3.
      [1, 2].forEach((next) => {
        const at = next;
        timeline
          .to(steps[next - 1] ?? [], { opacity: 0.3, duration: 0.3 }, at)
          .to(layers[next - 1] ?? [], { opacity: 0, scale: 0.96, y: -28, duration: 0.4 }, at)
          .to(steps[next] ?? [], { opacity: 1, duration: 0.3 }, at + 0.05)
          .to(layers[next] ?? [], { opacity: 1, scale: 1, y: 0, duration: 0.45 }, at + 0.1);
      });
    }, scope);

    return () => mm.revert();
  }, []);

  return (
    <section id="how" ref={root} className="relative">
      <div ref={pin} className="mx-auto flex min-h-[100dvh] max-w-[1320px] flex-col justify-center px-5 py-24 md:px-8">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
          <div className="lg:col-span-5">
            <p className="mb-5 inline-block rounded-full bg-wash px-3 py-1 text-[11px] font-medium tracking-[0.18em] text-cobalt-deep uppercase">How it works</p>
            <h2 className="text-[clamp(2.1rem,3.6vw,3.2rem)] leading-[1.05] font-semibold tracking-[-0.04em]">One keyword, two answers.</h2>

            {/* Desktop: the pinned list, dimmed and lit by the timeline. */}
            <div className="relative mt-10 hidden pl-8 lg:block">
              <span aria-hidden="true" className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-line" />
              <span data-rail aria-hidden="true" className="absolute top-1 bottom-1 left-0 w-0.5 origin-top rounded-full bg-cobalt" />
              <ol className="flex flex-col gap-9">
                {STORY_STEPS.map((step) => (
                  <li key={step.title} data-step>
                    <h3 className="text-xl font-semibold tracking-[-0.03em]">{step.title}</h3>
                    <p className="mt-2 max-w-[44ch] leading-relaxed text-ink-2">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Desktop: the stacked visuals the timeline cross-fades. */}
          <div className="hidden lg:col-span-7 lg:block">
            <div className={FRAME}>
              <div className={`${CORE} aspect-[4/3]`}>
                {VISUALS.map((visual, index) => (
                  <div key={STORY_STEPS[index]?.title} data-layer className="absolute inset-0 will-change-transform">
                    {visual}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Mobile and reduced motion: every step with its own visual, no pinning. */}
          <ol className="flex flex-col gap-14 lg:hidden">
            {STORY_STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-5">
                <div className={FRAME}>
                  <div className={`${CORE} aspect-[4/3]`}>{VISUALS_FOR_FLOW[index]}</div>
                </div>
                <div>
                  <h3 className="text-xl font-semibold tracking-[-0.03em]">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-ink-2">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// A second set of elements for the stacked layout: the same visuals, without the data attributes the timeline owns.
const VISUALS_FOR_FLOW = [
  <div key="chart" className="absolute inset-0">
    <RankChart />
  </div>,
  <div key="lens" className="absolute inset-0">
    <LensVisual />
  </div>,
  <div key="matrix" className="absolute inset-0">
    <GapMatrix />
  </div>,
];
