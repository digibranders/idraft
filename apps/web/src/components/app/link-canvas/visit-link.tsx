'use client';

import { ExternalLink } from 'lucide-react';
import type { PointerEvent, ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { buttonVariants } from '@/components/ui/button-variants';
import { Tooltip } from '@/components/ui/tooltip';
import { webHref } from '@/lib/format/url';

/** The live address of a page: the site's host and the page's path, or `null` when that is no web address. */
export function pageHref(host: string, path: string): string | null {
  return host === '' || !path.startsWith('/') ? null : webHref(`https://${host}${path}`);
}

export interface VisitLinkProps {
  href: string;
  /** The accessible name: "Visit /pricing in a new tab". */
  label: string;
  /** Set on the card tool: it joins the card's Tab order only when the card is the canvas's tab stop. */
  tabIndex?: number | undefined;
  /** In the info panel the link carries this word beside the icon; on a card it is the icon alone. */
  text?: string | undefined;
}

const stop = (event: PointerEvent): void => event.stopPropagation();

/** A real link to the live page in a new tab. A press on it never selects, moves or opens the card behind it. */
export function VisitLink({ href, label, tabIndex, text }: VisitLinkProps): ReactElement {
  const link = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      tabIndex={tabIndex}
      onPointerDown={stop}
      onClick={(event) => event.stopPropagation()}
      className={buttonVariants({ variant: 'secondary', size: text === undefined ? 'icon-xs' : 'sm' })}
    >
      <Icon icon={ExternalLink} size={text === undefined ? 'sm' : 'default'} />
      {text}
    </a>
  );
  return text === undefined ? (
    <Tooltip content={label} purpose="label" side="top">
      {link}
    </Tooltip>
  ) : (
    link
  );
}
