'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * The first screen is full-bleed, with no container at all. As you scroll, the hero pins and the whole picture
 * pulls back into a rounded card: it shrinks, its corners round, the image settles from a slow zoom and the
 * copy lifts away. State transition: the opening scene becomes an object on the page, then the page continues.
 * Elements opt in with data-hero-image and data-hero-copy.
 */
export function HeroFrame({ children }: { children: React.ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = section.current;
    const card = frame.current;
    if (!scope || !card) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const image = card.querySelector('[data-hero-image]');
      const copy = card.querySelector('[data-hero-copy]');
      const timeline = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: scope, start: 'top top', end: '+=85%', pin: true, scrub: 0.7, anticipatePin: 1 },
      });
      timeline.to(card, { scale: 0.84, borderRadius: '3.5rem', boxShadow: '0 60px 120px -50px rgba(20,23,28,0.45)' }, 0);
      if (image) timeline.fromTo(image, { scale: 1.16 }, { scale: 1 }, 0);
      if (copy) timeline.to(copy, { y: -60, opacity: 0, ease: 'power1.in' }, 0.35);
    });
    return () => mm.revert();
  }, []);

  return (
    <section ref={section} className="relative bg-paper">
      <div ref={frame} className="relative isolate flex h-[100dvh] items-center overflow-hidden will-change-transform">
        {children}
      </div>
    </section>
  );
}
