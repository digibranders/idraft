'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { AnimatePresence, motion } from 'motion/react';

import { Dashboard } from './mock/dashboard';
import type { MockView } from './mock/app-frame';

gsap.registerPlugin(ScrollTrigger);

const STEPS = [
  { view: 'keywords', pill: 'Keywords', title: 'Every keyword, checked every day.', body: 'Position, change since the last check, the page that ranks and the SERP features, on one row.' },
  { view: 'ai', pill: 'AI answers', title: 'Every prompt, read in every engine.', body: 'Who is named, in what position, and which sources the answer cites, with your brand picked out.' },
  { view: 'matrix', pill: 'Matrix', title: 'Rank and answer, side by side.', body: 'Each topic with its Google rank and its mention rate, so a gap between the two is obvious.' },
  { view: 'sources', pill: 'Sources', title: 'Who the AI trusts, ranked.', body: 'The domains answers cite for your topics, by type and by how often, with you in the list.' },
] as const satisfies readonly { view: MockView; pill: string; title: string; body: string }[];

/**
 * A product tour driven by the scroll. On desktop the section pins and the page walks the dashboard through its
 * four views, swapping the headline and the line under it. Storytelling: one record, four ways to read it.
 * Under 1024px nothing pins; the pills switch the view. Clicking a pill while pinned scrolls to that view.
 */
export function ProductTour() {
  const [step, setStep] = useState(0);
  const section = useRef<HTMLElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);
  const current = STEPS[step] ?? STEPS[0];

  useEffect(() => {
    const scope = section.current;
    const fill = bar.current;
    if (!scope || !fill) return;
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      let last = 0;
      trigger.current = ScrollTrigger.create({
        trigger: scope,
        start: 'top top',
        end: '+=2400',
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          fill.style.transform = `scaleX(${self.progress})`;
          const index = Math.min(STEPS.length - 1, Math.floor(self.progress * STEPS.length));
          if (index !== last) {
            last = index;
            setStep(index);
          }
        },
      });
      return () => {
        trigger.current = null;
      };
    }, scope);
    return () => mm.revert();
  }, []);

  const choose = (index: number) => {
    const st = trigger.current;
    if (!st) {
      setStep(index);
      return;
    }
    window.scrollTo({ top: st.start + ((index + 0.5) / STEPS.length) * (st.end - st.start), behavior: 'smooth' });
  };

  return (
    <section ref={section} aria-label="Product tour" className="mx-auto flex max-w-[1320px] flex-col justify-center px-5 pt-24 pb-16 md:px-8 lg:min-h-[100dvh] lg:justify-center lg:pt-20 lg:pb-6">
      <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <AnimatePresence mode="wait" initial={false}>
            <motion.h2
              key={current.title}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
              className="min-h-[2.1em] text-[clamp(2rem,3.4vw,3.1rem)] leading-[1.04] font-semibold tracking-[-0.05em] text-balance"
            >
              {current.title}
            </motion.h2>
          </AnimatePresence>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={current.body} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="mt-3 min-h-[3.2em] max-w-[52ch] text-base leading-relaxed text-ink-2 md:text-lg">
              {current.body}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="lg:col-span-5">
          <div role="tablist" aria-label="Product views" className="flex flex-wrap gap-2 lg:justify-end">
            {STEPS.map((item, index) => (
              <button
                key={item.view}
                role="tab"
                type="button"
                aria-selected={index === step}
                onClick={() => choose(index)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ${index === step ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-ink/10 hover:text-ink hover:ring-ink/30'}`}
              >
                {item.pill}
              </button>
            ))}
          </div>
          <span aria-hidden="true" className="mt-4 hidden h-0.5 w-full rounded-full bg-line lg:block">
            <span ref={bar} className="block h-full origin-left rounded-full bg-cobalt" style={{ transform: 'scaleX(0)' }} />
          </span>
        </div>
      </div>

      <div className="mt-6">
        <Dashboard view={current.view} onViewChange={(view) => choose(Math.max(0, STEPS.findIndex((item) => item.view === view)))} heightClass="h-[30rem] sm:h-[32rem] lg:h-[27rem]" />
      </div>
    </section>
  );
}
