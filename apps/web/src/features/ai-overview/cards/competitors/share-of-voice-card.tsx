'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useCompetitorReads, useTrackedSet } from './data/use-competitor-reads';
import { entityTotals, previousEntityTotals } from './model/entity-totals';
import type { EntityFigures, EntityTotals, TrackedSet } from './model/types';
import { useCardEngine } from './parts/card-engine';
import { useFrameState, type DataSituation } from './parts/frame-state';
import { TrackedFootnote } from './parts/tracked-footnote';
import { useCardDensity } from '../engines/use-card-density';
import { useCardDrill, useCardExport } from '../engines/use-card-seams';
import { useOverview } from '../../overview-context';
import {
  BarList,
  BarListTable,
  barListCsv,
  type BarListProps,
  type ComparisonRow,
} from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { MetricInfo } from '@/components/app/metric/metric-info';
import type { CardProps } from '@/features/layouts';
import { METHODOLOGY_HREF } from '@/lib/citations/methodology';
import { formatDateRange, formatInteger, formatList, formatPercent, formatPointsDelta } from '@/lib/format';

/** The `rows` option: the brands drawn before the own brand is added (catalog 5 or 10, default 10). */
const ROW_OPTIONS = [5, 10] as const;
const DEFAULT_ROWS = 10;

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

/** What the answers say, once read: the first of these that holds, so nothing is drawn from too little. */
function situationOf(totals: EntityTotals | null, set: TrackedSet | null): DataSituation {
  if (totals === null || set === null) return { kind: 'ready' };
  if (totals.status === 'unread' || totals.validAnswers === 0) return { kind: 'no_answers' };
  if (!set.entities.some((entity) => entity.role === 'competitor')) return { kind: 'no_competitor' };
  if (totals.state !== 'ok') return { kind: 'too_few', answers: totals.answersNamingTracked };
  return { kind: 'ready' };
}

/** Highest share first; a brand with no share is last; equal shares keep the order of the tracked set. */
const byShare = (a: EntityFigures, b: EntityFigures): number => (b.share.value ?? -1) - (a.share.value ?? -1);

/**
 * CH-02 and WB-OV-08: the brands ranked by share of voice on one engine, you in `chart-1`. One formula (an answer
 * gives 1 over the tracked brands it names), one denominator printed in the meta line, and beside every percent
 * the count of answers that name the brand. A share change is never coloured: share of voice has no test.
 */
