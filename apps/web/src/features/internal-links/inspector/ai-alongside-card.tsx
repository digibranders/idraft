'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { DomainChip } from '@/components/app/cells/domain-chip';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { displayDomain, displayUrl, formatInteger } from '@/lib/format';
import type { PageAi } from '@/lib/internal-links/types';
import { alongsideKind } from '@/lib/pages/ai-model';

export interface AiAlongsideCardProps {
  ai: PageAi;
  /** Opens another own in-crawl page inside the page drawer. */
  onOpenPage: (urlId: string) => void;
}

const HEADER_CLASS = 'py-1 type-table-header whitespace-nowrap';

/** Other URLs cited in the same AI answers as the open page. */
export function AiAlongsideCard({ ai, onOpenPage }: AiAlongsideCardProps): ReactElement {
  const t = useTranslations('pages.drawer.ai.alongside');
  const rows = ai.alongside;
  const meta =
    rows.length === 0
      ? undefined
      : ai.alongside_total > rows.length
        ? t('showing', { shown: rows.length, total: ai.alongside_total })
        : t('meta');

  return (
    <InspectorSection
      title={t('title')}
      meta={meta}
      flush
      status={rows.length === 0 ? 'empty' : 'ready'}
      empty={<EmptyState variant="card" headingLevel={3} title={t('emptyTitle')} reason={t('emptyReason')} />}
    >
      <table className="w-full type-table">
        <caption className="sr-only">{t('caption')}</caption>
        <thead>
          <tr className="h-row-compact border-t border-border-subtle bg-surface-subtle">
            <th scope="col" className={`${HEADER_CLASS} w-full pr-2 pl-4 text-left`}>
              {t('columnAddress')}
            </th>
            <th scope="col" className={`${HEADER_CLASS} pr-4 pl-2 text-right`}>
              {t('columnAnswers')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const kind = alongsideKind(row);
            const parsed = displayUrl(row.url);
            const domain = row.host === '' ? parsed.host : displayDomain(row.host);
            return (
              <tr key={row.url_id} className="min-h-row-compact border-t border-border-subtle hover:bg-surface-hover">
                <td className="w-full max-w-0 py-2 pr-2 pl-4">
                  {kind === 'page' ? (
                    <button
                      type="button"
                      aria-label={t('openPage', { address: row.path ?? parsed.display })}
                      className="flex w-full min-w-0 flex-col items-start rounded-sm text-left outline-none hover:underline focus-visible:focus-ring-inset"
                      onClick={() => onOpenPage(String(row.url_id))}
                    >
                      <span className="max-w-full truncate type-table text-foreground">
                        {row.path ?? parsed.display}
                      </span>
                      {row.title === null ? null : (
                        <span className="max-w-full truncate type-meta text-foreground-secondary">{row.title}</span>
                      )}
                    </button>
                  ) : (
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="min-w-0 truncate type-table text-foreground">{parsed.display}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <DomainChip domain={domain} />
                        {kind === 'competitor' ? (
                          <Badge variant="subtle" tone="warning">
                            {t('competitor')}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4 pl-2 text-right align-top num whitespace-nowrap">
                  <Tooltip
                    content={t('answersTip', { shared: row.answers_shared, answers: ai.answers_citing })}
                    purpose="label"
                  >
                    <span className="text-foreground">{formatInteger(row.answers_shared)}</span>
                  </Tooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </InspectorSection>
  );
}
