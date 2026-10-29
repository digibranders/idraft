'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * The hero frame lets go of the viewport as you scroll: it shrinks, its corners round, and the page takes over.
 * State transition: the first screen becomes a picture on the page instead of the whole page.
 */
export function HeroFrame({ children }: { children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(el, {
        scale: 0.9,
        borderRadius: '4.5rem',
        y: 30,
        ease: 'none',
        transformOrigin: '50% 0%',
        scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: true },
      });
    });
    return () => mm.revert();
  }, []);

  return (
    <div ref={frame} className="relative isolate flex min-h-[calc(100dvh-1.5rem)] items-center overflow-hidden rounded-[2.5rem] will-change-transform">
      {children}
    </div>
  );
}
