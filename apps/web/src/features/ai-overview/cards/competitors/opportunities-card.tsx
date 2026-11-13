'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { opportunityRows } from './model/lost-to';
import type { OpportunityRow } from './model/types';
import { useFrameState, type FrameState } from './parts/frame-state';
import { useCardDensity } from '../engines/use-card-density';
import { useCardDrill, useCardExport, type CardDrill } from '../engines/use-card-seams';
import { askedEngines } from '../../data/overview-queries';
import { DRILL_SUPPORT } from '../../drilldown/drill-links';
import { useOverview, useOverviewSummary } from '../../overview-context';
import {
  BarList,
  BarListTable,
  barListCsv,
  type BarListProps,
  type ComparisonRow,
} from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import type { CardProps } from '@/features/layouts';
import { formatDateRange, formatList } from '@/lib/format';
import { cardName, engineLabel } from '@/lib/layouts';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The `rows` option (catalog 4 or 8, default 4). */
const ROW_OPTIONS = [4, 8] as const;
const DEFAULT_ROWS = 4;

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

/**
 * The prompts a row counts, on the Prompts page, or `undefined` where that page cannot filter by the condition yet:
 * a link that dropped the filter would open a list longer than the number it was clicked on.
 */
function hrefOf(drill: CardDrill, row: OpportunityRow): Route | undefined {
  const outcome =
    row.kind === 'named_not_cited' ? 'mentioned_only' : row.kind === 'cited_not_named' ? 'cited_only' : undefined;
  const opportunity =
    row.kind === 'lost_to' ? `lost_to:${row.entityId ?? ''}` : row.kind === 'nobody_named' ? 'nobody_named' : undefined;
  const supported = outcome === undefined ? DRILL_SUPPORT.prompts.opportunity : DRILL_SUPPORT.prompts.outcome;
  return supported ? (drill('prompts', { outcome, opportunity }) ?? undefined) : undefined;
}

/**
 * The `ai.opportunities` card (D-6): prompt counts by documented condition over the engines in scope, each prompt
 * counted once per row however many engines or competitors meet it. No score and no verdict: a count, the number of
 * prompts in scope it is of, and the rule in the tooltip.
 */
export default function OpportunitiesCard({ item, options }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.opportunities');
  const insufficient = useTranslations('common.insufficient');
  const { scope, enabledEngines } = useOverview();
  const density = useCardDensity();
  const drill = useCardDrill();
  // One read: this card draws no comparison, so the previous window is not asked
  const summaryRead = useOverviewSummary(SHAPE_OPTIONS['prompt-rows']);
  const current = summaryRead.data;
  const set = useTrackedSet(current);
  const engines = useMemo(() => askedEngines({ scope, enabledEngines }), [scope, enabledEngines]);
  const result = current !== undefined && set !== null ? opportunityRows(current, engines, set) : null;
  const read = result?.status === 'read' ? result : null;
  const base = useFrameState({
    subject: t('subject'),
    read: summaryRead,
    previous: null,
    previousEmpty: false,
    engine: null,
    situation: result?.status === 'unread' || read?.promptsInScope === 0 ? { kind: 'no_answers' } : { kind: 'ready' },
  });
  // No engine is asked: the read does not run, which is a fact of the scope and not a wait
  const frame: FrameState =
    engines.length === 0
      ? { status: 'empty', empty: { title: t('noEnginesTitle'), reason: t('noEnginesReason') } }
      : base;

  const total = read?.promptsInScope ?? 0;
  const rows: ComparisonRow[] = (read?.rows ?? []).map((row) => {
    const label =
      row.kind === 'lost_to'
        ? t('lostTo', { name: row.name ?? '' })
        : t(
            row.kind === 'named_not_cited'
              ? 'namedNotCited'
              : row.kind === 'cited_not_named'
                ? 'citedNotNamed'
                : 'nobodyNamed',
          );
    const tip =
      row.kind === 'lost_to'
        ? t('tipLostTo', { name: row.name ?? '', min: MIN_OBSERVATIONS })
        : t(
            row.kind === 'named_not_cited'
              ? 'tipNamedNotCited'
              : row.kind === 'cited_not_named'
                ? 'tipCitedNotNamed'
                : 'tipNobodyNamed',
          );
    const value = t('promptsValue', { count: row.prompts });
    const context = t('ofPrompts', { total });
    return {
      id: `${row.kind}:${row.entityId ?? ''}`,
      label,
      own: false,
      value: { kind: 'value', value: row.prompts, valueText: value, contextText: context },
      accessibleText: t('rowText', { label, value, context }),
      tip,
      href: hrefOf(drill, row),
    };
  });
  const limit = rowsOf(options.rows);
  const hidden = Math.max(0, rows.length - limit);
  const list: BarListProps = {
    mode: 'comparison',
    rows,
    caption: t('caption'),
    labelHeader: t('labelHeader'),
    valueHeader: t('valueHeader'),
    contextHeader: t('contextHeader'),
    // A full bar is every prompt in scope
    max: total,
    limit,
    density,
  };
  const csv = barListCsv(list, (count) => insufficient('answers', { count }));
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return {
      id: item.id,
      header: [...csv.header, t('statusHeader')],
      rows: csv.rows.map((row) => [...row, t('statusRead')]),
    };
  });

  const range = current === undefined ? null : formatDateRange(current.window.from, current.window.to);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={240}
      title={cardName(item)}
      meta={range === null || read === null ? null : t('meta', { window: range, count: total, branded: scope.branded })}
      summary={t('summary', {
        total,
        list: formatList(rows.map((row) => `${row.label} ${row.value.kind === 'value' ? row.value.valueText : ''}`)),
      })}
      footnote={
        <>
          <p>{t('scopeNote', { list: formatList(engines.map(engineLabel)) })}</p>
          <p>{t('countOnce')}</p>
          {hidden > 0 ? <p>{t('moreRows', { count: hidden })}</p> : null}
        </>
      }
      body={<BarList {...list} />}
      table={<BarListTable {...list} />}
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
