'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';

const START = 14;
const W = 96;
const H = 34;
// Eased so the first scroll moves you up fast and the last places feel earned.
const ease = (p: number) => 1 - (1 - p) ** 1.7;
const rankAt = (p: number) => START - (START - 1) * ease(p);
const xAt = (p: number) => 5 + p * (W - 10);
const yAt = (p: number) => 5 + ((rankAt(p) - 1) / (START - 1)) * (H - 10);
const PATH = Array.from({ length: 41 }, (_, i) => i / 40)
  .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(p).toFixed(1)} ${yAt(p).toFixed(1)}`)
  .join(' ');

/**
 * The reader climbs. A small chip in the corner shows a rank that counts down from #14 to #1 as you scroll the
 * page, with a line that draws the climb. At the last section it becomes #1. It is the product's own idea, rank
 * and movement, used as the page's progress: feedback that tells you how far you are. Home page only, desktop only.
 */
export function ScrollRail() {
  const pathname = usePathname();
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, { stiffness: 110, damping: 26 });
  const [rank, setRank] = useState(START);
  const [section, setSection] = useState('');
  const [hasRail, setHasRail] = useState(false);

  useMotionValueEvent(smooth, 'change', (p) => setRank(Math.max(1, Math.round(rankAt(Math.min(1, Math.max(0, p)))))));
  const dotX = useTransform(smooth, (p) => xAt(Math.min(1, Math.max(0, p))));
  const dotY = useTransform(smooth, (p) => yAt(Math.min(1, Math.max(0, p))));

  // Pages that mark sections (data-rail) get the chip; the section name follows the reader.
  useEffect(() => {
    let observer: IntersectionObserver | undefined;
    const frame = requestAnimationFrame(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('[data-rail]'));
      setHasRail(els.length >= 3);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) if (entry.isIntersecting) setSection((entry.target as HTMLElement).dataset.rail ?? '');
        },
        { rootMargin: '-45% 0px -50% 0px' },
      );
      els.forEach((el) => observer?.observe(el));
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [pathname]);

  if (!hasRail) return null;
  const top = rank === 1;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed right-6 bottom-6 z-20 hidden lg:block">
      <div className={`flex items-center gap-3 rounded-full py-2 pr-4 pl-2 shadow-[0_24px_60px_-24px_rgb(20_23_28/0.4)] ring-1 backdrop-blur-xl transition-colors duration-500 ease-heavy ${top ? 'bg-cobalt text-white ring-white/30' : 'bg-surface/80 text-ink ring-ink/[0.08]'}`}>
        <div className={`grid h-10 min-w-[3.5rem] place-items-center overflow-hidden rounded-full px-3 font-mono text-lg font-semibold tracking-[-0.04em] ${top ? 'bg-white/15' : 'bg-wash text-cobalt-deep'}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={rank} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -16, opacity: 0 }} transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}>
              #{rank}
            </motion.span>
          </AnimatePresence>
        </div>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
          <path d={PATH} fill="none" stroke={top ? '#fff' : '#14171C'} strokeOpacity="0.12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <motion.path d={PATH} fill="none" stroke={top ? '#fff' : '#1E65E3'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: smooth }} />
          <motion.circle r="4" fill={top ? '#fff' : '#1E65E3'} style={{ cx: dotX, cy: dotY }} />
        </svg>
        <div className="w-24 text-[11px] leading-tight">
          <p className={top ? 'text-white/70' : 'text-ink-3'}>{top ? 'You made it' : 'Reading'}</p>
          <p className="truncate font-semibold">{top ? 'to #1' : section || 'idraft'}</p>
        </div>
      </div>
    </div>
  );
}
