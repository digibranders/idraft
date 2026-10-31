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

/*
 * `rest` is the resting pill. `fill` is a second copy of the whole button (its own background, white text)
 * that is revealed through a circle growing from where the cursor entered. Because the label travels with the
 * fill, every pixel changes color exactly once, at the moment the circle reaches it. The circle shrinks back to
 * the same point on leave, so it never jumps.
 */
const TONES: Record<Variant, { rest: string; restDisc: string; fill: string; fillDisc: string }> = {
  primary: { rest: 'bg-cobalt text-white shadow-[0_14px_30px_-14px_rgb(30_101_227/0.7)]', restDisc: 'bg-white/15', fill: 'bg-ink text-white', fillDisc: 'bg-white/15' },
  // The secondary only tints toward cobalt, so it never looks like the primary action.
  secondary: { rest: 'bg-surface text-ink ring-1 ring-ink/10', restDisc: 'bg-ink/5', fill: 'bg-wash text-cobalt-deep', fillDisc: 'bg-cobalt/10' },
  // On a cobalt panel: a white pill, so the action stays the strongest thing in view.
  light: { rest: 'bg-white text-ink', restDisc: 'bg-cobalt text-white', fill: 'bg-ink text-white', fillDisc: 'bg-white/15' },
};

/** Remembers where the pointer crossed the edge on the way in. Not updated on the way out. */
function markEntry(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--x', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--y', `${event.clientY - rect.top}px`);
}

export function Button({ href, children, variant = 'primary', compact = false }: ButtonProps) {
  const tone = TONES[variant];
  const layout = compact ? 'px-5 py-2.5 text-sm' : 'gap-3 py-2 pl-6 pr-2';
  const className = `group relative inline-flex items-center overflow-hidden rounded-full text-[15px] font-medium whitespace-nowrap transition-transform duration-300 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${tone.rest} ${layout}`;

  const arrow = (disc: string) =>
    compact ? null : (
      <span className={`grid size-9 place-items-center rounded-full ${disc}`}>
        <ArrowUpRight size={16} weight="bold" aria-hidden="true" className="transition-transform duration-300 ease-out group-hover:rotate-45 motion-reduce:transition-none" />
      </span>
    );

  const content = (
    <>
      {children}
      {arrow(tone.restDisc)}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 inline-flex items-center rounded-full transition-[clip-path] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] [clip-path:circle(0px_at_var(--x,50%)_var(--y,50%))] group-hover:[clip-path:circle(15rem_at_var(--x,50%)_var(--y,50%))] motion-reduce:transition-none ${tone.fill} ${layout}`}
      >
        {children}
        {arrow(tone.fillDisc)}
      </span>
    </>
  );

  if (!href) {
    return (
      <button type="submit" onPointerEnter={markEntry} className={className}>
        {content}
      </button>
    );
  }
  return href.startsWith('/') ? (
    <Link href={href} onPointerEnter={markEntry} className={className}>
      {content}
    </Link>
  ) : (
    <a href={href} onPointerEnter={markEntry} className={className}>
      {content}
    </a>
  );
}
