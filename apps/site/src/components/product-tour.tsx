'use client';

import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { AnimatePresence, motion } from 'motion/react';

import { ScreenFrame } from './mock/screen-frame';

gsap.registerPlugin(ScrollTrigger);

type Step = { pill: string; title: string; body: string; src: string; alt: string; label: string };

const TODAY = 'A screen from the app today, with sample data.';
const BUILDING = 'A designed screen in build, with sample data.';

// Screens marked "today" are screenshots of the running app. The rest are the design previews of screens still being built.
const STEPS: readonly [Step, ...Step[]] = [
  { pill: 'Overview', title: 'The whole picture, on one page.', body: 'SEO visibility and the mention rate in every AI engine, with how they moved and the checks behind each number.', src: '/screens/p-overview.png', alt: 'The Overview screen: SEO visibility, top 10 keywords, AI Overview citation rate and the mention rate in ChatGPT, Gemini and AI Mode, with a trend chart and the rank distribution.', label: BUILDING },
  { pill: 'Keywords', title: 'Every keyword, checked every day.', body: 'Position, change since the last check, the page that ranks and the volume, difficulty and cost behind each one.', src: '/screens/keywords.png', alt: 'The Keywords screen of the idraft app: a table of tracked keywords with rank, change, ranking URL, volume, difficulty, CPC, intent, priority and group.', label: TODAY },
  { pill: 'Detail', title: 'Open a row for the whole story.', body: 'Search volume by month, difficulty, cost per click, groups and topics, and the checks behind the rank.', src: '/screens/keyword-inspector.png', alt: 'The Keywords screen with one keyword open in the inspector: volume by month as a bar chart, difficulty, cost per click, groups and topics.', label: TODAY },
  { pill: 'AI answers', title: 'Every topic, read in every engine.', body: 'Mention rate and citation rate per engine for each topic, with the number of checks behind them.', src: '/screens/p-prompts.png', alt: 'The Topics and Prompts screen: mention rate in ChatGPT, Gemini, AI Mode and AI Overview, and a table of topics with mention rate, citation rate, top engine and trend.', label: BUILDING },
  { pill: 'Pages', title: 'See which pages gain and which slip.', body: 'Clicks, impressions, CTR and position for each URL from Search Console, compared month over month.', src: '/screens/p-pages.png', alt: 'The Pages screen: a table of pages with health, indexing, clicks, impressions, CTR, position and a trend line.', label: BUILDING },
];

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
        <div className="lg:col-span-6">
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

        <div className="lg:col-span-6">
          <div role="tablist" aria-label="Product screens" className="flex flex-wrap gap-2 lg:justify-end">
            {STEPS.map((item, index) => (
              <button
                key={item.pill}
                role="tab"
                type="button"
                aria-selected={index === step}
                onClick={() => choose(index)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ${index === step ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-ink/10 hover:text-ink hover:ring-ink/30'}`}
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
            <ScreenFrame src={current.src} alt={current.alt} heightClass="h-[26rem] sm:h-[28rem] lg:h-[27rem]" />
          </motion.div>
        </AnimatePresence>
        <p className="mt-3 text-center font-mono text-[11px] text-ink-3">{current.label}</p>
      </div>
    </section>
  );
}
