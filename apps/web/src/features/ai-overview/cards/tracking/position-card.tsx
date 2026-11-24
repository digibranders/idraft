'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { percentTexts } from './percent-texts';
import { ShareColumns } from './share-charts';
import { type ShareRow, type ShareSegment, type ShareToken } from './share-types';
import { engineLabel } from '../engines/engine-role';
import { useCardData } from '../engines/use-card-data';
import { useCardExport } from '../engines/use-card-seams';
import { useFrameState } from '../engines/use-frame-state';
import { useScopeUnavailable } from '../../states/scope-unavailable';
import { ChartFrame, type ChartEmpty } from '@/components/app/chart/chart-frame';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { safeText, type CsvTable } from '@/lib/csv/csv-write';
import { formatDecimal, formatInteger, formatList } from '@/lib/format';
import { orderDistribution, positionOf, type OrderReading, type PositionReading } from '@/lib/prompt-facts';

const PARTS = ['first', 'second', 'third', 'later'] as const;
type Part = (typeof PARTS)[number];

/** The sequential steps for the first three places and the neutral bar for the rest, as in the preview. */
const PART_TOKENS: Readonly<Record<Part, ShareToken>> = {
  first: 'seq-6',
  second: 'seq-4',
  third: 'seq-3',
  later: 'chart-bar-neutral',
};

interface PlatformOrder {
  code: string;
  /** The counts of answers by place, when the API sends them: they draw the bars. */
  reading: OrderReading;
  /** The mean over the ordered answers, from the position counts the API sends: it needs no counts by place. */
  position: PositionReading;
}

const positionNotCollected = ({ position }: PlatformOrder): boolean =>
  position.state === 'unknown' && position.reason === 'not_collected';

/** The answers that give the brand a place on the platform, from whichever read has them. */
const orderedOf = ({ reading, position }: PlatformOrder): number =>
  reading.state === 'not_collected' ? position.ordered_answers : reading.ordered;

/** The mean place, from the counts by place when there are enough of them, else from the position counts. */
const meanOf = ({ reading, position }: PlatformOrder): number | null =>
  reading.state === 'ok' ? reading.mean : position.state === 'ok' ? position.value : null;

/**
 * OV-PT-01 and OV-PT-02: where the brand comes in the order of the brands named, as shares of the answers that name it
 * with a place, one bar per platform and never pooled. The shares come from the counts of answers by place (backend
 * request 2), which the API does not send yet: a distribution cannot be made from a mean. Until it does, a platform
 * shows its mean place (the Prompts column's own reading, from at least 2 answers that give the brand a place) and the
 * number of answers it rests on, with no bar. A platform with fewer than 4 answers by place keeps its line with a chip.
 */
