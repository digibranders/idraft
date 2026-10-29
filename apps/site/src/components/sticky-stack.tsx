'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export type StackCard = { title: string; body: string; href: string; image: string; alt: string; cta: string };

/**
 * Cards that pin at the top and stack as the next one arrives: the previous card shrinks and dims, driven by
 * the next card's scroll position. Hierarchy: the product's three parts are read in sequence, each in full.
 * Under reduced motion the cards are plain sections.
 */
export function StickyStack({ cards }: { cards: readonly StackCard[] }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    if (!scope) return;
    const mm = gsap.matchMedia();
    mm.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      const els = gsap.utils.toArray<HTMLElement>('[data-card]', scope);
      const last = els[els.length - 1];
      if (!last) return;
      els.forEach((card, index) => {
        const next = els[index + 1];
        if (!next) return;
        ScrollTrigger.create({ trigger: card, start: 'top top+=96', endTrigger: last, end: 'top top+=96', pin: true, pinSpacing: false });
        gsap.to(card, { scale: 0.93, opacity: 0.5, ease: 'none', scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top+=96', scrub: true } });
      });
    }, scope);
    return () => mm.revert();
  }, []);

  return (
    <div ref={root} className="mx-auto flex max-w-[1320px] flex-col gap-6 px-5 md:px-8 lg:gap-24">
      {cards.map((card) => (
        <article key={card.title} data-card className="grid origin-top overflow-hidden rounded-[2.5rem] bg-surface shadow-lift ring-1 ring-ink/[0.07] lg:min-h-[34rem] lg:grid-cols-12">
          <div className="flex flex-col justify-between gap-12 p-8 sm:p-12 lg:col-span-5">
            <div>
              <h2 className="text-[clamp(2rem,3.4vw,3rem)] leading-[1.05] font-semibold tracking-[-0.045em] text-balance">{card.title}</h2>
              <p className="mt-5 max-w-[38ch] text-lg leading-relaxed text-ink-2">{card.body}</p>
            </div>
            <Link href={card.href} className="group inline-flex w-fit items-center gap-3 text-[15px] font-medium text-cobalt-deep">
              {card.cta}
              <span aria-hidden="true" className="transition duration-500 ease-heavy group-hover:translate-x-1">→</span>
            </Link>
          </div>
          <div className="relative min-h-72 lg:col-span-7">
            <Image src={card.image} alt={card.alt} fill sizes="(min-width: 1024px) 58vw, 100vw" className="object-cover" />
          </div>
        </article>
      ))}
    </div>
  );
}
