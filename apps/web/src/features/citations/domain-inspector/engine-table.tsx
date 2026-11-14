'use client';

import { ChartColumn } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { engineRows, type EngineRow } from './domain-model';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Tooltip } from '@/components/ui/tooltip';
import type { EngineCode, SourceDomainDetailData } from '@/lib/citations/types';
import { EMPTY_VALUE, formatInteger, formatPercent } from '@/lib/format';

export interface EngineTableProps {
  /** `null` while the read has nothing. */
  data: SourceDomainDetailData | null;
  /** The engines in scope with their names; the table has a row for each, in the fixed engine order. */
  engines: readonly { code: EngineCode; label: string }[];
  /** A read is on its way while the table is on screen: it keeps its figures and says it is busy. */
  refetching: boolean;
}

/** A tooltip on an element nothing focuses reaches no keyboard user (20 section 6.2 rule 6); the lint rule cannot see why. */
const FOCUSABLE = { tabIndex: 0 } as const;

/** A figure that is not known, with the reason in a tooltip the keyboard reaches. Never a 0. */
function Unknown({ reason }: { reason: string }): ReactElement {
  return (
    <Tooltip content={reason}>
      <span {...FOCUSABLE} className="rounded-sm text-foreground-tertiary outline-none focus-visible:focus-ring">
        {EMPTY_VALUE}
      </span>
    </Tooltip>
  );
}

/**
 * The per engine breakdown of the domain (WB-DOM-04): for each engine in scope the domain's units on it, its share
 * of that engine's units with the counts it is of, and the answers on that engine that cite it. The engines stay
 * apart: there is no total row, and an engine with no citation in scope has no share (n/a with the reason, never
 * 0%).
 */
export function EngineTable({ data, engines, refetching }: EngineTableProps): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const locale = useLocale();
  const labels = useMemo(() => new Map(engines.map((engine) => [engine.code, engine.label])), [engines]);
  const labelOf = (code: EngineCode): string => labels.get(code) ?? code;
  const rows = useMemo(
    () =>
      data === null
        ? []
        : engineRows(
            data,
            engines.map((engine) => engine.code),
          ),
    [data, engines],
  );

  // A count of an engine is a real 0 only when the engine read an answer: with none, 0 units would claim a check
  // that never happened
  const countOf = (
    row: EngineRow,
    count: (known: Exclude<EngineRow, { state: 'unknown' }>) => number,
  ): ReactElement | string => {
    if (row.state === 'unknown') return <Unknown reason={t('engineUnknown', { engine: labelOf(row.code) })} />;
    if (row.state === 'none' && !row.asked)
      return <Unknown reason={t('engineNoAnswers', { engine: labelOf(row.code) })} />;
    return formatInteger(count(row), { locale });
  };

  const columns: PlainColumn<EngineRow>[] = [
    { id: 'engine', header: t('engineHeader'), cell: (row) => labelOf(row.code) },
    { id: 'units', header: t('engineUnits'), cell: (row) => countOf(row, (known) => known.units) },
    {
      id: 'share',
      header: t('engineShare'),
      wrap: true,
      cell: (row) => {
        if (row.state === 'unknown') return <Unknown reason={t('engineUnknown', { engine: labelOf(row.code) })} />;
        if (row.state === 'none') return <Unknown reason={t('engineNone', { engine: labelOf(row.code) })} />;
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span className="type-body-strong text-foreground">{formatPercent(row.share, { locale })}</span>
            <span aria-hidden="true" className="type-meta">
              {t('engineShareContext', { units: row.units, total: row.total })}
            </span>
            <span className="sr-only">
              {t('engineCell', { units: row.units, total: row.total, engine: labelOf(row.code) })}
            </span>
          </span>
        );
      },
    },
    { id: 'answers', header: t('engineAnswers'), cell: (row) => countOf(row, (known) => known.answers) },
  ];

  return (
    <InspectorSection title={t('enginesTitle')} icon={ChartColumn} status={data === null ? 'loading' : 'ready'}>
      <div aria-busy={refetching ? true : undefined}>
        <PlainTable<EngineRow>
          caption={t('engineCaption', { domain: data?.registrable_domain ?? '' })}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.code}
          status="ready"
          errorState={null}
          emptyText={t('notCitedTitle')}
        />
      </div>
    </InspectorSection>
  );
}
