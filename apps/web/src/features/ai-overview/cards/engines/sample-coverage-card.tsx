'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useAnswersFrame } from './answers-frame';
import { useCardMeta } from './card-meta';
import { coverageOf, type CoverageFigures } from './coverage-model';
import { engineLabel } from './engine-role';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCardExport } from './use-card-seams';
import { overviewSummaryQuery } from '../../data/overview-queries';
import type { ExportBlock } from '../../export/export-model';
import { useOverview } from '../../overview-context';
import { BarList, type BarScaleColor, type BarValue, type DistributionRow } from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';
import { EMPTY_VALUE } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** One line of the card, for the bars, the Table view, the file and the export: one set of words and numbers. */
interface Line extends DistributionRow {
  group: string;
  /** The prompts counted; `null` where the number is not known or does not apply. */
  count: number | null;
  total: number | null;
  /** The cell of the Table view and the file under "Prompts" and "Of prompts in scope". */
  valueText: string;
  contextText: string;
  status: 'ok' | 'unknown' | 'included' | 'only';
}

interface Group {
  id: string;
  /** The engine's code, or `null` for the group of figures that are of no engine. */
  engineCode: string | null;
  label: string;
  caption: string;
  lines: Line[];
}

/** Seen from the row's scale (not the brand's chart-1): enough answers, a few, none. */
const ENGINE_SCALES = {
  enough: 'seq-6',
  few: 'insufficient',
  none: 'rank-band-none',
} as const satisfies Record<'enough' | 'few' | 'none', BarScaleColor>;
const KINDS = ['enough', 'few', 'none'] as const;

/** The sample rule of the messages: a rate needs `min` valid answers, and `max` is the most a thin prompt can have. */
const SAMPLE = { min: MIN_OBSERVATIONS, max: MIN_OBSERVATIONS - 1 } as const;

const FILE_NAME = 'answers-behind-the-numbers';
const EXPORT_HEADER = ['group', 'measure', 'prompts', 'of', 'status'] as const;

