'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useSourcePages } from './data/source-reads';
import { pageRows, type PageFigures } from './model/page-rows';
import { useCitationsDrill } from './parts/drill';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { engineNames, metaLine } from './parts/source-meta';
import { engineLabel } from '../engines/engine-role';
import { useCardDensity } from '../engines/use-card-density';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../../numbers/number-model';
import { BarList, BarListTable, type BarListProps, type ComparisonRow } from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import { MetricInfo } from '@/components/app/metric/metric-info';
import type { CardProps } from '@/features/layouts';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { formatInteger, formatIsoDate, formatList, formatTableDate } from '@/lib/format';

/** The `rows` option (catalog 5, 8 or 10, default 8). */
const ROW_OPTIONS = [5, 8, 10] as const;
const DEFAULT_ROWS = 8;

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

/** How many leaders the summary names. */
const SUMMARY_LEADERS = 3;

/**
 * CH-08: the pages of your own domains that answers cite, by citation units, every bar in `chart-1` (they are all
 * yours). The units of every engine in scope are one pool (the API aggregates them): the meta line and the footnote
 * name the engines and each row's tooltip carries the split. No percent is drawn, so every number is a count with
 * its words. The address and the title are provider text and only ever drawn as text: a row opens the source
 * inspector of the Citations page, never the address itself.
 */
export default function OwnPagesCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.ownPages');
  const say = useTranslations('aiOverview.sources.common') as Say;
  const density = useCardDensity();
  const citations = useCitationsDrill();
  const limit = rowsOf(options.rows);
  const reads = useSourcePages({ limit, subscribed: live });
  const page = reads.current.data;
  const figures = page === undefined ? [] : pageRows(page);

  const situation = ((): DataSituation => {
    if (reads.askable !== 'ok') return { kind: reads.askable };
    if (page === undefined) return { kind: 'ready' };
    if (page.meta.answers === 0) return { kind: 'no_answers' };
    if (page.meta.citation_units === 0) return { kind: 'no_citations', answers: page.meta.answers };
    return figures.length === 0 ? { kind: 'no_own_pages' } : { kind: 'ready' };
  })();
  const frame = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: null,
    previousEmpty: false,
    situation,
  });

  const timeZone = page?.meta.window.timezone ?? 'UTC';
  const engineText = (figure: PageFigures): string =>
    formatList(
      figure.engines.map((engine) =>
        t('engineUnits', {
          engine: engineLabel(engine.engine_code) ?? engine.engine_code,
          units: formatInteger(engine.citation_units),
        }),
      ),
    );

  const rowOf = (figure: PageFigures): ComparisonRow => {
    const name = visibleUrlText(figure.label);
    const tip = [
      figure.title === null ? null : visibleUrlText(figure.title),
      t('tipAddress', { url: visibleUrlText(figure.url) }),
      figure.engines.length === 0 ? null : t('tipEngines', { list: engineText(figure) }),
      t('tipFirst', { date: formatTableDate(figure.firstSeenAt, timeZone) }),
    ]
      .filter((part) => part !== null)
      .join('. ');
    return {
      id: figure.id,
      label: name,
      own: true,
      href: citations({ tab: 'pages', role: 'own', source: figure.urlId }) ?? undefined,
      value: {
        kind: 'value',
        value: figure.units,
        valueText: t('valueText', { units: figure.units }),
        contextText: t('promptsContext', { prompts: figure.prompts }),
      },
      accessibleText: t('rowText', { name, units: figure.units, prompts: figure.prompts, answers: figure.answers }),
      tip,
    };
  };
  const rows = figures.map(rowOf);

  const list: BarListProps = {
    mode: 'comparison',
    rows,
    caption: t('caption'),
    labelHeader: t('labelHeader'),
    valueHeader: t('valueHeader'),
    contextHeader: t('contextHeader'),
    limit: rows.length,
    density,
  };
  const csv: CsvTable = {
    header: [
      t('labelHeader'),
      t('valueHeader'),
      t('contextHeader'),
      t('addressHeader'),
      t('titleHeader'),
      t('enginesHeader'),
      t('firstHeader'),
    ],
    rows: figures.map((figure) => [
      safeText(figure.label),
      figure.units,
      figure.prompts,
      safeText(figure.url),
      figure.title === null ? null : safeText(figure.title),
      engineText(figure),
      formatIsoDate(figure.firstSeenAt, timeZone),
    ]),
  };
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return { id: item.id, header: csv.header, rows: csv.rows };
  });

  const shown = frame.status === 'ready' || frame.status === 'refetching';
  const meta = page === undefined || !shown ? null : metaLine(page.meta, say);
  const hidden = page === undefined ? 0 : page.page.total - figures.length;
  const footnote =
    page === undefined
      ? []
      : [say('footnotePooled', { engines: formatList(engineNames(page.meta.engine_codes)) }), say('footnoteFlagged')];
  const leaders = formatList(
    rows
      .slice(0, SUMMARY_LEADERS)
      .map((row) => `${row.label} ${row.value.kind === 'value' ? row.value.valueText : ''}`.trim()),
  );
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={280}
      title={t('title')}
      meta={meta}
      summary={rows.length === 0 ? t('summaryNone') : t('summary', { pages: rows.length, list: leaders })}
      footnote={
        page === undefined ? undefined : (
          <div className="flex flex-col gap-1">
            {footnote.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {hidden > 0 ? <p>{t('moreRows', { count: hidden })}</p> : null}
          </div>
        )
      }
      body={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 type-meta">
            <span>{t('rankedBy')}</span>
            <MetricInfo
              name={t('infoName')}
              definition={t('infoDefinition')}
              formula={t('infoFormula')}
              {...(page === undefined
                ? {}
                : {
                    denominatorText: t('infoSample', { units: page.meta.citation_units, answers: page.meta.answers }),
                  })}
              methodologyHref={METHODOLOGY_HREF}
            />
          </div>
          <BarList {...list} />
        </div>
      }
      table={<BarListTable {...list} />}
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