export default function ShareOfVoiceCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.shareOfVoice');
  const insufficient = useTranslations('common.insufficient');
  const { scope } = useOverview();
  const engine = useCardEngine(options);
  const density = useCardDensity();
  const drill = useCardDrill();
  const reads = useCompetitorReads('totals', { subscribed: live });
  const current = reads.current.data;
  const set = useTrackedSet(current);
  const totals = current !== undefined && set !== null ? entityTotals(current, engine.code, set) : null;
  const previousSummary = reads.paired ? (reads.previous?.data ?? null) : null;
  const before = set === null ? null : previousEntityTotals(previousSummary, engine.code, set);
  const previousEmpty = reads.previous?.status === 'ready' && before === null;
  const situation = situationOf(totals, set);
  const frame = useFrameState({
    subject: t('subject'),
    read: reads.current,
    previous: reads.previous,
    previousEmpty,
    engine,
    situation,
  });

  const figures = totals?.status === 'read' && totals.state === 'ok' ? [...totals.entities].sort(byShare) : [];
  const answers = totals?.status === 'read' ? totals.answersNamingTracked : 0;
  const rowOf = (figure: EntityFigures): ComparisonRow => {
    const { entity, share, mention } = figure;
    const isOwn = entity.role === 'own';
    // A row is plain text where there is no page to open
    const href =
      (isOwn
        ? drill('prompts', { engine: engine.code, metric: 'sov' })
        : drill('competitors', { engine: engine.code })) ?? undefined;
    const base = { id: entity.entityId, label: entity.name, own: isOwn, href };
    if (share.state !== 'ok' || share.value === null) {
      return { ...base, value: { kind: 'none' }, accessibleText: t('rowTextUnknown', { name: entity.name }) };
    }
    const value = formatPercent(share.value, { decimals: 0 });
    const named = mention.n > 0 ? t('named', { k: formatInteger(mention.k), n: mention.n }) : null;
    const earlier = before?.entities.find((candidate) => candidate.entity.entityId === entity.entityId)?.share.value;
    const change = earlier === null || earlier === undefined ? null : share.value - earlier;
    return {
      ...base,
      value: { kind: 'value', value: share.value, valueText: value, contextText: named },
      accessibleText:
        named === null
          ? t('rowTextNoCount', { name: entity.name, value })
          : t('rowText', { name: entity.name, value, named }),
      tip: t('rowTip', { value, count: share.answers }),
      delta:
        change === null
          ? undefined
          : {
              input: { value: change, unit: 'points', polarity: 'higher_is_better', isDetectable: null },
              test: 'interim',
              text: formatPointsDelta(change),
            },
    };
  };
  const tableRows = figures.map(rowOf);
  const limit = rowsOf(options.rows);
  const top = tableRows.slice(0, limit);
  const ownRow = tableRows.find((row) => row.own);
  // The own brand is always drawn: when it ranks below the top rows it follows them
  const ownExtra = ownRow !== undefined && !top.includes(ownRow) ? ownRow : null;
  const shown = ownExtra === null ? top : [...top, ownExtra];
  const listRows = [...shown, ...tableRows.filter((row) => !shown.includes(row))];
  const hidden = tableRows.length - shown.length;

  const list: BarListProps = {
    mode: 'comparison',
    rows: listRows,
    caption: t('caption', { engine: engine.label }),
    labelHeader: t('labelHeader'),
    valueHeader: t('valueHeader'),
    contextHeader: t('contextHeader'),
    changeHeader: t('changeHeader'),
    limit: shown.length,
    density,
  };
  const tableProps: BarListProps = { ...list, rows: tableRows };
  const csv = barListCsv(tableProps, (count) => insufficient('answers', { count }));
  useCardExport(item.id, () => {
    if (frame.status === 'loading' || frame.status === 'error') return null;
    return {
      id: item.id,
      header: [...csv.header, t('statusHeader')],
      rows: csv.rows.map((row, index) => [
        ...row,
        tableRows[index]?.value.kind === 'value' ? t('statusRead') : t('statusUnknown'),
      ]),
    };
  });

  const range = current === undefined ? null : formatDateRange(current.window.from, current.window.to);
  const leaders = formatList(
    tableRows
      .slice(0, 3)
      .map((row) => (row.value.kind === 'value' ? `${row.label} ${row.value.valueText}` : row.label)),
  );
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={280}
      title={t('title', { engine: engine.label })}
      meta={
        range === null || totals?.status !== 'read'
          ? null
          : t('meta', { window: range, count: answers, branded: scope.branded })
      }
      summary={t('summary', { engine: engine.label, count: answers, list: leaders })}
      footnote={
        set === null ? undefined : (
          <>
            <TrackedFootnote set={set} />
            {hidden > 0 ? <p>{t('moreRows', { count: hidden })}</p> : null}
          </>
        )
      }
      body={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 type-meta">
            <EngineLogo engine={engine.code} name={engine.label} />
            <span>{t('rankedBy')}</span>
            <MetricInfo
              name={t('infoName')}
              definition={t('infoDefinition')}
              formula={t('infoFormula')}
              denominatorText={t('infoSample', { count: answers })}
              methodologyHref={METHODOLOGY_HREF}
            />
          </div>
          <BarList {...list} />
        </div>
      }
      table={<BarListTable {...tableProps} />}
      menu={{ fileName: t('fileName', { engine: engine.code }), csv }}
      {...frame}
    />
  );
}
