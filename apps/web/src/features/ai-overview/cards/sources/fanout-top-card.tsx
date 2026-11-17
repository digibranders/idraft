'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useFanoutRows } from './data/fanout-reads';
import { fanoutFigures, fanoutStanding, type FanoutFigures, type FanoutStanding } from './model/fanout-model';
import { FanoutTable, type FanoutTableRow } from './parts/fanout-table';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { engineNames } from './parts/source-meta';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { engineLabel } from '../engines/engine-role';
import { useCardDensity } from '../engines/use-card-density';
import { useCardExport } from '../engines/use-card-seams';
import { BarListTable, barListCsv, type BarListProps, type ComparisonRow } from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import { Badge } from '@/components/ui/badge';
import type { CardProps } from '@/features/layouts';
import type { EngineCode } from '@/lib/api/types';
import { formatInteger, formatList, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The `rows` option (catalog 5 or 10, default 5). */
const ROW_OPTIONS = [5, 10] as const;
const DEFAULT_ROWS = 5;

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

/** How many leaders the summary names. */
const SUMMARY_LEADERS = 3;

const NO_ENGINES: readonly EngineCode[] = [];

/** The situation of the frame from what the scope allows and what the read says. */
function situationOf(
  askable: ReturnType<typeof useFanoutRows>['askable'],
  without: readonly EngineCode[],
  standing: FanoutStanding | null,
): DataSituation {
  if (askable === 'no_fanout') return { kind: 'no_fanout', engines: formatList(engineNames(without)) };
  if (askable !== 'ok') return { kind: askable };
  if (standing === null) return { kind: 'ready' };
  switch (standing.kind) {
    case 'not_exposed':
      return { kind: 'no_fanout', engines: formatList(engineNames(standing.without)) };
    case 'no_answers':
      return { kind: 'no_answers' };
    case 'none_issued':
      return { kind: 'none_issued', answers: standing.answers };
    case 'none_listed':
      return { kind: 'queries_under_min', min: standing.min };
    case 'read':
      return { kind: 'ready' };
  }
}

/**
 * CH-17 and OV-TRF-05: the searches the platforms that show them ran to build their answers, as a table: the query,
 * the answers that ran it, its prompts and the domain cited most, over every valid answer in scope on those platforms
 * (`meta.answers`). The share of each query is in the Table view and the export, with its counts. An engine that
 * does not show its searches is not exposed, never 0: the card says which, and says so alone when no engine in scope
 * shows them. A search whose answers cited a domain of yours carries the words "Own domain cited" (an association:
 * which search found which source is not stored). The search text and the domains are provider text: React text
 * only. No row links anywhere: the Fan-out page is not live.
 */
export default function FanoutTopCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.fanout');
  const words = useTranslations('aiOverview.sourcesTracking.fanout');
  const unavailable = useScopeUnavailable(words('title'));
  const insufficient = useTranslations('common.insufficient');
  const density = useCardDensity();
  const reads = useFanoutRows({ limit: rowsOf(options.rows), subscribed: live });
  const page = reads.current.data;
  const figures = page === undefined ? [] : fanoutFigures(page);
  const standing = page === undefined ? null : fanoutStanding(page);

  const situation = situationOf(reads.askable, reads.without, standing);
  const state = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: null,
    previousEmpty: false,
    situation,
  });
  // A platform that does not show its searches: the reason of every card that has nothing for the scope
  const frame = state.status === 'empty' && situation.kind === 'no_fanout' ? { ...state, empty: unavailable } : state;

  const citedText = (figure: FanoutFigures): string =>
    formatList(
      figure.cited.map((domain) =>
        t('citedDomain', { domain: visibleUrlText(domain.registrable_domain), units: domain.citation_units }),
      ),
    );
  const engineName = (figure: FanoutFigures): string => engineLabel(figure.engine) ?? figure.engine;

  const rowOf = (figure: FanoutFigures): ComparisonRow => {
    const name = visibleUrlText(figure.text);
    const base = {
      id: figure.id,
      label: name,
      own: false,
      badge: figure.ownCited ? <Badge>{t('ownCited')}</Badge> : undefined,
    };
    if (figure.share === null) {
      return { ...base, value: { kind: 'none' }, accessibleText: t('rowTextNone', { text: name }) };
    }
    if (figure.answers < MIN_OBSERVATIONS) {
      return {
        ...base,
        value: { kind: 'thin', answers: figure.answers },
        accessibleText: t('rowTextThin', { text: name, count: figure.answers }),
      };
    }
    const issued = t('issuedIn', { count: formatInteger(figure.observations), total: figure.answers });
    const tip = [
      t('tipEngine', { engine: engineName(figure) }),
      t('tipPrompts', { prompts: figure.prompts }),
      figure.cited.length === 0 ? null : t('tipCited', { list: citedText(figure) }),
      t('tipAssociation'),
    ]
      .filter((part) => part !== null)
      .join('. ');
    return {
      ...base,
      value: { kind: 'value', value: figure.share, valueText: formatPercent(figure.share), contextText: issued },
      accessibleText: t('rowText', {
        text: name,
        value: formatPercent(figure.share),
        count: formatInteger(figure.observations),
        total: figure.answers,
        prompts: figure.prompts,
        own: String(figure.ownCited),
      }),
      tip,
    };
  };
  const rows = figures.map(rowOf);
  const tableRows = figures.map((figure): FanoutTableRow => ({
    id: figure.id,
    query: visibleUrlText(figure.text),
    answers: formatInteger(figure.observations),
    prompts: formatInteger(figure.prompts),
    topCited: visibleUrlText(figure.cited[0]?.registrable_domain ?? ''),
    tip: [
      t('tipEngine', { engine: engineName(figure) }),
      figure.cited.length === 0 ? null : t('tipCited', { list: citedText(figure) }),
      t('tipAssociation'),
    ]
      .filter((part) => part !== null)
      .join('. '),
  }));

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
  const csv = barListCsv(list, (count) => insufficient('answers', { count }));
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return {
      id: item.id,
      header: [...csv.header, t('promptsHeader'), t('engineHeader'), t('ownHeader'), t('citedHeader')],
      rows: csv.rows.map((row, index) => {
        const figure = figures[index];
        return [
          ...row,
          figure?.prompts ?? null,
          figure === undefined ? null : engineName(figure),
          figure?.ownCited === true ? t('ownCited') : null,
          figure === undefined ? null : citedText(figure),
        ];
      }),
    };
  });

  const shown = frame.status === 'ready' || frame.status === 'refetching';
  const shownBy =
    page === undefined ? [] : page.meta.engine_codes.filter((code) => !page.meta.engines_without_fanout.includes(code));
  const meta =
    page === undefined || !shown
      ? null
      : words('meta', {
          engines: formatList(engineNames(shownBy)),
          withFanout: page.meta.answers_with_fanout,
          answers: page.meta.answers,
        });
  const leaders = formatList(
    rows
      .slice(0, SUMMARY_LEADERS)
      .map((row) => (row.value.kind === 'value' ? `${row.label} ${row.value.valueText}` : row.label)),
  );
  const notExposed = engineNames([
    ...new Set([...(page?.meta.engines_without_fanout ?? NO_ENGINES), ...reads.without]),
  ]);
  const hidden = page === undefined || standing?.kind !== 'read' ? 0 : standing.total - standing.listed;
  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      height={240}
      title={words('title')}
      info={{ what: words('infoWhat'), how: words('infoHow') }}
      meta={meta}
      summary={
        page === undefined || rows.length === 0
          ? t('summaryNone')
          : t('summary', {
              withFanout: formatInteger(page.meta.answers_with_fanout),
              answers: page.meta.answers,
              list: leaders,
            })
      }
      footnote={
        page === undefined || standing?.kind !== 'read' ? undefined : (
          <div className="flex flex-col gap-1">
            <p>{t('footnoteIssued', { withFanout: formatInteger(standing.withFanout), answers: standing.answers })}</p>
            {notExposed.length === 0 ? null : <p>{t('footnoteWithout', { engines: formatList(notExposed) })}</p>}
            {standing.truncated === 0 ? null : <p>{t('footnoteTruncated', { count: standing.truncated })}</p>}
            <p>{t('footnoteMin', { min: page.meta.min_support })}</p>
            {hidden > 0 ? <p>{t('moreRows', { count: hidden })}</p> : null}
          </div>
        )
      }
      body={
        <FanoutTable
          rows={tableRows}
          caption={words('caption')}
          headers={{
            query: words('queryHeader'),
            answers: words('answersHeader'),
            prompts: words('promptsHeader'),
            topCited: words('topCitedHeader'),
          }}
        />
      }
      table={<BarListTable {...list} />}
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
