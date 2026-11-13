'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { MIN_DOMAIN_UNITS } from './data/source-filters';
import { useSourceDomains } from './data/source-reads';
import { domainRows, type DomainFigures } from './model/domain-rows';
import { useCitationsDrill } from './parts/drill';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { footnoteLines, metaLine } from './parts/source-meta';
import { engineLabel } from '../engines/engine-role';
import { useCardDensity } from '../engines/use-card-density';
import { useCardExport } from '../engines/use-card-seams';
import type { Say } from '../../numbers/number-model';
import {
  BarList,
  BarListTable,
  barListCsv,
  type BarListProps,
  type ComparisonRow,
} from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { DomainRoleBadge } from '@/components/app/cells/domain-cell';
import { visibleUrlText } from '@/components/app/cells/visible-text';
import { MetricInfo } from '@/components/app/metric/metric-info';
import { SampleCount } from '@/components/app/metric/sample-count';
import type { CardProps } from '@/features/layouts';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import type { DomainRole } from '@/lib/citations/types';
import { displayDomain, formatInteger, formatList, formatPercent, formatPointsDelta } from '@/lib/format';

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
 * CH-07: the domains answers cite most, by citation units, yours in `chart-1`. The units of every engine in scope are
 * one pool (the API aggregates them), so the meta line and the footnote name the engines and each row's tooltip and
 * the Table view carry the split. Beside every percent are its units of the scope's total. A change of the share is
 * never coloured: the API sends no detectability for it yet. Flagged citations are left out, as on the strip.
 */
export default function TopDomainsCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sources.topDomains');
  const say = useTranslations('aiOverview.sources.common') as Say;
  const roleWords = useTranslations('common.domainCell.roles');
  const insufficient = useTranslations('common.insufficient');
  const density = useCardDensity();
  const citations = useCitationsDrill();
  const limit = rowsOf(options.rows);
  const roles = options.role === undefined ? NO_ROLES : (ROLE_FILTERS[options.role] ?? NO_ROLES);
  const reads = useSourceDomains({ limit, roles, compare: true });
  const page = reads.current.data;
  const previousMeta = reads.previous?.data ?? null;
  const figures = page === undefined ? [] : domainRows(page, previousMeta);
  const previousEmpty = reads.compared && page !== undefined && (page.meta.previous_answers ?? 0) === 0;

  const situation = ((): DataSituation => {
    if (reads.askable !== 'ok') return { kind: reads.askable };
    if (page === undefined) return { kind: 'ready' };
    if (page.meta.answers === 0) return { kind: 'no_answers' };
    if (page.meta.citation_units === 0) return { kind: 'no_citations', answers: page.meta.answers };
    return figures.length === 0 ? { kind: 'none_listed' } : { kind: 'ready' };
  })();
  const frame = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: reads.previous,
    previousEmpty,
    situation,
  });

  // A role filter on the card is the filter of the page it opens, so the list behind the inspector matches
  const roleFilter = roles[0];
  const engineText = (figure: DomainFigures): string =>
    formatList(
      figure.engines.map((engine) =>
        t('engineUnits', {
          engine: engineLabel(engine.engine_code) ?? engine.engine_code,
          units: formatInteger(engine.citation_units),
        }),
      ),
    );

  const rowOf = (figure: DomainFigures): ComparisonRow => {
    const name = visibleUrlText(displayDomain(figure.domain));
    const role = roleWords(ROLE_KEY[figure.role]);
    const href =
      citations({ tab: 'domains', domain: figure.domain, ...(roleFilter === undefined ? {} : { role: roleFilter }) }) ??
      undefined;
    const base = { id: figure.id, label: name, own: figure.own, href, badge: <DomainRoleBadge role={figure.role} /> };
    if (figure.state === 'unknown') {
      return { ...base, value: { kind: 'none' }, accessibleText: t('rowTextUnknown', { name, role }) };
    }
    if (figure.state === 'thin') {
      return {
        ...base,
        value: { kind: 'thin', answers: figure.validAnswers },
        accessibleText: t('rowTextThin', { name, role, count: figure.validAnswers }),
      };
    }
    const value = formatPercent(figure.share.value);
    const counts = t('unitsOf', { units: formatInteger(figure.units), total: figure.share.total });
    const tip = [
      t('rowTip', { units: figure.units, answers: figure.answers, prompts: figure.prompts }),
      figure.previousUnits === null ? null : t('tipPrevious', { units: figure.previousUnits }),
      figure.engines.length === 0 ? null : t('tipEngines', { list: engineText(figure) }),
    ]
      .filter((part) => part !== null)
      .join('. ');
    return {
      ...base,
      value: { kind: 'value', value: figure.share.value ?? 0, valueText: value, contextText: counts },
      accessibleText: t('rowText', { name, role, value, counts, answers: figure.answers }),
      tip,
      delta:
        figure.change === null
          ? undefined
          : {
              input: { value: figure.change.delta, unit: 'points', polarity: 'higher_is_better', isDetectable: null },
              test: 'interim',
              text: formatPointsDelta(figure.change.delta),
            },
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
    changeHeader: t('changeHeader'),
    limit: rows.length,
    density,
  };
  const csv = barListCsv(list, (count) => insufficient('answers', { count }));
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return {
      id: item.id,
      header: [...csv.header, t('roleHeader'), t('enginesHeader')],
      rows: csv.rows.map((row, index) => {
        const figure = figures[index];
        return [
          ...row,
          figure === undefined ? null : roleWords(ROLE_KEY[figure.role]),
          figure === undefined ? null : engineText(figure),
        ];
      }),
    };
  });

  const shown = frame.status === 'ready' || frame.status === 'refetching';
  const meta = page === undefined || !shown ? null : metaLine(page.meta, say);
  const hidden = page === undefined ? 0 : page.page.total - figures.length;
  const leaders = formatList(
    rows
      .slice(0, SUMMARY_LEADERS)
      .map((row) => (row.value.kind === 'value' ? `${row.label} ${row.value.valueText}` : row.label)),
  );
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={280}
      title={t('title')}
      meta={meta}
      summary={
        page === undefined || rows.length === 0
          ? t('summaryNone')
          : t('summary', { units: page.meta.citation_units, answers: page.meta.answers, list: leaders })
      }
      footnote={
        page === undefined ? undefined : (
          <div className="flex flex-col gap-1">
            {footnoteLines(page.meta, say, MIN_DOMAIN_UNITS).map((line) => (
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
          {page === undefined ? null : (
            <p className="flex flex-wrap items-center gap-x-1 type-meta text-foreground-secondary">
              <span>{t('citing')}</span>
              <SampleCount k={page.meta.answers_citing} n={page.meta.answers} noun="answers" />
            </p>
          )}
          <BarList {...list} />
        </div>
      }
      table={<BarListTable {...list} />}
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
