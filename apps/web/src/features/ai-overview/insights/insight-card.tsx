'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatInteger } from '@/lib/format';
import type { Read } from '../data/read-state';

/** Rows a card lists before "Show more": a card is a summary, the page that holds the work lists them all. */
const FIRST_ROWS = 10;

interface Counted<Row> {
  count: number;
  atLeast: boolean;
  rows: readonly Row[];
}

export interface InsightCardProps<Row> {
  /** The section's id in `aiInsights.sections`. */
  section: 'untracked' | 'gaps' | 'citingCompetitors' | 'newDomains';
  read: Read<Counted<Row>>;
  columns: readonly PlainColumn<Row>[];
  rowKey: (row: Row) => string;
  /** The card's link to the page that holds all of it. */
  viewAll: ReactNode;
  /** What a count that is only a floor of zero says it did not cover; sections that count whole omit it. */
  unknownText?: string | undefined;
}

/**
 * One insight (roadmap feature 4, detailed): the headline number, what it counts in a sentence, and the rows it
 * counted. Each card loads and fails alone. A count of zero says so with a reason; a read that could not cover the
 * data says what was not counted instead of zero.
 */
export function InsightCard<Row>({
  section,
  read,
  columns,
  rowKey,
  viewAll,
  unknownText,
}: InsightCardProps<Row>): ReactElement {
  const t = useTranslations('aiInsights');
  const [expanded, setExpanded] = useState(false);
  const titleId = `insight-${section}-title`;
  const data = read.data;
  const unknown = data !== undefined && data.atLeast && data.count === 0;
  const rows = data?.rows ?? [];
  const shown = expanded ? rows : rows.slice(0, FIRST_ROWS);
  const hidden = rows.length - shown.length;

  const header =
    read.status === 'error' ? (
      <>
        <h2 id={titleId} className="type-section-title">
          {t(`sections.${section}.title`)}
        </h2>
        <p className="type-body text-foreground-secondary">{t(`sections.${section}.failed`)}</p>
      </>
    ) : (
      <>
        <h2 id={titleId} className="sr-only">
          {t(`sections.${section}.title`)}
        </h2>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          {data === undefined ? (
            <Skeleton shape="text-14" widthPct={48} />
          ) : unknown ? (
            <span className="type-body text-foreground">{unknownText}</span>
          ) : (
            <>
              <span className="num type-metric text-foreground">
                {formatInteger(data.count)}
                {data.atLeast ? t('atLeastMark') : ''}
              </span>
              <span className="type-body-strong text-foreground">
                {t(`sections.${section}.headline`, { count: data.count })}
              </span>
            </>
          )}
        </div>
        <p className="type-meta text-foreground-secondary">{t(`sections.${section}.explain`)}</p>
      </>
    );

  return (
    <section
      aria-labelledby={titleId}
      data-insight={section}
      aria-busy={read.status === 'loading'}
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex min-h-12 flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">{header}</div>
        {data !== undefined && !unknown ? <div className="shrink-0">{viewAll}</div> : null}
      </div>
      {read.status === 'error' ? (
        <div className="border-t border-border-subtle px-4 py-3">
          <Button variant="secondary" size="sm" onClick={read.refetch}>
            {t('retry')}
          </Button>
        </div>
      ) : data === undefined ? (
        <div className="border-t border-border-subtle">
          <PlainTable
            caption={t(`sections.${section}.title`)}
            columns={columns}
            rows={[]}
            rowKey={rowKey}
            status="loading"
            errorState={null}
            emptyText=""
          />
        </div>
      ) : unknown ? null : rows.length === 0 ? (
        <div className="border-t border-border-subtle">
          <EmptyState
            variant="card"
            headingLevel={3}
            title={t(`sections.${section}.emptyTitle`)}
            reason={t(`sections.${section}.emptyReason`)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border-subtle p-3">
          <PlainTable
            caption={t('listLabel', { section: t(`sections.${section}.title`) })}
            columns={columns}
            rows={shown}
            rowKey={rowKey}
            status="ready"
            errorState={null}
            emptyText=""
          />
          {rows.length > FIRST_ROWS ? (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
                {expanded ? t('showFewer') : t('showMore', { count: hidden })}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
