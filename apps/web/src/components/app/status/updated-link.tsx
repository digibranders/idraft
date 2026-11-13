'use client';

import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { TextLink } from '@/components/ui/text-link';

export interface UpdatedLinkProps {
  /** "Updated 5m ago": the words a page already shows, unchanged. */
  text: string;
  /** The Runs page with the run that collected the answers open; `null` leaves the text as it is. */
  href: Route | null;
}

/**
 * The "Updated" text of an AI page (WP-30 decision D14), a link to the run behind it when the page has one.
 * Plain text is the same words and nothing else, so a page with nothing to link looks as it did before.
 */
export function UpdatedLink({ text, href }: UpdatedLinkProps): ReactElement {
  const t = useTranslations('runs');
  if (href === null) return <>{text}</>;
  return (
    <TextLink
      render={<Link href={href} />}
      tone="inherit"
      aria-label={t('updatedLink', { updated: text })}
      // A box of at least 24 px, which an inline anchor's line height does not guarantee (WCAG 2.5.8)
      className="inline-flex min-h-6 items-center"
    >
      {text}
    </TextLink>
  );
}
