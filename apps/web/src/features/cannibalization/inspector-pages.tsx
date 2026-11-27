'use client';

import { ExternalLink, Layers, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { PageRef } from './cann-evidence';
import { PageMark } from './cann-parts';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { KeyValues } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { formatInteger, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

const KEY = { share: 'share', ranking: 'ranking', median: 'median', best: 'best' } as const;

/** Only a web address opens: a stored address of another kind is shown as text. */
const isWebAddress = (url: string): boolean => /^https?:\/\//i.test(url);

/** Pages (docs/33 section 7.2): each of your pages for the keyword, with its badges, its address and its numbers. */
export function InspectorPages({ pages }: { pages: readonly PageRef[] }): ReactElement {
  const t = useTranslations('cannibalization.inspector.pages');
  const popover = useTranslations('cannibalization.popover');
  const cells = useTranslations('cannibalization.cells');
  const unknown = useTranslations('cannibalization.unknown');
  const ranked = pages.filter((page) => page.ranked > 0);
  return (
    <InspectorSection
      title={t('title')}
      icon={Layers}
      meta={t('meta', { count: ranked.length })}
      flush
      status={ranked.length === 0 ? 'empty' : 'ready'}
      empty={<EmptyState variant="inline" title={t('emptyTitle')} reason={t('emptyReason')} headingLevel={3} />}
    >
      <ul>
        {ranked.map((page) => (
          <li key={page.id} className="flex gap-2 border-t border-border-subtle px-4 py-3 first:border-t-0">
            <PageMark letter={page.letter} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="sr-only">{cells('pageName', { letter: page.letter })}</span>
                  <span className={cn('wrap-anywhere text-foreground', page.isPrimary && 'type-body-strong')}>
                    {page.title ?? page.path}
                  </span>
                  {page.isPrimary ? <Badge>{popover('best')}</Badge> : null}
                  {page.isTarget ? <Badge icon={Target}>{popover('target')}</Badge> : null}
                  {page.isSubResult ? <Badge>{popover('subResult')}</Badge> : null}
                </span>
                {isWebAddress(page.url) ? (
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={popover('openPage', { path: page.path })}
                    className="inline-flex items-start gap-1 self-start rounded-sm type-meta break-all text-link outline-none hover:underline focus-visible:focus-ring"
                  >
                    <span>{page.path}</span>
                    <Icon icon={ExternalLink} size="xs" className="mt-0.5 shrink-0" />
                  </a>
                ) : (
                  <span className="type-meta break-all">{page.path}</span>
                )}
              </div>
              <KeyValues
                items={[
                  {
                    id: KEY.share,
                    label: t('shareLabel'),
                    value: t('share', { share: formatPercent(page.share, { decimals: 0 }) }),
                  },
                  {
                    id: KEY.ranking,
                    label: t('rankingLabel'),
                    value: t('rankingChecks', { count: page.bestCount }),
                  },
                  {
                    id: KEY.median,
                    label: t('medianLabel'),
                    value: page.median === null ? unknown('rank') : formatInteger(page.median),
                  },
                  {
                    id: KEY.best,
                    label: t('bestLabel'),
                    value: page.bestEver === null ? unknown('rank') : formatInteger(page.bestEver),
                  },
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-border-subtle px-4 py-3 type-meta">{t('note')}</p>
    </InspectorSection>
  );
}
