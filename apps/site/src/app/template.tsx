'use client';

import { motion } from 'motion/react';

/** A route change fades the new page up. Hierarchy: the page arrives as one piece, not in flashes. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}
