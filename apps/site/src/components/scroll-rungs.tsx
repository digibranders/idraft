'use client';

import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react';

const RUNGS = 6;

function Rung({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const lit = useTransform(progress, [index / RUNGS, (index + 0.6) / RUNGS], [0, 1]);
  return (
    <span className="relative block h-1.5 rounded-full bg-ink/10" style={{ width: 12 + index * 6 }}>
      <motion.span className="absolute inset-0 origin-right rounded-full bg-cobalt" style={{ scaleX: lit }} />
    </span>
  );
}

/**
 * The reader's place on the page, drawn as the brand's staircase: each rung lights as that part of the page
 * is passed. A signature rather than a progress bar; it is hidden below 1024px and under reduced motion.
 */
export function ScrollRungs() {
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28 });
  return (
    <div aria-hidden="true" className="pointer-events-none fixed top-1/2 right-5 z-20 hidden -translate-y-1/2 flex-col items-end gap-2 motion-reduce:!hidden lg:flex">
      {Array.from({ length: RUNGS }, (_, index) => RUNGS - 1 - index).map((index) => (
        <Rung key={index} index={index} progress={progress} />
      ))}
    </div>
  );
}
