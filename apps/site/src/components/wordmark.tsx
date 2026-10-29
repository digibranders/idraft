'use client';

import { useRef } from 'react';
import { motion, useInView, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';

const LETTERS = ['i', 'd', 'r', 'a', 'f', 't'] as const;

type LetterProps = { char: string; pointerX: MotionValue<number>; index: number; shown: boolean };

function Letter({ char, pointerX, index, shown }: LetterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // The letter nearest the cursor rises the most, like a step being climbed.
  const lift = useTransform(pointerX, (x) => {
    const el = ref.current;
    // Read at pointer time (client only), so server and client render the same markup.
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
    const rect = el.getBoundingClientRect();
    const d = (x - (rect.left + rect.width / 2)) / rect.width;
    return -Math.exp(-(d * d) / 0.9) * rect.height * 0.14;
  });
  const y = useSpring(lift, { stiffness: 170, damping: 16 });

  return (
    <span className="inline-block overflow-hidden pt-[0.18em]">
      <motion.span
        initial={{ y: '115%' }}
        animate={{ y: shown ? '0%' : '115%' }}
        transition={{ duration: 1, delay: index * 0.07, ease: [0.32, 0.72, 0, 1] }}
        className="inline-block"
      >
        <motion.span ref={ref} style={{ y }} className="inline-block">
          {char}
        </motion.span>
      </motion.span>
    </span>
  );
}

/**
 * The footer wordmark: letters rise into place once, then lift toward the cursor. The reveal watches the
 * unclipped wrapper, because a letter hidden inside its own mask would never count as visible.
 */
export function Wordmark() {
  const wrapper = useRef<HTMLDivElement>(null);
  const shown = useInView(wrapper, { once: true, amount: 0.4 });
  const pointerX = useMotionValue(-9999);
  return (
    <div
      ref={wrapper}
      aria-hidden="true"
      onPointerMove={(event) => pointerX.set(event.clientX)}
      onPointerLeave={() => pointerX.set(-9999)}
      className="flex select-none justify-center text-[clamp(6rem,27vw,26rem)] leading-[0.82] font-semibold tracking-[-0.06em] text-cobalt"
    >
      {LETTERS.map((char, index) => (
        <Letter key={char + index} char={char} pointerX={pointerX} index={index} shown={shown} />
      ))}
    </div>
  );
}
