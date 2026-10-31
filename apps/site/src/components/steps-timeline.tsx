'use client';

import { useRef } from 'react';
import { motion, useScroll, useSpring } from 'motion/react';

export type TimelineStep = { title: string; body: string; detail: string };

/**
 * A vertical timeline: the cobalt line fills as the reader moves down, and each step lights as it arrives.
 * Storytelling: the line is the passage of a day, from setup to the first reading.
 */
export function StepsTimeline({ steps }: { steps: readonly TimelineStep[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.7', 'end 0.6'] });
  const fill = useSpring(scrollYProgress, { stiffness: 110, damping: 28 });

  return (
    <ol ref={ref} className="relative mx-auto max-w-[1100px] pl-10 sm:pl-16">
      <span aria-hidden="true" className="absolute top-2 bottom-2 left-[11px] w-0.5 rounded-full bg-line sm:left-[19px]" />
      <motion.span aria-hidden="true" data-fill style={{ scaleY: fill }} className="absolute top-2 bottom-2 left-[11px] w-0.5 origin-top rounded-full bg-cobalt sm:left-[19px]" />
      {steps.map((step, index) => (
        <li key={step.title} className="relative pb-20 last:pb-0">
          <motion.span
            aria-hidden="true"
            initial={{ scale: 0.6, backgroundColor: '#E1E5EB' }}
            whileInView={{ scale: 1, backgroundColor: '#1E65E3' }}
            viewport={{ once: true, amount: 0.9 }}
            transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
            className="absolute top-1.5 -left-10 size-6 rounded-full ring-8 ring-paper sm:-left-16 sm:size-10 sm:ring-[10px]"
          />
          <motion.div
            initial={{ opacity: 0, y: 36, filter: 'blur(8px)' }}
            whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.9, delay: 0.05 * index, ease: [0.32, 0.72, 0, 1] }}
          >
            <h3 className="text-[clamp(1.8rem,3vw,2.6rem)] leading-tight font-semibold tracking-[-0.045em]">{step.title}</h3>
            <p className="mt-4 max-w-[52ch] text-lg leading-relaxed text-ink-2">{step.body}</p>
            <p className="mt-5 inline-block rounded-full bg-wash px-4 py-2 text-sm text-cobalt-deep">{step.detail}</p>
          </motion.div>
        </li>
      ))}
    </ol>
  );
}
