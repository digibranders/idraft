'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useSourcePages } from './data/source-reads';
import { pageRows, type PageFigures } from './model/page-rows';
import { useCitationsDrill } from './parts/drill';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { DomainBars, type DomainBarRow } from './parts/domain-bars';
import { engineNames, metaLine } from './parts/source-meta';
import { engineLabel } from '../engines/engine-role';
import { useCardDensity } from '../engines/use-card-density';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../say';
import { BarListTable, type BarListProps, type ComparisonRow } from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { formatInteger, formatIsoDate, formatList, formatPercent, formatTableDate } from '@/lib/format';

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
 * CH-08 and OV-CIT-05: the pages of your own domains that answers cite, one line each (the path, a bar in `chart-1`,
 * the page's share of the units that go to your domains and its units). The units of every platform in scope are one
 * pool (the API aggregates them): the footnote names the platforms and each row's tooltip carries the split. The
 * address and the title are provider text and only ever drawn as text: a row opens the source inspector of the
 * Citations page, never the address itself.
 */
export default function OwnPagesCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.ownPages');
  const words = useTranslations('aiOverview.sourcesTracking.ownPages');
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
  const state = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: null,
    previousEmpty: false,
    situation,
  });
  // The preview's reason for no page of yours in the citations, whether nothing was cited or only other sites were
  const frame =
    state.status === 'empty' && (situation.kind === 'no_citations' || situation.kind === 'no_own_pages')
      ? { ...state, empty: { title: words('emptyTitle'), reason: words('emptyReason') } }
      : state;

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

  // One denominator: the units that go to your domains, which the read states for the whole scope
  const ownUnits = page?.meta.by_role.find((entry) => entry.domain_role === 'own')?.citation_units ?? 0;
  const rowOf = (figure: PageFigures): ComparisonRow & { barRow: DomainBarRow } => {
    const name = visibleUrlText(figure.label);
    const tip = [
      figure.title === null ? null : visibleUrlText(figure.title),
      t('tipAddress', { url: visibleUrlText(figure.url) }),
      figure.engines.length === 0 ? null : t('tipEngines', { list: engineText(figure) }),
      t('tipFirst', { date: formatTableDate(figure.firstSeenAt, timeZone) }),
    ]
      .filter((part) => part !== null)
      .join('. ');
    const href = citations({ tab: 'pages', role: 'own', source: figure.urlId }) ?? undefined;
    return {
      id: figure.id,
      label: name,
      own: true,
      href,
      barRow: {
        id: figure.id,
        label: name,
        own: true,
        strong: false,
        value: ownUnits > 0 ? figure.units / ownUnits : null,
        valueText: ownUnits > 0 ? formatPercent(figure.units / ownUnits, { decimals: 0 }) : '',
        note: words('note', { units: figure.units }),
        tip,
        href,
      },
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
  const domains = page === undefined ? [] : [...new Set(page.data.map((row) => row.registrable_domain))];
  const meta =
    page === undefined || !shown || ownUnits === 0
      ? null
      : domains.length === 1
        ? words('meta', { units: ownUnits, domain: domains[0] ?? '' })
        : words('metaDomains', { units: ownUnits, count: domains.length });
  const hidden = page === undefined ? 0 : page.page.total - figures.length;
  const footnote =
    page === undefined
      ? []
      : [
          metaLine(page.meta, say),
          say('footnotePooled', { engines: formatList(engineNames(page.meta.engine_codes)) }),
          say('footnoteFlagged'),
        ];
  const leaders = formatList(
    rows
      .slice(0, SUMMARY_LEADERS)
      .map((row) => `${row.label} ${row.value.kind === 'value' ? row.value.valueText : ''}`.trim()),
  );
  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      height={280}
      title={words('title')}
      meta={meta}
      info={{ what: words('infoWhat'), how: words('infoHow') }}
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
      body={<DomainBars rows={rows.map((row) => row.barRow)} caption={t('caption')} alwaysBars />}
      table={<BarListTable {...list} />}
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
