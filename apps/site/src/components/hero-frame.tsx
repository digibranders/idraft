'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * A camera move, not a shrinking box. The hero pins and, as you scroll, the product swings from its tilted
 * three-quarter view to face you: it slides to the center, turns flat and grows, while the headline slides away
 * and fades. Storytelling: from "here is a product" to "here it is, up close". Elements opt in with
 * data-hero-image (the mover), data-hero-tilt (the part that turns) and data-hero-copy.
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
      const copy = root.querySelector('[data-hero-copy]');
      const wash = root.querySelector('[data-hero-wash]');
      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: scope, start: 'top top', end: '+=100%', pin: true, scrub: 0.6, anticipatePin: 1 },
      });
      if (mover) timeline.to(mover, { x: '-35vw', y: '7vh', scale: 1.02 }, 0);
      if (tilt) timeline.to(tilt, { rotateY: 0, rotateX: 0, rotateZ: 0 }, 0);
      if (copy) timeline.to(copy, { x: -80, opacity: 0, ease: 'power2.out' }, 0);
      if (wash) timeline.to(wash, { opacity: 0 }, 0.1);
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
