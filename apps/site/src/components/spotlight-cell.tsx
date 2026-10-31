'use client';

import { motion, useMotionTemplate, useMotionValue, useReducedMotion } from 'motion/react';

type SpotlightCellProps = {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
};

/**
 * A double-bezel card whose surface catches a soft cobalt light under the cursor. Feedback: it tells the
 * reader which card they are on. The light follows the pointer through motion values, outside React renders.
 */
export function SpotlightCell({ children, className = '', innerClassName = 'bg-surface' }: SpotlightCellProps) {
  const reduce = useReducedMotion();
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const light = useMotionTemplate`radial-gradient(380px circle at ${x}px ${y}px, rgb(30 101 227 / 0.13), transparent 70%)`;

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  };

  return (
    <div onPointerMove={onMove} className={`rounded-[2rem] ring-1 ring-ink/[0.08] ${className}`}>
      <div className={`relative h-full overflow-hidden rounded-[2rem] ${innerClassName}`}>
        {children}
        <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: light }} />
      </div>
    </div>
  );
}
