'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { useSourceDiversity } from './data/source-reads';
import {
  diversityModel,
  valueOf,
  type DiversityEngine,
  type DiversityPoint,
  type DiversityView,
} from './model/diversity-model';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { engineNames } from './parts/source-meta';
import { engineLabel, engineRole } from '../engines/engine-role';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../../numbers/number-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { MetricInfo } from '@/components/app/metric/metric-info';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { CardProps } from '@/features/layouts';
import { announce } from '@/lib/a11y/announcer';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import type { CsvTable } from '@/lib/csv/csv-write';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatDateRange, formatDecimal, formatInteger, formatList } from '@/lib/format';

const HEIGHT = 240;
const VIEWS = ['distinct', 'effective'] as const satisfies readonly DiversityView[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

interface TipParam {
  dataIndex?: number;
  axisValueLabel?: string;
}

/** The series of the option the frame built, as the tooltip needs them: the id, name and colour of each line shown. */
function shownLines(option: Record<string, unknown>): { id: string; name: string; color: string | undefined }[] {
  const list = Array.isArray(option.series) ? (option.series as unknown[]) : [];
  return list.flatMap((entry) => {
    const line = recordOf(entry);
    return typeof line.id === 'string'
      ? [
          {
            id: line.id,
            name: typeof line.name === 'string' ? line.name : '',
            color: typeof line.color === 'string' ? line.color : undefined,
          },
        ]
      : [];
  });
}

/**
 * CH-26: the weekly source diversity of each engine asked, one line each in the colour of the engine, as distinct
 * domains or as effective sources (inverse HHI). Engines are never added together and the average is the one the
 * API states, labelled as the equal-weight mean of the engines with units. A week with no citation unit is a gap in
 * the line and not 0. The Table view and every tooltip carry both inputs of a week: its units and its domains.
 */
export default function DiversityCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.diversity');
  const say = useTranslations('aiOverview.sources.common') as Say;
  const reads = useSourceDiversity({ subscribed: live });
  const read = reads.current.data;
  const [view, setView] = useState<DiversityView>('distinct');
  const model = useMemo(() => (read === undefined ? null : diversityModel(read)), [read]);

  const situation = ((): DataSituation => {
    if (reads.askable !== 'ok') return { kind: reads.askable };
    if (read === undefined || model === null) return { kind: 'ready' };
    if (read.data.every((engine) => engine.answers === 0)) return { kind: 'no_answers' };
    return model.hasUnits ? { kind: 'ready' } : { kind: 'no_weekly_units' };
  })();
  const frame = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: null,
    previousEmpty: false,
    situation,
  });
  const shown = frame.status === 'ready' || frame.status === 'refetching';

  const name = useCallback((engine: DiversityEngine): string => engineLabel(engine.code) ?? engine.code, []);
  const valueText = useCallback(
    (value: number): string =>
      view === 'distinct'
        ? t('valueDistinct', { count: value })
        : t('valueEffective', { value: formatDecimal(value, 1) }),
    [view, t],
  );
  const cellOf = useCallback(
    (point: DiversityPoint): string | null => {
      if (valueOf(point, view) === null) return null;
      const units = point.units ?? 0;
      const domains = point.domains ?? 0;
      return view === 'distinct'
        ? t('cellDistinct', { domains, units })
        : t('cellEffective', { value: formatDecimal(point.effective, 1), units, domains });
    },
    [view, t],
  );

  const categories = useMemo(() => (model?.weeks ?? []).map((week) => formatChartDate(week)), [model]);
  const series = useMemo(
    (): CategorySeries[] =>
      (model?.engines ?? []).map((engine) => ({
        id: engine.code,
        name: engineLabel(engine.code) ?? engine.code,
        role: engineRole(engine.code),
        values: engine.points.map((point) => valueOf(point, view)),
      })),
    [model, view],
  );
  const cellText = useCallback(
    (seriesId: string, index: number): string | null => {
      const point = model?.engines.find((engine) => engine.code === seriesId)?.points[index];
      return point === undefined ? null : cellOf(point);
    },
    [model, cellOf],
  );

  const extendOption = useCallback(
    (option: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> => {
      const lines = shownLines(option);
      const weeks = model?.weeks ?? [];
      const axis = recordOf(option.yAxis);
      const tooltip = (params: readonly TipParam[]): string => {
        const first = params[0];
        const index = first?.dataIndex ?? -1;
        const week = weeks[index];
        if (week === undefined) return tipTitleHtml(first?.axisValueLabel ?? '');
        const rows = lines.map((line) =>
          tipRowHtml(line.color ?? tokens.other, line.name, cellText(line.id, index) ?? t('noUnitsWeek'), tokens),
        );
        return `${tipTitleHtml(t('weekTitle', { date: formatChartDate(week) }))}${rows.join('')}`;
      };
      return {
        ...option,
        // Counts start at 0, and the ticks are plain numbers: the unit is in the tooltip and the Table view
        yAxis: {
          ...axis,
          min: 0,
          axisLabel: {
            ...recordOf(axis.axisLabel),
            formatter: (value: number) => (view === 'distinct' ? formatInteger(value) : formatDecimal(value, 1)),
          },
        },
        tooltip: { ...recordOf(option.tooltip), formatter: tooltip },
      };
    },
    [model, cellText, view, t],
  );

  const summary = useMemo((): string => {
    if (model === null || !model.hasUnits) return t('summaryIntro', { view });
    const sentences = model.engines.map((engine) => {
      const points = engine.points.filter((point) => valueOf(point, view) !== null);
      const first = points[0];
      const last = points[points.length - 1];
      const label = name(engine);
      if (first === undefined || last === undefined) return t('summaryEngineNone', { engine: label });
      const at = (point: DiversityPoint): string => valueText(valueOf(point, view) ?? 0);
      return first === last
        ? t('summaryEngineSingle', { engine: label, value: at(first), week: formatChartDate(first.weekStart) })
        : t('summaryEngine', {
            engine: label,
            first: at(first),
            firstWeek: formatChartDate(first.weekStart),
            last: at(last),
            lastWeek: formatChartDate(last.weekStart),
          });
    });
    return [t('summaryIntro', { view }), ...sentences].join(' ');
  }, [model, view, name, valueText, t]);

  // The same table is the Table view's download and the export block: every week of every engine, whatever the measure
  const table = useMemo(
    (): CsvTable | undefined =>
      model === null
        ? undefined
        : {
            header: [t('weekHeader'), t('engineHeader'), t('unitsHeader'), t('domainsHeader'), t('effectiveHeader')],
            rows: model.engines.flatMap((engine) =>
              engine.points.map((point) => [
                point.weekStart,
                name(engine),
                point.units,
                point.domains,
                point.effective,
              ]),
            ),
          },
    [model, name, t],
  );
  useCardExport(item.id, () => (shown && table !== undefined ? { id: item.id, ...table } : null));

  const meta =
    read === undefined || model === null || !shown
      ? null
      : t('meta', {
          window: formatDateRange(read.meta.window.from, read.meta.window.to),
          domains: model.distinctDomains,
          engines: formatList(engineNames(read.meta.engine_codes)),
          branded: String(read.meta.include_branded),
        });

  const choose = (next: DiversityView): void => {
    setView(next);
    announce(t('announceView', { view: next }), { key: 'sources-diversity-view' });
  };
  const infoKey = view === 'distinct' ? 'infoDistinct' : 'infoEffective';
  const flaggedNote = say('footnoteFlagged');

  return (
    <ChartFrame
      kind="line"
      variant="panel"
      height={HEIGHT}
      title={t('title')}
      meta={meta}
      summary={summary}
      controls={
        shown ? (
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<DiversityView>
              semantics="view"
              label={t('viewLabel')}
              size="sm"
              value={view}
              onValueChange={choose}
              items={VIEWS.map((value) => ({
                value,
                label: t(value === 'distinct' ? 'viewDistinct' : 'viewEffective'),
              }))}
            />
            <MetricInfo
              name={t(`${infoKey}Name`)}
              definition={t(`${infoKey}Definition`)}
              formula={t(`${infoKey}Formula`)}
              methodologyHref={METHODOLOGY_HREF}
            />
          </div>
        ) : undefined
      }
      footnote={
        model === null || !shown ? undefined : (
          <div className="flex flex-col gap-1">
            {model.average === null ? null : <p>{t('footnoteAverage', { value: formatDecimal(model.average, 1) })}</p>}
            <p>{t('footnoteGap')}</p>
            <p>{flaggedNote}</p>
          </div>
        )
      }
      categories={categories}
      categoryHeader={t('weekColumn')}
      series={series}
      formatValue={valueText}
      cellText={cellText}
      extendOption={extendOption}
      menu={{ fileName: t('fileName'), png: true, csv: table ?? true }}
      {...frame}
    />
  );
}
