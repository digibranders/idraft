'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, useScroll, useSpring } from 'motion/react';

type RailItem = { label: string; el: HTMLElement };

/**
 * A section rail on the right edge. Each marked section on the page (data-rail="Label") gets a stop; the line
 * fills as you scroll, the current stop grows into a labeled chip, and a click goes there. Hierarchy: it tells
 * you where you are in the page and what is left. Pages with fewer than three marked sections show no rail.
 */
export function ScrollRail() {
  const pathname = usePathname();
  const [items, setItems] = useState<RailItem[]>([]);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll();
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 28 });

  // Read the marked sections once the page has rendered; state is set from a callback, not the effect body.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const found = Array.from(document.querySelectorAll<HTMLElement>('[data-rail]')).map((el) => ({ label: el.dataset.rail ?? '', el }));
      setItems(found);
      setActive(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  useEffect(() => {
    if (items.length < 3) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = items.findIndex((item) => item.el === entry.target);
          if (index >= 0) setActive(index);
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    items.forEach((item) => observer.observe(item.el));
    return () => observer.disconnect();
  }, [items]);

  if (items.length < 3) return null;

  return (
    <nav aria-label="Page sections" className="fixed top-1/2 right-5 z-20 hidden -translate-y-1/2 lg:block">
      <div className="relative rounded-full bg-surface/70 px-2.5 py-4 shadow-[0_18px_50px_-24px_rgb(20_23_28/0.3)] ring-1 ring-ink/[0.07] backdrop-blur-xl">
        <span aria-hidden="true" className="absolute top-4 bottom-4 left-1/2 w-px -translate-x-1/2 bg-ink/10" />
        <motion.span aria-hidden="true" style={{ scaleY: fill }} className="absolute top-4 bottom-4 left-1/2 w-px origin-top -translate-x-1/2 bg-cobalt" />
        <ul className="relative flex flex-col items-center gap-5">
          {items.map((item, index) => {
            const current = index === active;
            const passed = index < active;
            return (
              <li key={item.label} className="relative">
                <button
                  type="button"
                  onClick={() => item.el.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  aria-label={item.label}
                  aria-current={current ? 'true' : undefined}
                  className="group relative grid size-4 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
                >
                  <span className={`block rounded-full transition-all duration-500 ease-heavy ${current ? 'size-3 bg-cobalt ring-4 ring-cobalt/20' : passed ? 'size-2 bg-cobalt/60' : 'size-2 bg-surface ring-1 ring-ink/25 group-hover:ring-ink/50'}`} />
                  <span
                    className={`pointer-events-none absolute right-8 rounded-full bg-ink px-3 py-1 text-xs font-medium whitespace-nowrap text-white transition-all duration-300 ease-heavy ${current ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100'}`}
                  >
                    {item.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
