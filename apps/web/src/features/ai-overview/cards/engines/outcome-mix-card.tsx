'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useAnswersFrame } from './answers-frame';
import { useCardMeta } from './card-meta';
import { engineLabel } from './engine-role';
import { OUTCOME_PARTS, outcomeMix, type EngineOutcome, type OutcomePart } from './outcome-model';
import { percentNumber } from './percent';
import { useCardData } from './use-card-data';
import { useCardDensity } from './use-card-density';
import { useCardDrill, useCardExport } from './use-card-seams';
import { DRILL_SUPPORT } from '../../drilldown/drill-links';
import type { ExportBlock } from '../../export/export-model';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import {
  StackedShareBar,
  StackedShareTable,
  stackedShareCsv,
  type ShareColor,
  type ShareRow,
  type ShareSegment,
  type StackedShareBarProps,
} from '@/components/app/chart/stacked-share-bar';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import type { CardProps } from '@/features/layouts';
import type { CsvCell } from '@/lib/csv/csv-write';
import { formatList, formatPercent, formatSampleCount } from '@/lib/format';

const PART_WORDS = {
  mentioned_and_cited: 'partMentionedAndCited',
  mentioned_only: 'partMentionedOnly',
  cited_only: 'partCitedOnly',
  neither: 'partNeither',
} as const satisfies Record<OutcomePart, string>;

/** Never `chart-1`: that colour is the own brand's, and an outcome is a category (DS 15 section 5.2). */
const PART_COLORS: Readonly<Record<OutcomePart, ShareColor>> = {
  mentioned_and_cited: 'chart-3',
  mentioned_only: 'chart-4',
  cited_only: 'chart-5',
  neither: 'chart-other',
};

const FILE_NAME = 'named-and-cited-by-engine';
const EXPORT_HEADER = ['engine', 'outcome', 'share_percent', 'k', 'n', 'prompts', 'status'] as const;

/** CH-03: how the answers of each engine split between named and cited, named only, cited only and neither. */
export default function OutcomeMixCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.outcomeMix');
  const common = useTranslations('aiOverview.engines.common');
  const insufficient = useTranslations('common.insufficient');
  const density = useCardDensity();
  const drill = useCardDrill();
  const data = useCardData({ previous: 'none', subscribed: live });
  const metaOf = useCardMeta();
  const title = t('title');
  const frame = useAnswersFrame(data, title, (key, values) => t(key, values));

  const prompts = data.current.data?.prompts;
  const mixes = useMemo(() => (prompts === undefined ? [] : outcomeMix(prompts, data.asked)), [prompts, data.asked]);
  const engineName = (code: string): string => engineLabel(code) ?? common('unknownEngine');

  const segments: ShareSegment[] = OUTCOME_PARTS.map((part) => ({
    id: part,
    name: t(PART_WORDS[part]),
    color: PART_COLORS[part],
  }));

  const rowOf = (mix: EngineOutcome): ShareRow => {
    // A destination that cannot filter by outcome would show other prompts than the ones clicked: plain text
    const href = DRILL_SUPPORT.prompts.outcome ? drill('prompts', { engine: mix.engineCode }) : null;
    const base = {
      id: mix.engineCode,
      label: engineName(mix.engineCode),
      // The mark alone: the label carries the name
      icon: <EngineLogo engine={mix.engineCode} name="" />,
      ...(href === null ? {} : { href }),
    };
    if (mix.state === 'insufficient') {
      return { ...base, denominatorText: '', value: { kind: 'thin', answers: mix.answers } };
    }
    if (mix.state === 'none') {
      return { ...base, denominatorText: '', value: { kind: 'none', text: t('noValidAnswers') } };
    }
    return {
      ...base,
      denominatorText: t('denominator', { answers: mix.answers, prompts: mix.prompts }),
      value: {
        kind: 'shares',
        cells: mix.shares.map((entry) => ({
          segmentId: entry.part,
          share: entry.share,
          shareText: formatPercent(entry.share),
          countText: t('counts', { counts: formatSampleCount(entry.k, mix.answers), n: mix.answers }),
        })),
      },
    };
  };

  const bar = (patterns: boolean): StackedShareBarProps => ({
    caption: t('caption'),
    segments,
    rows: mixes.map(rowOf),
    segmentHeader: t('segmentHeader'),
    patterns,
    density,
  });

  const summary = [
    t('summaryIntro'),
    ...mixes.map((mix) => {
      const engine = engineName(mix.engineCode);
      if (mix.state === 'none') return t('summaryNone', { engine });
      if (mix.state === 'insufficient') return t('summaryThin', { engine, count: mix.answers });
      const parts = formatList(
        mix.shares.map((entry) =>
          t('summaryPart', { name: t(PART_WORDS[entry.part]), share: formatPercent(entry.share) }),
        ),
      );
      return t('summaryEngine', { engine, parts });
    }),
  ].join(' ');

  useCardExport(item.id, (): ExportBlock | null => {
    if (prompts === undefined) return null;
    const rows = mixes.flatMap((mix): CsvCell[][] =>
      OUTCOME_PARTS.map((part): CsvCell[] => {
        const label = engineName(mix.engineCode);
        const outcome = t(PART_WORDS[part]);
        if (mix.state === 'ok') {
          const entry = mix.shares.find((share) => share.part === part);
          const share = entry === undefined ? null : percentNumber(entry.share);
          return [label, outcome, share, entry?.k ?? null, mix.answers, mix.prompts, 'ok'];
        }
        // No share and no count: the status says why, and an unknown is never a 0
        return [label, outcome, null, null, mix.state === 'insufficient' ? mix.answers : null, null, mix.state];
      }),
    );
    return { id: item.id, header: EXPORT_HEADER, rows };
  });

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={metaOf({
        range: data.scope.range,
        prompts: data.aggregates?.promptCount ?? null,
        answers: null,
        branded: data.scope.branded,
        promptWeighted: true,
      })}
      footnote={t('footnote')}
      height={180}
      summary={summary}
      patterns
      menu={{
        fileName: FILE_NAME,
        csv: stackedShareCsv(bar(false), (answers) => insufficient('answers', { count: answers })),
      }}
      body={({ patterns }) => <StackedShareBar {...bar(patterns)} />}
      table={<StackedShareTable {...bar(false)} />}
      {...frame}
    />
  );
}