/** "Answers behind the numbers": how many prompts have enough valid answers on each engine to read a rate. */
export default function SampleCoverageCard({ item }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.coverage');
  const common = useTranslations('aiOverview.engines.common');
  const density = useCardDensity();
  const { workspaceId, enabledEngines } = useOverview();
  const data = useCardData({ previous: 'none' });
  const metaOf = useCardMeta();
  const title = t('title');
  const frame = useAnswersFrame(data, title, (key, values) => t(key, values));
  const { scope, asked, project } = data;

  // The same read as the page's with branded prompts included, so the prompts the page leaves out are counted. It
  // runs only while they are left out, and shares its key with an equal read of the page.
  const brandedRead = useQuery({
    ...overviewSummaryQuery(
      { workspaceId, projectId: project.id },
      { scope: { ...scope, branded: 'included' }, enabledEngines },
    ),
    enabled: scope.branded === 'excluded' && asked.length > 0,
    placeholderData: keepPreviousData,
  });
  // A number of another scope never shows: while the second read is the last scope's (kept data) or the page's own
  // read is not settled, the two are not of one scope and their difference is unknown, which the card says as n/a
  const withBranded =
    brandedRead.isPlaceholderData || data.phase !== 'ready' ? null : (brandedRead.data?.data.prompts.length ?? null);

  const prompts = data.current.data?.prompts;
  const figures = useMemo(
    (): CoverageFigures | null =>
      prompts === undefined ? null : coverageOf({ prompts, asked, branded: scope.branded, withBranded }),
    [prompts, asked, scope.branded, withBranded],
  );
  const engineName = (code: string): string => engineLabel(code) ?? common('unknownEngine');

  const groups = ((): Group[] => {
    if (figures === null) return [];
    const total = figures.prompts;
    const known = (id: string, group: string, label: string, scale: BarScaleColor, count: number): Line => ({
      id,
      group,
      label,
      scale,
      count,
      total,
      status: 'ok',
      valueText: t('prompts', { count }),
      contextText: t('of', { total }),
      value: { kind: 'value', value: count, valueText: t('prompts', { count }), contextText: t('of', { total }) },
      accessibleText: t('accessible', { label, count, total }),
    });
    const words = (id: string, group: string, label: string, status: Line['status'], text: string): Line => ({
      id,
      group,
      label,
      scale: 'chart-other',
      count: null,
      total: null,
      status,
      valueText: text,
      contextText: '',
      value: { kind: 'none', text } satisfies BarValue,
      accessibleText: t('accessibleText', { label, text }),
    });
    const engines = figures.engines.map((engine): Group => {
      const name = engineName(engine.engineCode);
      return {
        id: engine.engineCode,
        engineCode: engine.engineCode,
        label: name,
        caption: t('caption', { engine: name }),
        lines: KINDS.map((kind) =>
          known(`${engine.engineCode}-${kind}`, name, t(kind, SAMPLE), ENGINE_SCALES[kind], engine[kind]),
        ),
      };
    });
    const scopeGroup = t('scopeGroup');
    const { branded } = figures;
    const brandedLine: Line =
      branded.kind === 'leftOut'
        ? {
            // Words with no bar: the count is outside the N prompts the bars are scaled to, and "of N" would be false
            ...words(
              'branded',
              scopeGroup,
              t('brandedLeftOut'),
              'ok',
              t('leftOutText', { count: branded.count, total }),
            ),
            count: branded.count,
            valueText: t('prompts', { count: branded.count }),
            contextText: t('leftOutContext', { total }),
          }
        : branded.kind === 'unknown'
          ? words('branded', scopeGroup, t('brandedLeftOut'), 'unknown', EMPTY_VALUE)
          : words(
              'branded',
              scopeGroup,
              t('brandedIncluded'),
              branded.kind,
              branded.kind === 'included' ? t('includedText') : t('onlyText'),
            );
    return [
      ...engines,
      {
        id: 'scope',
        engineCode: null,
        label: scopeGroup,
        caption: t('captionScope'),
        lines: [known('withoutTopic', scopeGroup, t('withoutTopic'), 'chart-other', figures.withoutTopic), brandedLine],
      },
    ];
  })();
  const lines = groups.flatMap((group) => group.lines);

  const columns: PlainColumn<Line>[] = [
    { id: 'group', header: t('groupHeader'), cell: (line) => line.group },
    { id: 'measure', header: t('labelHeader'), cell: (line) => line.label },
    { id: 'prompts', header: t('valueHeader'), cell: (line) => line.valueText },
    { id: 'of', header: t('contextHeader'), cell: (line) => line.contextText },
  ];

  const summary = [
    t('summaryIntro'),
    ...(figures?.engines.map((engine) =>
      t('summaryEngine', {
        engine: engineName(engine.engineCode),
        enough: engine.enough,
        few: engine.few,
        none: engine.none,
        total: figures.prompts,
        ...SAMPLE,
      }),
    ) ?? []),
  ].join(' ');

  useCardExport(item.id, (): ExportBlock | null => {
    if (figures === null) return null;
    return {
      id: item.id,
      header: EXPORT_HEADER,
      rows: lines.map((line): CsvCell[] => [line.group, line.label, line.count, line.total, line.status]),
    };
  });

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={metaOf({
        range: scope.range,
        prompts: data.aggregates?.promptCount ?? null,
        answers: null,
        branded: scope.branded,
      })}
      footnote={t('footnote', SAMPLE)}
      height={180}
      summary={summary}
      menu={{
        fileName: FILE_NAME,
        csv: {
          header: columns.map((column) => safeText(column.header)),
          rows: lines.map((line) => [line.group, line.label, line.valueText, line.contextText].map(safeText)),
        },
      }}
      body={
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <h3 className="flex items-center gap-2 type-subsection-title text-foreground">
                {group.engineCode === null ? group.label : <EngineLogo engine={group.engineCode} name={group.label} />}
              </h3>
              <BarList
                mode="distribution"
                caption={group.caption}
                labelHeader={t('labelHeader')}
                valueHeader={t('valueHeader')}
                contextHeader={t('contextHeader')}
                rows={group.lines}
                max={figures?.prompts ?? 0}
                density={density}
              />
            </div>
          ))}
        </div>
      }
      table={
        <PlainTable<Line>
          caption={t('tableCaption')}
          columns={columns}
          rows={lines}
          rowKey={(line) => line.id}
          status="ready"
          errorState={null}
          emptyText={EMPTY_VALUE}
        />
      }
      {...frame}
    />
  );
}
