'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useCardMeta } from './card-meta';
import { FactSentence, HowThisIsWritten, useFactText } from './fact-sentences';
import { buildFacts, factNumbers, limitFacts, type Comparison, type Fact } from './facts-model';
import { pairPrompts } from './prompt-pairs';
import { useCardData } from './use-card-data';
import { useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import { useNewSources } from './use-new-sources';
import { comparisonWindow } from '../../data/overview-queries';
import type { ExportBlock } from '../../export/export-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';

/** The name of the downloaded file, without its extension. */
const FILE_NAME = 'what-changed';

/** The Facts option of the catalog: 3 or 5, 5 by default. */
const limitOf = (value: string | undefined): number => (value === '3' ? 3 : 5);

const EXPORT_HEADER = [
  'kind',
  'engine',
  'in_list',
  'count',
  'of',
  'second_count',
  'second_of',
  'prompts',
  'left_out',
  'change_points',
  'days',
  'min_support',
] as const;

const percentPoints = (points: number): number => Math.round(points * 100) / 100;

interface FactRow {
  fact: Fact;
  listed: boolean;
}

/**
 * What changed (CH-37): a few sentences built from counted facts (`facts-model.ts`), in reading order, with every
 * fact and its numbers in the Table view. The words are fixed templates (`fact-sentences.tsx`); nothing here is
 * written by a model, and no sentence names a cause. With no previous data one sentence says so.
 */
export default function ChangeSummaryCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.changeSummary');
  const loading = useTranslations('common');
  const metaOf = useCardMeta();
  const text = useFactText();
  const data = useCardData({ previous: 'optional', subscribed: live });
  const newSources = useNewSources({ subscribed: live });
  const { scope, aggregates, asked } = data;
  const currentRows = data.current.data?.prompts;
  const previousRows = data.previous?.data?.prompts;

  const comparison: Comparison =
    comparisonWindow(scope) === null ? 'off' : data.comparing ? 'read' : data.partialPrevious ? 'unread' : 'pending';
  const facts = useMemo(
    () =>
      aggregates === null
        ? []
        : buildFacts({
            aggregates,
            comparison,
            pairs:
              comparison === 'read' && currentRows !== undefined && previousRows !== undefined
                ? pairPrompts(currentRows, previousRows, asked)
                : null,
            newSources: newSources.data ?? null,
            days: scope.range.days,
          }),
    [aggregates, comparison, currentRows, previousRows, asked, newSources.data, scope.range.days],
  );
  const limit = limitOf(options.facts);
  const { shown, hidden } = limitFacts(facts, limit);

  const title = t('title');
  const frame = useFrameState(data, {
    name: title,
    empty:
      asked.length === 0
        ? { title: t('emptyNoEngineTitle'), reason: t('emptyNoEngineReason') }
        : { title: t('emptyNoPromptsTitle'), reason: t('emptyNoPromptsReason') },
  });

  const rows: FactRow[] = facts.map((fact, index) => ({ fact, listed: index < limit }));
  const header = [t('tableFact'), t('tableEngine'), t('tableNumbers'), t('tableListed')];
  const cellsOf = ({ fact, listed }: FactRow): string[] => [
    text.sentence(fact),
    text.engine(fact),
    text.numbers(fact),
    listed ? t('listedYes') : t('listedNo'),
  ];
  const columns: readonly PlainColumn<FactRow>[] = header.map((name, index) => ({
    id: `col-${String(index)}`,
    header: name,
    wrap: true,
    cell: (row) => cellsOf(row)[index],
  }));

  useCardExport(item.id, (): ExportBlock | null => {
    if (aggregates === null || data.phase === 'loading' || data.phase === 'error') return null;
    return {
      id: item.id,
      header: EXPORT_HEADER,
      rows: rows.map(({ fact, listed }): CsvCell[] => {
        const numbers = factNumbers(fact);
        return [
          fact.kind,
          'engine' in fact.params ? fact.params.engine : null,
          listed ? 'yes' : 'no',
          numbers.count,
          numbers.of,
          numbers.secondCount,
          numbers.secondOf,
          numbers.prompts,
          numbers.leftOut,
          numbers.changePoints === null ? null : percentPoints(numbers.changePoints),
          numbers.days,
          numbers.minSupport,
        ];
      }),
    };
  });

  const [first] = facts;
  // No fact is said while the reads are not paired (first load, or a refetch of the same scope): that is not "none"
  const waiting = data.phase === 'loading' || comparison === 'pending';
  const answers =
    aggregates === null ? null : aggregates.engines.reduce((total, engine) => total + engine.validAnswers, 0);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={metaOf({
        range: scope.range,
        prompts: aggregates?.promptCount ?? null,
        answers,
        branded: scope.branded,
      })}
      footnote={
        <div className="flex flex-wrap items-center gap-x-2">
          <span>{t('footnote')}</span>
          <HowThisIsWritten />
        </div>
      }
      height={140}
      summary={waiting ? loading('loading') : first === undefined ? t('summaryNone') : text.sentence(first)}
      body={
        <div className="flex flex-col gap-2">
          {shown.length === 0 ? null : (
            <ol aria-label={title} className="flex flex-col gap-2">
              {shown.map((fact) => (
                <li key={fact.id} className="type-body text-foreground">
                  <FactSentence fact={fact} />
                </li>
              ))}
            </ol>
          )}
          {hidden === 0 ? null : <p className="type-meta">{t('more', { count: hidden })}</p>}
        </div>
      }
      table={
        <PlainTable<FactRow>
          caption={title}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.fact.id}
          status="ready"
          errorState={null}
          emptyText={t('summaryNone')}
        />
      }
      menu={{
        fileName: FILE_NAME,
        csv: { header, rows: rows.map((row) => cellsOf(row).map((cell) => safeText(cell))) },
      }}
      {...frame}
    />
  );
}
