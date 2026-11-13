'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { CopyButton } from '@/components/app/cells/copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextLink } from '@/components/ui/text-link';
import { webHref } from '@/lib/format';

/** One source of an answer, as the list shows it. Every string is collected text and is only ever shown as text. */
export interface CitationListItem {
  /** The number the provider gave it, which the marker in the text shows. */
  index: number;
  /** What the page calls itself, or its host: shown escaped, with the host beside it (the title is the page's choice). */
  title: string;
  /** The canonical address: the title links to it only when it is an http or https address with no credentials. */
  url: string;
  /** The address as the provider sent it, which a copy puts on the clipboard. */
  rawUrl: string;
  host: string;
  role: 'own' | 'competitor' | 'third_party';
  /** The passage the engine quoted from the page; `null` when it gave none. */
  quote: string | null;
  /** `unresolved_redirect` and `engine_internal` are left out of the counts; any other flag is not drawn. */
  flags: readonly string[];
  /** The answer text has a marker for it, so "Show in answer" has somewhere to go. */
  inAnswer: boolean;
}

export interface CitationListProps {
  items: readonly CitationListItem[];
  /** The item the reader came to from a marker: marked, until another is used. */
  activeIndex?: number | null | undefined;
  /** Takes the reader to the citation's marker in the text. */
  onShowInAnswer: (index: number) => void;
  /** Gives each item the id `citationItemId(idPrefix, index)`, which a marker finds it by. */
  idPrefix: string;
  /** The language of the answer, for its quoted passages. */
  lang?: string | undefined;
  /** Draws a quoted passage in the screen's own box (`QuoteBox`); without it the passage is plain text under the source. */
  renderQuote?: ((quote: string, item: CitationListItem) => ReactNode) | undefined;
}

export const citationItemId = (idPrefix: string, index: number): string => `${idPrefix}-${String(index)}`;

const FLAG_KEYS = { unresolved_redirect: 'unresolvedRedirect', engine_internal: 'engineInternal' } as const;
const isKnownFlag = (flag: string): flag is keyof typeof FLAG_KEYS => flag in FLAG_KEYS;

/**
 * The sources an answer cites, in the provider's order (23-application-patterns.md section 5.4, inventory 15.16): the
 * number, the page's title with its host always beside it, the role as a word, what the engine quoted of it, and a
 * copy of the address the provider sent. A flagged source says why it is left out of the counts. Each item is a place
 * for focus to land (`tabIndex` -1), so a marker in the text can take the reader to it.
 */
export function CitationList({
  items,
  activeIndex,
  onShowInAnswer,
  idPrefix,
  lang,
  renderQuote,
}: CitationListProps): ReactElement {
  const t = useTranslations('evidence.citationList');
  return (
    <ol aria-label={t('label')} data-slot="citation-list" className="flex flex-col gap-1">
      {items.map((item) => {
        const href = webHref(item.url);
        const active = item.index === activeIndex;
        return (
          <li
            key={item.index}
            id={citationItemId(idPrefix, item.index)}
            tabIndex={-1}
            aria-current={active ? 'true' : undefined}
            data-active={active ? '' : undefined}
            className="group group/cell flex flex-col gap-1 rounded-md px-2 py-2 focus-visible:focus-ring data-active:bg-surface-selected"
          >
            <div className="flex items-start gap-2">
              <span className="w-6 shrink-0 num type-meta">{item.index}</span>
              <span className="flex min-w-0 flex-1 flex-col wrap-anywhere">
                {/* The canonical address, never the raw one the provider sent */}
                {href === null ? (
                  <span className="type-body">{item.title}</span>
                ) : (
                  <TextLink href={href} target="_blank" rel="noopener noreferrer">
                    {item.title}
                  </TextLink>
                )}
                <span className="truncate type-meta">{item.host}</span>
              </span>
              {item.role === 'own' ? (
                <Badge tone="info">{t('roles.own')}</Badge>
              ) : item.role === 'competitor' ? (
                <Badge variant="outline">{t('roles.competitor')}</Badge>
              ) : (
                <Badge>{t('roles.thirdParty')}</Badge>
              )}
            </div>
            {item.quote === null ? null : (
              <div className="ps-8">
                {renderQuote === undefined ? (
                  <p lang={lang} className="type-meta wrap-anywhere whitespace-pre-wrap">
                    <span className="sr-only">{t('quoteLead')} </span>
                    {item.quote}
                  </p>
                ) : (
                  renderQuote(item.quote, item)
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1 ps-8">
              {item.flags.filter(isKnownFlag).map((flag) => (
                // The reason is written out, not left to a tooltip: a glyph that cannot take focus tells the keyboard nothing
                <span key={flag} className="inline-flex items-center gap-1 type-meta text-warning-text">
                  <Icon icon={TriangleAlert} size="sm" />
                  {t(`flags.${FLAG_KEYS[flag]}`)}
                </span>
              ))}
              <CopyButton
                text={item.rawUrl}
                label={t('copy', { index: item.index })}
                announcement={t('copied', { index: item.index })}
                placement="inline"
                inGrid={false}
              />
              {item.inAnswer ? (
                <Button
                  variant="link"
                  size="sm"
                  aria-label={t('showInAnswerNamed', { index: item.index })}
                  onClick={() => onShowInAnswer(item.index)}
                >
                  {t('showInAnswer')}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
