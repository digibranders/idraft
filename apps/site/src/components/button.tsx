'use client';

import Link from 'next/link';
import { ArrowUpRight } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

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
 * One opaque gradient paints both background colors. The alternate foreground follows the same animated
 * radius, so its text and arrow change with the wipe without a second rounded background bleeding at the edge.
 */
const TONES: Record<Variant, { rest: string; restDisc: string; fill: string; fillDisc: string }> = {
  primary: { rest: 'text-white shadow-[0_14px_30px_-14px_rgb(30_101_227/0.7)]', restDisc: 'bg-white/15', fill: 'text-white', fillDisc: 'bg-white/15' },
  // The secondary only tints toward cobalt, so it never looks like the primary action.
  secondary: { rest: 'text-ink ring-1 ring-ink/10', restDisc: 'bg-ink/5', fill: 'text-cobalt-deep', fillDisc: 'bg-cobalt/10' },
  // On a cobalt panel: a white pill, so the action stays the strongest thing in view.
  light: { rest: 'text-ink', restDisc: 'bg-cobalt text-white', fill: 'text-white', fillDisc: 'bg-white/15' },
};

/** Remembers where the pointer crossed the edge on the way in. Not updated on the way out. */
function markEntry(event: React.PointerEvent<HTMLElement>): void {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--x', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--y', `${event.clientY - rect.top}px`);
}

export function Button({ href, children, variant = 'primary', compact = false }: ButtonProps): ReactElement {
  const tone = TONES[variant];
  const layout = compact ? 'px-5 py-2.5 text-sm' : 'gap-3 py-2 pl-6 pr-2';
  const className = `button-wipe group relative inline-flex items-center overflow-hidden rounded-full text-[15px] font-medium whitespace-nowrap hover:-translate-y-px active:translate-y-0 active:scale-[0.98] motion-reduce:hover:translate-y-0 ${tone.rest}`;

  const arrow = (disc: string): ReactElement | null =>
    compact ? null : (
      <span className={`grid size-9 place-items-center rounded-full ${disc}`}>
        <ArrowUpRight size={16} weight="bold" aria-hidden="true" className="transition-transform duration-300 ease-out group-hover:rotate-45 motion-reduce:transition-none" />
      </span>
    );

  const content = (
    <>
      <span className={`button-wipe-rest inline-flex items-center ${layout}`}>
        {children}
        {arrow(tone.restDisc)}
      </span>
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 inline-flex items-center [clip-path:circle(var(--button-wipe-radius)_at_var(--x,50%)_var(--y,50%))] ${tone.fill} ${layout}`}
      >
        {children}
        {arrow(tone.fillDisc)}
      </span>
    </>
  );

  if (!href) {
    return (
      <button type="submit" data-variant={variant} onPointerEnter={markEntry} className={className}>
        {content}
      </button>
    );
  }
  return href.startsWith('/') ? (
    <Link href={href} data-variant={variant} onPointerEnter={markEntry} className={className}>
      {content}
    </Link>
  ) : (
    <a href={href} data-variant={variant} onPointerEnter={markEntry} className={className}>
      {content}
    </a>
  );
}
