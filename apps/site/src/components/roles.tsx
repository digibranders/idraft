'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';

gsap.registerPlugin(ScrollTrigger);

const ROLES = [
  {
    id: 'seo',
    label: 'SEO lead',
    question: 'Why did we lose that keyword, and did AI notice?',
    points: ['See the ranking page, the change and the SERP features on one row', 'Spot where AI Overviews answer a keyword you used to own', 'Prove a drop or a gain with dated checks'],
  },
  {
    id: 'agency',
    label: 'Agency',
    question: 'What do I show the client on Monday?',
    points: ['One project per client, with its own competitors and locations', 'Rankings and AI answers in the same report, with evidence behind each number', 'A history that shows progress as real data'],
  },
  {
    id: 'content',
    label: 'Content team',
    question: 'Which pages should we write or fix next?',
    points: ['See which sources AI cites for your topics, and who earns the mention', 'Find prompts where a rival is named and you are not', 'Link every finding back to the keyword and the page'],
  },
] as const;

type RoleId = (typeof ROLES)[number]['id'];

/**
 * Three roles, one panel. On desktop the section pins and the scroll moves through the roles one after another,
 * with a line along the top filling as you go. Clicking a role scrolls to its place. Storytelling: the same
 * product answers a different question for each person, in sequence. Under 1024px or reduced motion it is a
 * plain set of tabs.
 */
export function Roles() {
  const [active, setActive] = useState<RoleId>('seo');
  const group = useId();
  const section = useRef<HTMLElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const trigger = useRef<ScrollTrigger | null>(null);
  const role = ROLES.find((item) => item.id === active) ?? ROLES[0];

  useEffect(() => {
    const scope = section.current;
    const line = progress.current;
    if (!scope || !line) return;
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      let last = 0;
      trigger.current = ScrollTrigger.create({
        trigger: scope,
        start: 'top top',
        end: '+=1900',
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => {
          line.style.transform = `scaleX(${self.progress})`;
          const index = Math.min(ROLES.length - 1, Math.floor(self.progress * ROLES.length));
          if (index !== last) {
            last = index;
            setActive(ROLES[index]?.id ?? 'seo');
          }
        },
      });
      return () => {
        trigger.current = null;
      };
    }, scope);
    return () => mm.revert();
  }, []);

  const choose = (id: RoleId) => {
    const st = trigger.current;
    if (!st) {
      setActive(id);
      return;
    }
    // Pinned: scroll to the middle of that role's share of the pin, and the scroll handler sets the role.
    const index = ROLES.findIndex((item) => item.id === id);
    window.scrollTo({ top: st.start + ((index + 0.5) / ROLES.length) * (st.end - st.start), behavior: 'smooth' });
  };

  return (
    <section ref={section} className="mx-auto flex max-w-[1320px] flex-col justify-center px-5 py-24 md:px-8 lg:min-h-[100dvh] lg:py-24">
      <h2 className="max-w-[18ch] text-[clamp(2.1rem,3.8vw,3.4rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">Built for the person who gets asked.</h2>
      <span aria-hidden="true" className="mt-8 hidden h-0.5 w-full rounded-full bg-line lg:block">
        <span ref={progress} className="block h-full origin-left rounded-full bg-cobalt" style={{ transform: 'scaleX(0)' }} />
      </span>
      <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-16">
        <LayoutGroup id={group}>
          <div role="tablist" aria-label="Roles" className="flex gap-2 lg:col-span-4 lg:flex-col">
            {ROLES.map((item) => (
              <button
                key={item.id}
                role="tab"
                type="button"
                id={`${group}-${item.id}`}
                aria-selected={active === item.id}
                aria-controls={`${group}-panel`}
                onClick={() => choose(item.id)}
                className="relative rounded-full px-6 py-3.5 text-left text-lg font-medium tracking-[-0.02em] transition duration-300 lg:rounded-3xl lg:py-5 lg:text-2xl"
              >
                {active === item.id && <motion.span layoutId="role-pill" transition={{ type: 'spring', stiffness: 380, damping: 34 }} className="absolute inset-0 rounded-[inherit] bg-surface shadow-lift ring-1 ring-ink/[0.07]" />}
                <span className={`relative transition-colors duration-300 ${active === item.id ? 'text-ink' : 'text-ink-3'}`}>{item.label}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>

        <div role="tabpanel" id={`${group}-panel`} aria-labelledby={`${group}-${active}`} className="lg:col-span-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={role.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
              className="rounded-[2rem] bg-ink/[0.04] p-1.5 ring-1 ring-ink/[0.06]"
            >
              <div className="rounded-[calc(2rem-0.375rem)] bg-surface p-8 sm:p-12">
                <p className="text-[clamp(1.6rem,2.8vw,2.4rem)] leading-tight font-semibold tracking-[-0.04em] text-balance">{role.question}</p>
                <ul className="mt-8 flex flex-col gap-4">
                  {role.points.map((point) => (
                    <li key={point} className="flex gap-4 text-lg leading-relaxed text-ink-2">
                      <span aria-hidden="true" className="mt-3 h-0.5 w-5 shrink-0 rounded-full bg-cobalt" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
