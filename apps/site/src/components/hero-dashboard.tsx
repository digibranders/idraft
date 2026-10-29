'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { Dashboard } from './mock/dashboard';

gsap.registerPlugin(ScrollTrigger);

/**
 * The product starts tilted back and rises flat as the page scrolls, so the first thing you scroll into is the
 * product itself. State transition: from a picture of an app to the app, ready to use.
 */
export function HeroDashboard() {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(
        el,
        { rotateX: 16, scale: 0.9, y: 40, transformPerspective: 1600, transformOrigin: '50% 0%' },
        { rotateX: 0, scale: 1, y: 0, ease: 'none', scrollTrigger: { trigger: el, start: 'top 92%', end: 'top 28%', scrub: 0.6 } },
      );
    });
    return () => mm.revert();
  }, []);

  return (
    <div ref={frame} className="will-change-transform">
      <Dashboard />
    </div>
  );
}
