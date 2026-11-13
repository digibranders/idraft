'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement, type ReactNode } from 'react';

import {
  buildByEngine,
  longRows,
  type EngineRow,
  type LongRow,
  type OwnCitation,
  type RateCell,
  type RateKind,
  type SourcesState,
} from './by-engine-model';
import { useCardMeta } from './card-meta';
import { useCardData } from './use-card-data';
import { useCardDrill, useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { SmallSampleMarker } from '@/components/app/chart/small-sample-marker';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { DeltaCell } from '@/components/app/metric/delta-cell';
import { SampleCount } from '@/components/app/metric/sample-count';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { LinkButton } from '@/components/ui/link-button';
import { TextLink } from '@/components/ui/text-link';
import type { CardProps } from '@/features/layouts';
import type { CsvCell } from '@/lib/csv/csv-write';
import { safeText } from '@/lib/csv/csv-write';
import { EMPTY_VALUE, formatInteger, formatInterval, formatList, formatPercent, formatPointsDelta } from '@/lib/format';

type Translate = ReturnType<typeof useTranslations<'aiOverview.engines.byEngine'>>;

const METRIC_KEY = {
  mention: 'metricMention',
  citation: 'metricCitation',
  shareOfVoice: 'metricShareOfVoice',
  ownCitation: 'metricOwnCitation',
} as const satisfies Record<RateKind | 'ownCitation', string>;

const REASON_KEY = {
  noAnswers: 'noAnswers',
  noneValid: 'noneValid',
  noBrandNamed: 'noBrandNamed',
} as const;

const STATUS_KEY = {
  no_answers: 'noAnswers',
  no_valid_answers: 'noneValid',
  no_brand_named: 'noBrandNamed',
  branded_only: 'ownBrandedOnly',
  not_read: 'ownNotRead',
} as const;

/** The name of the downloaded file, without its extension. */
const FILE_NAME = 'ai-by-engine';

const percentPoints = (rate: number): number => Math.round(rate * 10000) / 100;

/** What a cell of a rate says in one line, for the summary: the percent with its counts, or why there is none. */
function figureText(cell: RateCell, kind: RateKind, t: Translate): string {
  if (cell.state === 'insufficient') return t('thin', { count: cell.answers });
  if (cell.state === 'none') return t(REASON_KEY[cell.reason ?? 'noAnswers']);
  const value = formatPercent(cell.value);
  return kind === 'shareOfVoice' || cell.successes === null
    ? t('figureShare', { value, n: cell.answers })
    : t('figure', { value, k: cell.successes, n: cell.answers });
}

function RateCellView({ cell, kind, t }: { cell: RateCell; kind: RateKind; t: Translate }): ReactElement {
  if (cell.state === 'insufficient') return <SmallSampleMarker answers={cell.answers} form="text" />;
  if (cell.state === 'none') {
    return <span className="text-foreground-tertiary">{t(REASON_KEY[cell.reason ?? 'noAnswers'])}</span>;
  }
  const before = cell.previous;
  const previousText =
    before === null || before.value === null
      ? undefined
      : kind === 'shareOfVoice' || before.successes === null
        ? t('previousShare', { value: formatPercent(before.value), n: before.answers })
        : t('previousText', { value: formatPercent(before.value), k: before.successes, n: before.answers });
  return (
    <div className="flex flex-col">
      <span className="flex items-center gap-2">
        <span className="num type-table text-foreground">{formatPercent(cell.value)}</span>
        <DeltaCell
          input={cell.change}
          test="interim"
          {...(previousText === undefined ? {} : { tip: { previousText } })}
        />
      </span>
      {kind === 'shareOfVoice' ? (
        // Its count is the answers that name a brand, not the valid answers: say so, as the tip does
        <span className="num type-meta">{t('shareCount', { n: cell.answers })}</span>
      ) : (
        <SampleCount k={cell.successes} n={cell.answers} noun="answers" />
      )}
    </div>
  );
}

function OwnCitationView({ own, t }: { own: OwnCitation; t: Translate }): ReactElement {
  if (own.status !== 'read') {
    return (
      <div className="flex flex-col">
        <span className="text-foreground-tertiary">{EMPTY_VALUE}</span>
        <span className="type-meta text-foreground-tertiary">
          {t(own.status === 'brandedOnly' ? 'ownBrandedOnly' : 'ownNotRead')}
        </span>
      </div>
    );
  }
  if (own.state === 'none') return <span className="text-foreground-tertiary">{t('noAnswers')}</span>;
  return (
    <div className="flex flex-col">
      <span className="num type-table text-foreground">
        {own.state === 'ok' ? formatPercent(own.value) : t('thin', { count: own.n })}
      </span>
      <span className="num type-meta">{t('units', { k: own.k, n: own.n })}</span>
    </div>
  );
}

/** The words of one row of the long table, which the CSV repeats. */
function longCells(row: LongRow, t: Translate): string[] {
  const rate =
    row.status === 'ok'
      ? formatPercent(row.value)
      : row.status === 'insufficient'
        ? t('thin', { count: row.n ?? 0 })
        : t(STATUS_KEY[row.status as keyof typeof STATUS_KEY] ?? 'noAnswers');
  const change =
    row.change === null || row.change.value === null
      ? EMPTY_VALUE
      : t('changeText', {
          points: formatPointsDelta(row.change.value),
          test:
            row.change.isDetectable === true ? 'detectable' : row.change.isDetectable === false ? 'within' : 'other',
        });
  return [
    row.label,
    t(METRIC_KEY[row.metric]),
    rate,
    row.k === null ? EMPTY_VALUE : formatInteger(row.k),
    row.n === null ? EMPTY_VALUE : formatInteger(row.n),
    row.prompts === null ? EMPTY_VALUE : formatInteger(row.prompts),
    row.interval === null ? EMPTY_VALUE : formatInterval(row.interval.low, row.interval.high),
    change,
  ];
}

/** The row of the export block: raw numbers, an unknown value empty and the status says why. */
function exportCells(row: LongRow): CsvCell[] {
  const shown = row.status === 'ok' && row.value !== null;
  const change = row.change?.value ?? null;
  return [
    row.label,
    row.metric,
    shown && row.value !== null ? percentPoints(row.value) : null,
    row.k,
    row.n,
    row.prompts,
    row.interval === null ? null : percentPoints(row.interval.low),
    row.interval === null ? null : percentPoints(row.interval.high),
    change === null ? null : percentPoints(change),
    row.change?.isDetectable == null ? null : row.change.isDetectable ? 'true' : 'false',
    row.status,
  ];
}

const EXPORT_HEADER = [
  'engine',
  'metric',
  'value_percent',
  'k',
  'n',
  'prompts',
  'interval_low_percent',
  'interval_high_percent',
  'change_points',
  'change_detectable',
  'status',
] as const;

/**
 * AI by engine (WB-OV-06): mention, citation and share of voice of each asked engine with the counts they rest on and
 * how they moved, and the own citation share, in one plain table. The engines are never pooled: the equal-weight line
 * sits under the rows and names the engines it averages. There is no Recommendation column: nothing classifies a
 * recommendation yet (plan D2).
 */
export default function ByEngineCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.byEngine');
  const common = useTranslations('aiOverview.engines.common');
  const meta = useCardMeta();
  const drill = useCardDrill();
  const data = useCardData({ previous: 'optional', sources: true, subscribed: live });
  const { scope, aggregates } = data;

  // The sources of the last scope are not read for this one: the citation column says "not read" until they arrive
  const sourcesRead = data.sources;
  const sources: SourcesState =
    scope.branded === 'only'
      ? 'brandedOnly'
      : sourcesRead?.data === undefined || sourcesRead.placeholder
        ? 'notRead'
        : 'read';
  const model = useMemo(
    () => (aggregates === null ? null : buildByEngine({ aggregates, sources })),
    [aggregates, sources],
  );
  const rows = useMemo(() => (model === null ? [] : longRows(model)), [model]);

  const noValidAnswers = model !== null && model.rows.every((row) => row.validAnswers === 0);
  const phase = data.phase === 'ready' && noValidAnswers ? 'empty' : data.phase;
  const notValid =
    model === null ? 0 : model.rows.reduce((total, row) => total + (row.allAnswers - row.validAnswers), 0);
  const runs = data.canViewRuns ? drill('runs') : null;
  const frame = useFrameState(
    { ...data, phase },
    {
      name: t('title'),
      empty:
        data.asked.length === 0
          ? { title: t('emptyNoEngineTitle'), reason: t('emptyNoEngineReason') }
          : {
              title: t('emptyTitle', { days: scope.range.days }),
              reason: notValid > 0 ? t('emptyReasonInvalid', { count: notValid }) : t('emptyReasonNone'),
              action:
                runs === null ? undefined : (
                  <LinkButton size="sm" render={<Link href={runs} />}>
                    {common('viewRuns')}
                  </LinkButton>
                ),
            },
    },
  );

  const header = [
    t('engine'),
    t('metric'),
    t('rate'),
    t('counted'),
    t('valid'),
    t('prompts'),
    t('interval'),
    t('change'),
  ];
  const tableRows = useMemo(() => rows.map((row) => ({ row, cells: longCells(row, t) })), [rows, t]);

  useCardExport(item.id, () =>
    model === null || phase === 'loading' || phase === 'error'
      ? null
      : { id: item.id, header: EXPORT_HEADER, rows: rows.map(exportCells) },
  );

  const columns: readonly PlainColumn<EngineRow>[] = [
    {
      id: 'engine',
      header: t('engine'),
      cell: (row): ReactNode => {
        const logo = <EngineLogo engine={row.engineCode} name={row.label} />;
        const href = drill('prompts', { engine: row.engineCode });
        return href === null ? (
          logo
        ) : (
          <TextLink tone="inherit" render={<Link href={href} />}>
            {logo}
          </TextLink>
        );
      },
    },
    {
      id: 'mention',
      header: t('mention'),
      wrap: true,
      cell: (row) => <RateCellView cell={row.mention} kind="mention" t={t} />,
    },
    {
      id: 'citation',
      header: t('citation'),
      wrap: true,
      cell: (row) => <RateCellView cell={row.citation} kind="citation" t={t} />,
    },
    {
      id: 'shareOfVoice',
      header: t('shareOfVoice'),
      wrap: true,
      cell: (row) => <RateCellView cell={row.shareOfVoice} kind="shareOfVoice" t={t} />,
    },
    {
      id: 'ownCitation',
      header: t('ownCitation'),
      wrap: true,
      cell: (row) => <OwnCitationView own={row.ownCitation} t={t} />,
    },
  ];
  const longColumns: readonly PlainColumn<{ row: LongRow; cells: string[] }>[] = header.map((text, index) => ({
    id: `col-${String(index)}`,
    header: text,
    wrap: true,
    cell: (entry) => entry.cells[index] ?? EMPTY_VALUE,
  }));

  const label = (code: string): string => model?.rows.find((row) => row.engineCode === code)?.label ?? code;
  const averageNote = (() => {
    const groups = new Map<string, { engines: string[]; parts: string[] }>();
    for (const average of model?.averages ?? []) {
      const key = average.engines.join(',');
      const group = groups.get(key) ?? { engines: [...average.engines], parts: [] };
      group.parts.push(t('avgPart', { metric: t(METRIC_KEY[average.metric]), value: formatPercent(average.value) }));
      groups.set(key, group);
    }
    return [...groups.values()].map((group) =>
      t('avgLine', {
        avg: common('avg', { count: group.engines.length }),
        engines: formatList(group.engines.map(label)),
        parts: group.parts.join(', '),
      }),
    );
  })();
  const summary = [
    t('summaryIntro', { engines: formatList((model?.rows ?? []).map((row) => row.label)) }),
    ...(model?.rows ?? []).map((row) =>
      t('summaryEngine', {
        engine: row.label,
        mention: figureText(row.mention, 'mention', t),
        citation: figureText(row.citation, 'citation', t),
        sov: figureText(row.shareOfVoice, 'shareOfVoice', t),
      }),
    ),
  ].join(' ');

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={t('title')}
      meta={meta({
        range: scope.range,
        prompts: model?.promptCount ?? null,
        answers: model === null ? null : model.rows.reduce((total, row) => total + row.validAnswers, 0),
        branded: scope.branded,
        promptWeighted: true,
      })}
      footnote={[...averageNote, t('footnote')].join(' ')}
      height={180}
      summary={summary}
      body={
        <PlainTable<EngineRow>
          caption={t('title')}
          columns={columns}
          rows={model?.rows ?? []}
          rowKey={(row) => row.engineCode}
          status="ready"
          errorState={null}
          emptyText={t('noAnswers')}
        />
      }
      table={
        <PlainTable<{ row: LongRow; cells: string[] }>
          caption={t('title')}
          columns={longColumns}
          rows={tableRows}
          rowKey={(entry) => `${entry.row.engineCode}-${entry.row.metric}`}
          status="ready"
          errorState={null}
          emptyText={t('noAnswers')}
        />
      }
      menu={{
        fileName: FILE_NAME,
        csv: { header, rows: tableRows.map((entry) => entry.cells.map((cell) => safeText(cell))) },
      }}
      {...frame}
    />
  );
}
