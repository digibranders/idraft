'use client';

import { useRef } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';

/*
 * The glass staircase leans toward the cursor (depth) and drifts up as the page scrolls (the climb).
 * Pointer values live in motion values, so no React render runs while the cursor moves.
 */
export function HeroVisual() {
  const reduce = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [5, -5]), { stiffness: 120, damping: 20 });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-7, 7]), { stiffness: 120, damping: 20 });
  const { scrollYProgress } = useScroll({ target: frame, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -70]);

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduce || !frame.current) return;
    const rect = frame.current.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width - 0.5);
    py.set((event.clientY - rect.top) / rect.height - 0.5);
  };
  const onLeave = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <div ref={frame} onPointerMove={onMove} onPointerLeave={onLeave} className="rise [perspective:1400px]" style={{ '--i': 1 } as React.CSSProperties}>
      <motion.div style={reduce ? {} : { rotateX, rotateY, y }} className="rounded-[2rem] bg-ink/[0.04] p-1.5 shadow-lift ring-1 ring-ink/[0.06]">
        <div className="relative aspect-[3/2] overflow-hidden rounded-[calc(2rem-0.375rem)]">
          <Image
            src="/images/hero.png"
            alt="Five frosted glass steps in cobalt blue rising from left to right, the top step glowing."
            fill
            priority
            sizes="(min-width: 1024px) 58vw, 100vw"
            className="object-cover"
          />
        </div>
      </motion.div>
    </div>
  );
}
