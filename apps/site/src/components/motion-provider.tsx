'use client';

import { MotionConfig } from 'motion/react';

/** One switch for reduced motion: movement is turned off for readers who ask for it, with no per-component branching. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