export default function PositionDistributionCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sourcesTracking.position');
  const common = useTranslations('aiOverview.engines.common');
  const data = useCardData({ previous: 'none', include: ['fact_counts'], subscribed: live });
  const title = t('title');
  const unavailable = useScopeUnavailable(title);

  const prompts = data.current.data?.prompts;
  const orders = useMemo(
    (): PlatformOrder[] =>
      prompts === undefined
        ? []
        : data.asked.map((code) => ({
            code,
            reading: orderDistribution(prompts, code),
            position: positionOf(prompts, [code]),
          })),
    [prompts, data.asked],
  );
  const nameOf = (code: string): string => engineLabel(code) ?? common('unknownEngine');
  const ready = data.phase === 'ready' || data.phase === 'refetching';
  const nothingCollected =
    ready && orders.every((order) => order.reading.state === 'not_collected' && positionNotCollected(order));

  const empty = ((): ChartEmpty | null => {
    if (data.asked.length === 0) return unavailable;
    if (data.phase === 'empty') return { title: t('emptyNoPromptsTitle'), reason: t('emptyNoPromptsReason') };
    if (!ready) return null;
    return nothingCollected ? { title: t('notCollectedTitle'), reason: t('notCollectedReason') } : null;
  })();
  const frame = useFrameState(
    { ...data, phase: empty !== null && data.phase !== 'loading' && data.phase !== 'error' ? 'empty' : data.phase },
    { name: title, empty },
  );

  const segments: ShareSegment[] = PARTS.map((part) => ({ id: part, name: t(part), token: PART_TOKENS[part] }));
  const meanText = (mean: number): string => t('mean', { mean: formatDecimal(mean, 1) });
  const rows = orders.map((order): ShareRow => {
    const { code, reading, position } = order;
    const base = { id: code, label: nameOf(code), icon: <EngineLogo engine={code} name="" /> };
    if (reading.state === 'not_collected') {
      if (position.state === 'ok') {
        return {
          ...base,
          note: meanText(position.value),
          body: { kind: 'chip', text: t('orderedChip', { n: position.ordered_answers }) },
        };
      }
      if (position.reason === 'not_collected') {
        return { ...base, note: t('notCollectedNote'), body: { kind: 'chip', text: t('notCollectedChip') } };
      }
      if (position.reason === 'unobserved') {
        return { ...base, note: t('noAnswersNote'), body: { kind: 'chip', text: t('noAnswersChip') } };
      }
      return { ...base, note: t('tooFewNote'), body: { kind: 'chip', text: t('tooFewChip') } };
    }
    if (reading.state === 'too_few') {
      return { ...base, note: t('tooFewNote'), body: { kind: 'chip', text: t('tooFewChip') } };
    }
    const texts = percentTexts(reading.shares);
    return {
      ...base,
      note: meanText(reading.mean),
      body: {
        kind: 'shares',
        cells: PARTS.map((part, index) => {
          const share = reading.shares[index] ?? 0;
          const shareText = texts[index] ?? '';
          return {
            share,
            shareText,
            tip: t('segmentTip', {
              label: t(part),
              share: shareText,
              k: reading.counts[index] ?? 0,
              n: reading.ordered,
            }),
          };
        }),
      },
    };
  });

  const columns: PlainColumn<PlatformOrder>[] = [
    { id: 'platform', header: t('platformHeader'), cell: (order) => nameOf(order.code) },
    {
      id: 'ordered',
      header: t('answersHeader'),
      cell: (order) => (orderedOf(order) === 0 ? '' : formatInteger(orderedOf(order))),
    },
    {
      id: 'mean',
      header: t('meanHeader'),
      cell: (order) => {
        const mean = meanOf(order);
        return mean === null ? '' : formatDecimal(mean, 1);
      },
    },
    ...PARTS.map((part, index): PlainColumn<PlatformOrder> => ({
      id: part,
      header: t(part),
      cell: ({ reading }) =>
        reading.state === 'ok'
          ? t('cell', {
              share: percentTexts(reading.shares)[index] ?? '',
              k: reading.counts[index] ?? 0,
            })
          : '',
    })),
  ];
  const csv: CsvTable = {
    header: [
      'platform',
      'answers_with_place',
      'mean_position',
      'first',
      'second',
      'third',
      'fourth_or_later',
      'status',
    ],
    rows: orders.map((order) => {
      const mean = meanOf(order);
      const { code, reading, position } = order;
      return [
        safeText(nameOf(code)),
        reading.state === 'not_collected' && positionNotCollected(order) ? null : orderedOf(order),
        mean === null ? null : Math.round(mean * 10) / 10,
        ...[0, 1, 2, 3].map((index) => reading.counts?.[index] ?? null),
        reading.state === 'not_collected' && position.state === 'ok' ? 'mean_only' : reading.state,
      ];
    }),
  };
  useCardExport(item.id, () => (prompts === undefined || !ready ? null : { id: item.id, ...csv }));

  const summary = [
    t('summary'),
    ...orders.map(({ code, reading, position }) =>
      reading.state === 'ok'
        ? t('summaryPlatform', {
            platform: nameOf(code),
            parts: formatList(
              percentTexts(reading.shares).map((share, index) =>
                t('summaryPart', { name: t(PARTS[index] ?? 'first'), share }),
              ),
            ),
          })
        : position.state === 'ok'
          ? t('summaryMean', {
              platform: nameOf(code),
              mean: formatDecimal(position.value, 1),
              n: position.ordered_answers,
            })
          : t('summaryNone', { platform: nameOf(code) }),
    ),
  ].join(' ');

  return (
    <ChartFrame
      kind="html"
      keepHeaderWhenEmpty
      variant="panel"
      title={title}
      meta={t('meta')}
      info={{ what: t('infoWhat'), how: t('infoHow') }}
      footnote={t('footnote')}
      height={240}
      summary={ready && empty === null ? summary : ''}
      body={<ShareColumns segments={segments} rows={rows} caption={t('caption')} label={summary} />}
      table={
        <PlainTable<PlatformOrder>
          caption={t('caption')}
          columns={columns}
          rows={orders}
          rowKey={(order) => order.code}
          status="ready"
          errorState={null}
          emptyText={t('notCollectedTitle')}
        />
      }
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
