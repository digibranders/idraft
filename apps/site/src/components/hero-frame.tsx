'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * A camera move, not a shrinking box. The hero pins and, as you scroll, the product swings from its tilted
 * three-quarter view to face you: it slides to the center, turns flat and grows, while the headline slides away
 * and fades. Storytelling: from "here is a product" to "here it is, up close". Elements opt in with
 * data-hero-image (the mover), data-hero-tilt (the part that turns) and data-hero-line (each line of copy).
 */
export function HeroFrame({ children }: { children: React.ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = section.current;
    const root = stage.current;
    if (!scope || !root) return;
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const mover = root.querySelector('[data-hero-image]');
      const tilt = root.querySelector('[data-hero-tilt]');
      const lines = gsap.utils.toArray<HTMLElement>('[data-hero-line]', root);
      const wash = root.querySelector('[data-hero-wash]');
      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: scope, start: 'top top', end: '+=160%', pin: true, scrub: 0.8, anticipatePin: 1 },
      });
      // The picture starts moving at once and keeps going the whole way: slide to center, turn flat, grow.
      if (mover) timeline.to(mover, { x: '-37vw', y: '4vh', scale: 1.32, duration: 1, ease: 'power2.inOut' }, 0);
      if (tilt) timeline.to(tilt, { rotateY: 0, rotateX: 0, rotateZ: 0, duration: 0.8, ease: 'power2.inOut' }, 0);
      // The words stay on top of the picture while it travels, then dissolve one line at a time, top to bottom:
      // lift, blur and fade, so the scene is revealed from behind its own headline.
      if (lines.length) timeline.to(lines, { opacity: 0, yPercent: -30, filter: 'blur(14px)', duration: 0.4, stagger: 0.14, ease: 'power1.in' }, 0.38);
      // The paper wash keeps the words legible early on, then lets the whole picture show.
      if (wash) timeline.to(wash, { opacity: 0, duration: 0.4 }, 0.3);
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={section} className="relative bg-paper">
      <div ref={stage} className="relative isolate flex h-[100dvh] items-center overflow-hidden">
        {children}
      </div>
    </section>
  );
}
