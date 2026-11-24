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
import { orderDistribution, type OrderReading } from '@/lib/prompt-facts';

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
  reading: OrderReading;
}

/**
 * OV-PT-01 and OV-PT-02: where the brand comes in the order of the brands named, as shares of the answers that name it
 * with a place, one bar per platform and never pooled. The shares come from the counts of answers by place (backend
 * request 2); until the API sends them the card says "Not collected yet", because a distribution cannot be made from a
 * mean. A platform with fewer than 4 answers that give the brand a place keeps its line with a chip and no bar.
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
      prompts === undefined ? [] : data.asked.map((code) => ({ code, reading: orderDistribution(prompts, code) })),
    [prompts, data.asked],
  );
  const nameOf = (code: string): string => engineLabel(code) ?? common('unknownEngine');
  const ready = data.phase === 'ready' || data.phase === 'refetching';
  const nothingCollected = ready && orders.every((order) => order.reading.state === 'not_collected');

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
  const rows = orders.map(({ code, reading }): ShareRow => {
    const base = { id: code, label: nameOf(code), icon: <EngineLogo engine={code} name="" /> };
    if (reading.state === 'not_collected') {
      return { ...base, note: t('notCollectedNote'), body: { kind: 'chip', text: t('notCollectedChip') } };
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
      cell: (order) => (order.reading.state === 'not_collected' ? '' : formatInteger(order.reading.ordered)),
    },
    {
      id: 'mean',
      header: t('meanHeader'),
      cell: (order) => (order.reading.state === 'ok' ? formatDecimal(order.reading.mean, 1) : ''),
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
    rows: orders.map(({ code, reading }) => [
      safeText(nameOf(code)),
      reading.state === 'not_collected' ? null : reading.ordered,
      reading.state === 'ok' ? Math.round(reading.mean * 10) / 10 : null,
      ...[0, 1, 2, 3].map((index) => reading.counts?.[index] ?? null),
      reading.state,
    ]),
  };
  useCardExport(item.id, () => (prompts === undefined || !ready ? null : { id: item.id, ...csv }));

  const summary = [
    t('summary'),
    ...orders.map(({ code, reading }) =>
      reading.state === 'ok'
        ? t('summaryPlatform', {
            platform: nameOf(code),
            parts: formatList(
              percentTexts(reading.shares).map((share, index) =>
                t('summaryPart', { name: t(PARTS[index] ?? 'first'), share }),
              ),
            ),
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
