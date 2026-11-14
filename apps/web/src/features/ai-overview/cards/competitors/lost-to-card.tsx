'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { SHAPE_OPTIONS, useTrackedSet } from './data/use-competitor-reads';
import { lostToRows } from './model/lost-to';
import type { LostToRead, TrackedSet } from './model/types';
import { useCardEngine } from './parts/card-engine';
import { frameSummary, useFrameState, type DataSituation, type FrameState } from './parts/frame-state';
import { useCardDensity } from '../engines/use-card-density';
import { useCardDrill, useCardExport } from '../engines/use-card-seams';
import { useOverview, useOverviewSummary } from '../../overview-context';
import {
  BarList,
  BarListTable,
  barListCsv,
  type BarListProps,
  type ComparisonRow,
} from '@/components/app/chart/bar-list';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { CardProps } from '@/features/layouts';
import { formatDateRange, formatList } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The `rows` option (catalog 5 or 10, default 5). */
const ROW_OPTIONS = [5, 10] as const;
const DEFAULT_ROWS = 5;

function rowsOf(option: string | undefined): number {
  const rows = Number(option);
  return ROW_OPTIONS.find((candidate) => candidate === rows) ?? DEFAULT_ROWS;
}

function situationOf(result: LostToRead | null, set: TrackedSet | null): DataSituation {
  if (result === null || set === null) return { kind: 'ready' };
  if (result.status === 'unread') return { kind: 'no_answers' };
  if (!set.entities.some((entity) => entity.role === 'competitor')) return { kind: 'no_competitor' };
  return { kind: 'ready' };
}

/**
 * CH-05: the competitors that take prompts from the own brand on one engine. A prompt is lost to a competitor when
 * it is named in an answer, you are named in none of the prompt's answers on this engine, and the prompt has 4 or
 * more valid answers (D-3: the rule of a prompt, so a drill count can be larger). The bar is the share of those
 * prompts, and prompts with too few answers are counted in the footnote, never hidden.
 */
export default function LostToCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.lostTo');
  const insufficient = useTranslations('common.insufficient');
  const { scope } = useOverview();
  const engine = useCardEngine(options);
  const density = useCardDensity();
  const drill = useCardDrill();
  // One read: this card draws no comparison, so the previous window is not asked
  const summaryRead = useOverviewSummary({ ...SHAPE_OPTIONS['prompt-rows'], subscribed: live });
  const current = summaryRead.data;
  const set = useTrackedSet(current);
  const result = current !== undefined && set !== null ? lostToRows(current, engine.code, set) : null;
  const read = result?.status === 'read' ? result : null;
  const base = useFrameState({
    subject: t('subject'),
    read: summaryRead,
    // The previous window is not drawn here: nothing of it can be missing from this card
    previous: null,
    previousEmpty: false,
    engine,
    situation: situationOf(result, set),
  });
  const enough = read?.promptsWithEnoughAnswers ?? 0;
  const tooFew = read?.promptsWithTooFewAnswers ?? 0;
  // Prompts exist and none has 4 answers: nothing can be lost yet, which is not the same as nothing being lost
  const frame: FrameState =
    (base.status === 'ready' || base.status === 'refetching') && read !== null && enough === 0
      ? {
          status: 'empty',
          empty: {
            title: t('notEnoughTitle'),
            reason: t('notEnoughReason', { min: MIN_OBSERVATIONS, engine: engine.label }),
          },
        }
      : base;

  const rows: ComparisonRow[] = (read?.rows ?? []).map((row) => {
    const value = t('promptsValue', { count: row.prompts });
    const context = t('ofPrompts', { total: enough });
    return {
      id: row.entityId,
      label: row.name,
      own: false,
      value: { kind: 'value', value: row.prompts, valueText: value, contextText: context },
      accessibleText: t('rowText', { name: row.name, value, context }),
      tip: t('rowTip', { name: row.name, min: MIN_OBSERVATIONS }),
      // A row is plain text where there is no page to open
      href: drill('competitors', { engine: engine.code }) ?? undefined,
    };
  });
  const limit = rowsOf(options.rows);
  const hidden = Math.max(0, rows.length - limit);
  const list: BarListProps = {
    mode: 'comparison',
    rows,
    caption: t('caption', { engine: engine.label }),
    labelHeader: t('labelHeader'),
    valueHeader: t('valueHeader'),
    contextHeader: t('contextHeader'),
    // The bar is the share of the prompts that could be lost, so a full bar is every one of them
    max: enough,
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

  const notes = [
    tooFew > 0 ? t('tooFewNote', { count: tooFew, min: MIN_OBSERVATIONS }) : null,
    hidden > 0 ? t('moreRows', { count: hidden }) : null,
  ].filter((note): note is string => note !== null);
  const range = current === undefined ? null : formatDateRange(current.window.from, current.window.to);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={240}
      title={t('title', { engine: engine.label })}
      meta={
        range === null || read === null
          ? null
          : t('meta', { window: range, count: enough, min: MIN_OBSERVATIONS, branded: scope.branded })
      }
      summary={frameSummary(
        frame,
        rows.length === 0
          ? t('summaryNone', { engine: engine.label, total: enough, min: MIN_OBSERVATIONS })
          : t('summary', {
              engine: engine.label,
              total: enough,
              min: MIN_OBSERVATIONS,
              list: formatList(
                rows.slice(0, 3).map((row) => `${row.label} ${row.value.kind === 'value' ? row.value.valueText : ''}`),
              ),
            }),
      )}
      footnote={
        notes.length === 0 ? undefined : (
          <>
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </>
        )
      }
      body={
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 type-meta">
            <EngineLogo engine={engine.code} name={engine.label} />
          </div>
          {rows.length === 0 ? (
            <div className="flex flex-col gap-1">
              <p className="type-body-strong">{t('noneTitle', { engine: engine.label })}</p>
              <p className="type-body text-foreground-secondary">
                {t('noneReason', { total: enough, min: MIN_OBSERVATIONS })}
              </p>
            </div>
          ) : (
            <BarList {...list} />
          )}
        </div>
      }
      table={<BarListTable {...list} />}
      menu={{ fileName: t('fileName', { engine: engine.code }), csv }}
      {...frame}
    />
  );
}
