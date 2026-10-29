'use client';

import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';

function Word({ word, range, progress, reduce }: { word: string; range: [number, number]; progress: MotionValue<number>; reduce: boolean }) {
  const opacity = useTransform(progress, range, [0.14, 1]);
  return (
    <motion.span style={reduce ? {} : { opacity }} className="mr-[0.26em] inline-block">
      {word}
    </motion.span>
  );
}

/**
 * A statement whose words darken one by one as the section scrolls through the viewport. Storytelling: the
 * reader sets the reading pace with the scroll, so the claim lands one phrase at a time.
 */
export function TextReveal({ text }: { text: string }) {
  const reduce = useReducedMotion() ?? false;
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] });
  const words = text.split(' ');
  return (
    <p ref={ref} className="text-[clamp(1.9rem,4.2vw,3.8rem)] leading-[1.12] font-semibold tracking-[-0.045em] text-ink">
      {words.map((word, index) => {
        const start = index / words.length;
        const end = start + 1 / words.length;
        return <Word key={`${word}-${index}`} word={word} range={[start, end]} progress={scrollYProgress} reduce={reduce} />;
      })}
    </p>
  );
}
