'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { QuoteBox } from './quote-box';

/** One citation, as the quoted passage section needs it. Every string is collected text. */
export interface QuotedPassageItem {
  /** The number the provider gave the source. */
  index: number;
  host: string;
  /** The canonical address: the host links to it only when it is an http or https address with no credentials. */
  url: string;
  /** What the engine quoted from the page; `null` or empty when it gave none. */
  quote: string | null;
}

export interface QuotedPassageProps {
  items: readonly QuotedPassageItem[];
  /** The language of the answer, for its passages. */
  lang?: string | undefined;
}

/**
 * What the engine quoted from its sources (WB-SRC-04): one `QuoteBox` for each citation that has a passage, with its
 * host as the source line. Nothing is drawn when no citation has one, since an engine that quotes none (ChatGPT) has
 * nothing to show and an empty section would only suggest something is missing.
 */
export function QuotedPassage({ items, lang }: QuotedPassageProps): ReactElement | null {
  const t = useTranslations('evidence.quotedPassage');
  const quoted = items.filter((item) => item.quote !== null && item.quote !== '');
  if (quoted.length === 0) return null;
  return (
    <ul aria-label={t('label')} data-slot="quoted-passage" className="flex flex-col gap-2">
      {quoted.map((item) => (
        <li key={item.index}>
          <QuoteBox text={item.quote ?? ''} lang={lang} source={{ label: item.host, href: item.url }} />
        </li>
      ))}
    </ul>
  );
}
