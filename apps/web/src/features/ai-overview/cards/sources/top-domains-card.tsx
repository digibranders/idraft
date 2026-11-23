'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MIN_DOMAIN_UNITS } from './data/source-filters';
import { useSourceDomains } from './data/source-reads';
import { domainRows, type DomainFigures } from './model/domain-rows';
import { DomainBars, type DomainBarRow } from './parts/domain-bars';
import { useCitationsDrill } from './parts/drill';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { footnoteLines, metaLine } from './parts/source-meta';
import { engineLabel } from '../engines/engine-role';
import { useCardDensity } from '../engines/use-card-density';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../say';
import { BarListTable, barListCsv, type BarListProps, type ComparisonRow } from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { DomainRoleBadge } from '@/components/app/cells/domain-cell';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import type { CardProps } from '@/features/layouts';
import type { DomainRole } from '@/lib/citations/types';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { displayDomain, formatInteger, formatList, formatPercent } from '@/lib/format';

/** The `rows` option (catalog 5, 8 or 10, default 8). */
const ROW_OPTIONS = [5, 8, 10] as const;
const DEFAULT_ROWS = 8;

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

/** The `role` option: `all` is no filter. Rows are narrowed to the role; the totals stay those of the scope. */
const ROLE_FILTERS: Readonly<Record<string, readonly DomainRole[]>> = {
  third_party: ['third_party'],
  competitor: ['competitor'],
};
const NO_ROLES: readonly DomainRole[] = [];
const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const;

/** How many leaders the summary names. */
const SUMMARY_LEADERS = 3;

/**
 * CH-07 and OV-CIT-01: the domains answers cite most, by citation units, one line each (the domain and its role badge,
 * a bar, the share with one decimal), yours in `chart-1`. The units of every platform in scope are one pool (the API
 * aggregates them), so the footnote names the platforms and each row's tooltip and the Table view carry the split. A
 * share over fewer than 4 valid answers has no percent. Flagged citations are left out, as on the headline.
 */
export default function TopDomainsCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.topDomains');
  const words = useTranslations('aiOverview.sourcesTracking.topDomains');
  const say = useTranslations('aiOverview.sources.common') as Say;
  const roleWords = useTranslations('common.domainCell.roles');
  const insufficient = useTranslations('common.insufficient');
  const density = useCardDensity();
  const citations = useCitationsDrill();
  const limit = rowsOf(options.rows);
  const roles = options.role === undefined ? NO_ROLES : (ROLE_FILTERS[options.role] ?? NO_ROLES);
  const reads = useSourceDomains({ limit, roles, subscribed: live });
  const page = reads.current.data;
  const figures = page === undefined ? [] : domainRows(page, null);

  const situation = ((): DataSituation => {
    if (reads.askable !== 'ok') return { kind: reads.askable };
    if (page === undefined) return { kind: 'ready' };
    if (page.meta.answers === 0) return { kind: 'no_answers' };
    if (page.meta.citation_units === 0) return { kind: 'no_citations', answers: page.meta.answers };
    return figures.length === 0 ? { kind: 'none_listed' } : { kind: 'ready' };
  })();
  const state = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: null,
    previousEmpty: false,
    situation,
  });
  // The preview's reason for a scope without a citation, in place of the family's wording of that one case
  const frame =
    state.status === 'empty' && situation.kind === 'no_citations'
      ? { ...state, empty: { title: words('emptyTitle'), reason: words('emptyReason') } }
      : state;

  const engineText = (figure: DomainFigures): string =>
    formatList(
      figure.engines.map((engine) =>
        t('engineUnits', {
          engine: engineLabel(engine.engine_code) ?? engine.engine_code,
          units: formatInteger(engine.citation_units),
        }),
      ),
    );

  const rowOf = (figure: DomainFigures): ComparisonRow & { barRow: DomainBarRow } => {
    const name = visibleUrlText(displayDomain(figure.domain));
    const role = roleWords(ROLE_KEY[figure.role]);
    const href = citations({ tab: 'pages', owner: figure.role }) ?? undefined;
    // A third party is most rows, so it carries no badge; only your site and a competitor are named
    const badge = figure.role === 'third_party' ? undefined : <DomainRoleBadge role={figure.role} />;
    const base = { id: figure.id, label: name, own: figure.own, href, badge };
    const bar = (value: number | null, valueText: string, tip: string): DomainBarRow => ({
      id: figure.id,
      label: name,
      own: figure.own,
      badge,
      value,
      valueText,
      tip,
      href,
    });
    if (figure.state === 'unknown') {
      return {
        ...base,
        value: { kind: 'none' },
        accessibleText: t('rowTextUnknown', { name, role }),
        barRow: bar(null, '', ''),
      };
    }
    if (figure.state === 'thin') {
      return {
        ...base,
        value: { kind: 'thin', answers: figure.validAnswers },
        accessibleText: t('rowTextThin', { name, role, count: figure.validAnswers }),
        barRow: bar(null, insufficient('answers', { count: figure.validAnswers }), ''),
      };
    }
    const value = formatPercent(figure.share.value);
    const counts = t('unitsOf', { units: formatInteger(figure.units), total: figure.share.total });
    const tip = [
      t('rowTip', { units: figure.units, answers: figure.answers, prompts: figure.prompts }),
      counts,
      figure.engines.length === 0 ? null : t('tipEngines', { list: engineText(figure) }),
    ]
      .filter((part) => part !== null)
      .join('. ');
    return {
      ...base,
      value: { kind: 'value', value: figure.share.value ?? 0, valueText: value, contextText: counts },
      accessibleText: t('rowText', { name, role, value, counts, answers: figure.answers }),
      tip,
      barRow: bar(figure.share.value, value, tip),
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
  const barsCsv = barListCsv(list, (count) => insufficient('answers', { count }));
  const csv: CsvTable = {
    header: [...barsCsv.header, t('roleHeader'), t('enginesHeader')],
    rows: barsCsv.rows.map((row, index) => {
      const figure = figures[index];
      return [
        ...row,
        figure === undefined ? null : safeText(roleWords(ROLE_KEY[figure.role])),
        figure === undefined ? null : engineText(figure),
      ];
    }),
  };
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return { id: item.id, header: csv.header, rows: csv.rows };
  });

  const shown = frame.status === 'ready' || frame.status === 'refetching';
  const hidden = page === undefined ? 0 : page.page.total - figures.length;
  const leaders = formatList(
    rows
      .slice(0, SUMMARY_LEADERS)
      .map((row) => (row.value.kind === 'value' ? `${row.label} ${row.value.valueText}` : row.label)),
  );
  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      height={280}
      title={t('title')}
      meta={page === undefined || !shown ? null : words('meta', { units: page.meta.citation_units })}
      info={{ what: words('infoWhat'), how: words('infoHow') }}
      summary={
        page === undefined || rows.length === 0
          ? t('summaryNone')
          : t('summary', { units: page.meta.citation_units, answers: page.meta.answers, list: leaders })
      }
      footnote={
        page === undefined ? undefined : (
          <div className="flex flex-col gap-1">
            <p>{metaLine(page.meta, say)}</p>
            {footnoteLines(page.meta, say, MIN_DOMAIN_UNITS).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {hidden > 0 ? <p>{t('moreRows', { count: hidden })}</p> : null}
          </div>
        )
      }
      body={<DomainBars rows={rows.map((row) => row.barRow)} caption={t('caption')} />}
      table={<BarListTable {...list} />}
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
