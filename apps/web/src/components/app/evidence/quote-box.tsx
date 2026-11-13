'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { TextLink } from '@/components/ui/text-link';
import { webHref } from '@/lib/format';

export interface QuoteBoxProps {
  /** A passage from a collected answer or a cited page: shown as React text, never as markup. */
  text: string;
  /** Where it comes from. The label is text; it links only when `href` is an http or https address with no credentials. */
  source?: { label: string; href?: string | undefined } | null | undefined;
  /** BCP 47 code when the passage is not in English. */
  lang?: string | undefined;
}

/**
 * A short excerpt shown as evidence (inventory 15.26, 23-application-patterns.md section 4.4): a quiet well with the
 * passage in typographic quotes and, below it, its source as `cite` text. Long text wraps and is never clamped. The
 * passage comes from the outside world (a provider's snippet, a page), so it is only ever a text child.
 */
export function QuoteBox({ text, source, lang }: QuoteBoxProps): ReactElement {
  const t = useTranslations('evidence.quoteBox');
  const href = source?.href === undefined ? null : webHref(source.href);
  return (
    <blockquote
      data-slot="quote-box"
      lang={lang}
      className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-subtle p-3 wrap-anywhere whitespace-pre-wrap"
    >
      <span className="type-meta text-foreground-secondary">{t('quoted', { text })}</span>
      {source === null || source === undefined ? null : (
        <cite className="type-meta whitespace-normal not-italic">
          {href === null ? (
            source.label
          ) : (
            <TextLink href={href} target="_blank" rel="noopener noreferrer" tone="inherit" variant="inline">
              {source.label}
            </TextLink>
          )}
        </cite>
      )}
    </blockquote>
  );
}
