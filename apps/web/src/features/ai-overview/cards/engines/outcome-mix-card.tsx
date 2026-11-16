'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { engineLabel } from './engine-role';
import { OutcomeBars, type OutcomeRow, type OutcomeSegment, type OutcomeToken } from './outcome-bars';
import { OUTCOME_PARTS, outcomeMix, type EngineOutcome, type OutcomePart } from './outcome-model';
import { percentNumber } from './percent';
import { useCardData } from './use-card-data';
import { useCardExport } from './use-card-seams';
import { useFrameState } from './use-frame-state';
import { singlePlatform } from '../../scope/scope-model';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { formatInteger, formatList, formatPercent } from '@/lib/format';

const PART_WORDS = {
  mentioned_and_cited: 'partBoth',
  mentioned_only: 'partMentionedOnly',
  cited_only: 'partCitedOnly',
  neither: 'partNeither',
} as const satisfies Record<OutcomePart, string>;

/** Tokens only (OV-OUT-04): never `chart-1`, which is the own brand's, and an outcome is a category. */
const PART_TOKENS: Readonly<Record<OutcomePart, OutcomeToken>> = {
  mentioned_and_cited: 'seq-6',
  mentioned_only: 'seq-4',
  cited_only: 'seq-3',
  neither: 'chart-bar-neutral',
};

type Ok = Extract<EngineOutcome, { state: 'ok' }>;

/**
 * CH-03 and OV-OUT: how the answers of each platform of the page scope split between mentioned and cited, mentioned
 * only, cited only and neither, as 100% bars. Platforms are never pooled: a bar is one platform's own answers. A platform
 * with fewer than 4 valid answers has no bar and is left out; the shares are the mean of each prompt's own share, and
 * every tooltip says the pooled answers behind it.
 */
export default function OutcomeMixCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.outcomeSplit');
  const common = useTranslations('aiOverview.engines.common');
  const data = useCardData({ previous: 'none', subscribed: live });
  const title = t('title');
  const unavailable = useScopeUnavailable(title);

  const prompts = data.current.data?.prompts;
  const mixes = useMemo(() => (prompts === undefined ? [] : outcomeMix(prompts, data.asked)), [prompts, data.asked]);
  const shown = mixes.filter((mix): mix is Ok => mix.state === 'ok');
  const nameOf = (code: string): string => engineLabel(code) ?? common('unknownEngine');
  const single = singlePlatform(data.scope);

  const segments: OutcomeSegment[] = OUTCOME_PARTS.map((part) => ({
    id: part,
    name: t(PART_WORDS[part]),
    token: PART_TOKENS[part],
  }));
  const rows = shown.map((mix): OutcomeRow => ({
    id: mix.engineCode,
    label: nameOf(mix.engineCode),
    icon: <EngineLogo engine={mix.engineCode} name="" />,
    answersText: t('answers', { count: mix.answers }),
    shares: mix.shares.map((entry) => ({
      segmentId: entry.part,
      share: entry.share,
      shareText: formatPercent(entry.share, { decimals: 0 }),
      tip: t('segmentTip', {
        label: t(PART_WORDS[entry.part]),
        share: formatPercent(entry.share, { decimals: 0 }),
        k: entry.k,
        n: mix.answers,
      }),
    })),
  }));

  const ready = data.phase === 'ready' || data.phase === 'refetching';
  const empty = ((): ChartEmpty | null => {
    if (data.asked.length === 0) return unavailable;
    if (!ready) return null;
    if (data.aggregates?.engines.some((engine) => engine.asked && engine.validAnswers > 0) !== true) {
      return { title: t('emptyTitle'), reason: t('noAnswersReason') };
    }
    return shown.length === 0 ? { title: t('emptyTitle'), reason: t('emptyReason') } : null;
  })();
  const frame = useFrameState(
    { ...data, phase: empty !== null && data.phase !== 'loading' && data.phase !== 'error' ? 'empty' : data.phase },
    { name: title, empty },
  );

  const columns: PlainColumn<Ok>[] = [
    { id: 'platform', header: t('platformHeader'), cell: (mix) => nameOf(mix.engineCode) },
    ...OUTCOME_PARTS.map((part): PlainColumn<Ok> => ({
      id: part,
      header: t(PART_WORDS[part]),
      cell: (mix) => {
        const entry = mix.shares.find((share) => share.part === part);
        return entry === undefined
          ? ''
          : t('cell', {
              share: formatPercent(entry.share, { decimals: 0 }),
              counts: `${formatInteger(entry.k)} / ${formatInteger(mix.answers)}`,
            });
      },
    })),
    { id: 'answers', header: t('answersHeader'), cell: (mix) => formatInteger(mix.answers) },
  ];
  const csv: CsvTable = {
    header: ['platform', 'outcome', 'share_percent', 'k', 'n', 'prompts'].map(safeText),
    rows: shown.flatMap((mix) =>
      mix.shares.map((entry) => [
        safeText(nameOf(mix.engineCode)),
        safeText(t(PART_WORDS[entry.part])),
        percentNumber(entry.share),
        entry.k,
        mix.answers,
        mix.prompts,
      ]),
    ),
  };
  useCardExport(item.id, () => {
    if (prompts === undefined || !ready) return null;
    return {
      id: item.id,
      header: [...csv.header, 'status'],
      rows: mixes.flatMap((mix) =>
        OUTCOME_PARTS.map((part) => {
          const entry = mix.state === 'ok' ? mix.shares.find((share) => share.part === part) : undefined;
          // No share and no count for a platform without enough answers: the status says why, and an unknown is never a 0
          return [
            safeText(nameOf(mix.engineCode)),
            safeText(t(PART_WORDS[part])),
            entry === undefined ? null : percentNumber(entry.share),
            entry?.k ?? null,
            mix.state === 'none' ? null : mix.answers,
            mix.state === 'ok' ? mix.prompts : null,
            mix.state,
          ];
        }),
      ),
    };
  });

  const summary = [
    t('summary'),
    ...shown.map((mix) =>
      t('summaryPlatform', {
        platform: nameOf(mix.engineCode),
        parts: formatList(
          mix.shares.map((entry) =>
            t('summaryPart', { name: t(PART_WORDS[entry.part]), share: formatPercent(entry.share, { decimals: 0 }) }),
          ),
        ),
      }),
    ),
  ].join(' ');

  return (
    <ChartFrame
      kind="html"
      variant="panel"
      title={title}
      meta={single === null ? t('metaAll') : nameOf(single)}
      info={{ what: t('info.what'), how: t('info.how') }}
      footnote={t('footnote')}
      height={240}
      summary={ready && empty === null ? summary : ''}
      body={<OutcomeBars segments={segments} rows={rows} caption={t('caption')} />}
      table={
        <PlainTable<Ok>
          caption={t('caption')}
          columns={columns}
          rows={shown}
          rowKey={(mix) => mix.engineCode}
          status="ready"
          errorState={null}
          emptyText={t('emptyTitle')}
        />
      }
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
