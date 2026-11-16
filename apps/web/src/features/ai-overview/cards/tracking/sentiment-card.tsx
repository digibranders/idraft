'use client';

import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { ShareRows, type ShareRow, type ShareSegment, type ShareToken } from './share-rows';
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
import { formatInteger, formatList, formatPercent } from '@/lib/format';
import { namedAnswers, SENTIMENT_KEYS, sentimentOf, type SentimentReading } from '@/lib/prompt-facts';

const TOKENS: Readonly<Record<(typeof SENTIMENT_KEYS)[number], ShareToken>> = {
  positive: 'chart-positive',
  neutral: 'chart-bar-neutral',
  negative: 'chart-negative',
  mixed: 'chart-other',
};

interface PlatformTone {
  code: string;
  reading: SentimentReading;
  /** The share of the mentions that were classified, when the answers say how many mention the brand; else `null`. */
  coverage: number | null;
}

/**
 * OV-PT-03 and OV-KEEP-07: the tone of the mentions as four shares (positive, neutral, negative, mixed) for each
 * platform, never one score (R4) and never pooled across platforms. The shares come from the counts of classified
 * mentions the API will send once the classifier writes them (backend request 4); until then the card says "Not
 * collected yet". A platform that does not classify says "Not classified", and one with fewer than 4 classified
 * mentions has no bar. No sample values: the mock's seeded shares live in the fixtures only.
 */
export default function SentimentCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.sourcesTracking.sentiment');
  const common = useTranslations('aiOverview.engines.common');
  const data = useCardData({ previous: 'none', include: ['facts'], subscribed: live });
  const title = t('title');
  const unavailable = useScopeUnavailable(title);

  const prompts = data.current.data?.prompts;
  const tones = useMemo(
    (): PlatformTone[] =>
      prompts === undefined
        ? []
        : data.asked.map((code) => {
            const reading = sentimentOf(prompts, [code]);
            // One denominator: the answers that name the brand, counted by the same facts as the position
            const named = namedAnswers(prompts, code);
            return {
              code,
              reading,
              coverage: reading.state === 'ok' && named > 0 ? Math.min(1, reading.mentions / named) : null,
            };
          }),
    [prompts, data.asked],
  );
  const nameOf = (code: string): string => engineLabel(code) ?? common('unknownEngine');
  const ready = data.phase === 'ready' || data.phase === 'refetching';
  const states = tones.map((tone) => tone.reading.state);

  const empty = ((): ChartEmpty | null => {
    if (data.asked.length === 0) return unavailable;
    if (data.phase === 'empty') return { title: t('emptyNoPromptsTitle'), reason: t('emptyNoPromptsReason') };
    if (!ready || tones.length === 0) return null;
    if (states.every((state) => state === 'not_collected')) {
      return { title: t('emptyNotCollectedTitle'), reason: t('emptyNotCollectedReason') };
    }
    return states.every((state) => state === 'not_collected' || state === 'none')
      ? { title: t('emptyNoneTitle'), reason: t('emptyNoneReason') }
      : null;
  })();
  const frame = useFrameState(
    { ...data, phase: empty !== null && data.phase !== 'loading' && data.phase !== 'error' ? 'empty' : data.phase },
    { name: title, empty },
  );

  const segments: ShareSegment[] = SENTIMENT_KEYS.map((key) => ({ id: key, name: t(key), token: TOKENS[key] }));
  const rows = tones.map(({ code, reading, coverage }): ShareRow => {
    const base = { id: code, label: nameOf(code), icon: <EngineLogo engine={code} name="" /> };
    if (reading.state === 'ok' && reading.shares !== null) {
      const { shares, mentions } = reading;
      return {
        ...base,
        note: coverage === null ? '' : t('coverage', { share: formatPercent(coverage, { decimals: 0 }) }),
        body: {
          kind: 'shares',
          cells: SENTIMENT_KEYS.map((key) => {
            const share = shares[key];
            const shareText = formatPercent(share, { decimals: 0 });
            return {
              share,
              shareText,
              tip: t('segmentTip', { label: t(key), share: shareText, k: Math.round(share * mentions), n: mentions }),
            };
          }),
        },
      };
    }
    if (reading.state === 'not_collected') {
      return { ...base, note: t('notCollectedNote'), body: { kind: 'chip', text: t('notCollectedChip') } };
    }
    if (reading.state === 'none') {
      return { ...base, note: t('notClassifiedNote'), body: { kind: 'chip', text: t('notClassifiedChip') } };
    }
    return {
      ...base,
      note: reading.state === 'unobserved' ? t('noAnswersNote') : t('tooFewNote'),
      body: { kind: 'chip', text: t('notClassifiedChip') },
    };
  });

  const columns: PlainColumn<PlatformTone>[] = [
    { id: 'platform', header: t('platformHeader'), cell: (tone) => nameOf(tone.code) },
    {
      id: 'mentions',
      header: t('mentionsHeader'),
      cell: (tone) => (tone.reading.state === 'ok' ? formatInteger(tone.reading.mentions) : ''),
    },
    ...SENTIMENT_KEYS.map((key): PlainColumn<PlatformTone> => ({
      id: key,
      header: t(key),
      cell: ({ reading }) =>
        reading.state === 'ok' && reading.shares !== null
          ? t('cell', {
              share: formatPercent(reading.shares[key], { decimals: 0 }),
              k: Math.round(reading.shares[key] * reading.mentions),
            })
          : '',
    })),
  ];
  const csv: CsvTable = {
    header: ['platform', 'classified_mentions', ...SENTIMENT_KEYS, 'status'],
    rows: tones.map(({ code, reading }) => [
      safeText(nameOf(code)),
      reading.state === 'ok' ? reading.mentions : null,
      ...SENTIMENT_KEYS.map((key) => (reading.shares === null ? null : Math.round(reading.shares[key] * 1000) / 10)),
      reading.state,
    ]),
  };
  useCardExport(item.id, () => (prompts === undefined || !ready ? null : { id: item.id, ...csv }));

  const summary = [
    t('summary'),
    ...tones.map(({ code, reading }) =>
      reading.state === 'ok' && reading.shares !== null
        ? t('summaryPlatform', {
            platform: nameOf(code),
            parts: formatList(
              SENTIMENT_KEYS.map((key) =>
                t('summaryPart', { name: t(key), share: formatPercent(reading.shares?.[key] ?? 0, { decimals: 0 }) }),
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
      body={<ShareRows segments={segments} rows={rows} caption={t('caption')} />}
      table={
        <PlainTable<PlatformTone>
          caption={t('caption')}
          columns={columns}
          rows={tones}
          rowKey={(tone) => tone.code}
          status="ready"
          errorState={null}
          emptyText={t('emptyNotCollectedTitle')}
        />
      }
      menu={{ fileName: t('fileName'), csv }}
      {...frame}
    />
  );
}
