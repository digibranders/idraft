'use client';

import { motion, useReducedMotion } from 'motion/react';

type RevealProps = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
};

/** A heavy fade up as a block enters the viewport. Sequence: blocks arrive in reading order. */
export function Reveal({ children, className, delay = 0 }: RevealProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 40, filter: 'blur(10px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.9, delay, ease: [0.32, 0.72, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}
