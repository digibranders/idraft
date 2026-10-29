'use client';

import Link from 'next/link';
import { ArrowUpRight } from '@phosphor-icons/react';

type Variant = 'primary' | 'secondary' | 'light';

type ButtonProps = {
  /** An internal path, an external URL or a mailto link. Leave out for a form submit button. */
  href?: string;
  children: React.ReactNode;
  variant?: Variant;
  /** A smaller pill without the arrow, for the nav. */
  compact?: boolean;
};

// base: the resting look. fill: the color that grows from the cursor. The hover label is always white, because
// every fill is dark enough for it; it arrives on the rolled-in copy, so text never sits half-way between colors.
const TONES: Record<Variant, { base: string; fill: string; disc: string }> = {
  primary: { base: 'bg-cobalt text-white shadow-[0_14px_30px_-14px_rgb(30_101_227/0.7)]', fill: 'bg-ink', disc: 'bg-white/15 group-hover:bg-white group-hover:text-ink' },
  secondary: { base: 'bg-surface text-ink ring-1 ring-ink/10', fill: 'bg-cobalt', disc: 'bg-ink/5 group-hover:bg-white/20 group-hover:text-white' },
  // On a cobalt panel: a white pill, filled with ink so the action stays the strongest thing in view.
  light: { base: 'bg-white text-ink', fill: 'bg-ink', disc: 'bg-cobalt text-white group-hover:bg-white group-hover:text-ink' },
};

/** Writes where the pointer crossed the edge, so the fill grows from, and shrinks toward, that exact point. */
function trackPointer(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--x', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--y', `${event.clientY - rect.top}px`);
}

/**
 * The call to action. On hover a circle of the fill color grows from the cursor's entry point, the label rolls
 * up into a copy of itself, and the arrow slides out and back in. Feedback: the button answers where you touched it.
 */
export function Button({ href, children, variant = 'primary', compact = false }: ButtonProps) {
  const tone = TONES[variant];
  const className = `group relative isolate inline-flex items-center overflow-hidden rounded-full text-[15px] font-medium whitespace-nowrap transition-transform duration-500 ease-heavy active:scale-[0.98] motion-reduce:transition-none ${tone.base} ${compact ? 'px-5 py-2.5 text-sm' : 'gap-3 py-2 pl-6 pr-2'}`;

  const content = (
    <>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-[var(--y,50%)] left-[var(--x,50%)] -z-10 size-[44rem] -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full transition-transform duration-[850ms] ease-fill group-hover:scale-100 motion-reduce:transition-none ${tone.fill}`}
      />
      <span className="relative block overflow-hidden leading-[1.45]">
        <span className="block transition-transform duration-500 ease-heavy group-hover:-translate-y-full group-hover:delay-100 motion-reduce:transition-none">{children}</span>
        <span aria-hidden="true" className="absolute inset-0 block translate-y-full text-white transition-transform duration-500 ease-heavy group-hover:translate-y-0 group-hover:delay-100 motion-reduce:transition-none">
          {children}
        </span>
      </span>
      {compact ? null : (
        <span className={`relative grid size-9 place-items-center overflow-hidden rounded-full transition-colors duration-500 ease-heavy ${tone.disc}`}>
          <ArrowUpRight size={16} weight="bold" aria-hidden="true" className="transition-transform duration-500 ease-heavy group-hover:translate-x-6 group-hover:-translate-y-6 motion-reduce:transition-none" />
          <ArrowUpRight size={16} weight="bold" aria-hidden="true" className="absolute -translate-x-6 translate-y-6 transition-transform duration-500 ease-heavy group-hover:translate-x-0 group-hover:translate-y-0 group-hover:delay-100 motion-reduce:transition-none" />
        </span>
      )}
    </>
  );

  if (!href) {
    return (
      <button type="submit" onPointerEnter={trackPointer} onPointerLeave={trackPointer} className={className}>
        {content}
      </button>
    );
  }
  return href.startsWith('/') ? (
    <Link href={href} onPointerEnter={trackPointer} onPointerLeave={trackPointer} className={className}>
      {content}
    </Link>
  ) : (
    <a href={href} onPointerEnter={trackPointer} onPointerLeave={trackPointer} className={className}>
      {content}
    </a>
  );
}
