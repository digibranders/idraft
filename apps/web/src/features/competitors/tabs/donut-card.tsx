'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useCallback, type ReactElement } from 'react';

import type { Read } from '../data/read-state';
import { useCardStatus } from './chart-card';
import { shareOf, type DonutSlice } from './donut-model';
import { donutOption } from './donut-option';
import { ChartLegend, type LegendItem } from '@/components/app/chart/chart-legend';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Skeleton } from '@/components/ui/skeleton';
import { formatPercent } from '@/lib/format';
import type { ChartTokens } from '@/lib/design/read-tokens';

// ECharts loads on the client only, after the page; the card holds its height meanwhile
const EChart = dynamic(() => import('@/components/app/chart/echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

const SIZE = 168;

export interface DonutCardProps {
  title: string;
  /** What the donut shows, for people who cannot see it. */
  summary: string;
  slices: readonly DonutSlice[];
  /** The figure in the middle: yours, "49.5%". */
  centerValue: string;
  /** What it is: "You". */
  centerLabel: string;
  /** Formats a slice's value for the legend and the tooltip. */
  formatValue: (value: number) => string;
  reads: readonly Read<unknown>[];
  isEmpty: boolean;
  /** Also writes each slice's share of the whole after its value: for counts, not for rates that already add up. */
  showShare?: boolean | undefined;
  /** Under the legend: how to read the shares. */
  note?: string | undefined;
}

/**
 * A part-to-whole card: a donut with a figure in the middle and a legend that gives every slice its value and its
 * share. The legend is the text alternative of the canvas, so nothing depends on colour alone.
 */
export function DonutCard({
  title,
  summary,
  slices,
  centerValue,
  centerLabel,
  formatValue,
  reads,
  isEmpty,
  showShare = false,
  note,
}: DonutCardProps): ReactElement {
  const t = useTranslations('competitors.states');
  const state = useCardStatus(reads, isEmpty);
  const option = useCallback(
    (tokens: ChartTokens) => donutOption({ slices, tokens, formatValue }),
    [slices, formatValue],
  );
  const legend: LegendItem[] = slices.map((slice) => ({
    id: slice.id,
    name: slice.name,
    role: slice.role,
    pressed: true,
    valueText: showShare
      ? `${formatValue(slice.value)} (${formatPercent(shareOf(slice.value, slices), { decimals: 0 })})`
      : formatValue(slice.value),
  }));

  let body: ReactElement;
  if (state.status === 'error') {
    body = <InlineError {...state.error} />;
  } else if (state.status === 'loading') {
    body = <Skeleton shape="block" className="h-44 w-full" />;
  } else if (state.status === 'empty') {
    body = <EmptyState variant="card" title={t('noDataTitle')} reason={t('noDataReason')} headingLevel={3} />;
  } else {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div role="img" aria-label={summary} className="relative shrink-0" style={{ height: SIZE, width: SIZE }}>
          <EChart option={option} height={SIZE} />
          <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="type-metric">{centerValue}</span>
            <span className="type-meta text-foreground-secondary">{centerLabel}</span>
          </span>
        </div>
        <div className="w-full">
          <ChartLegend title={title} items={legend} />
        </div>
        {note === undefined ? null : <p className="type-meta text-foreground-secondary">{note}</p>}
      </div>
    );
  }
  return (
    <section
      aria-label={title}
      aria-busy={state.status === 'refetching' || undefined}
      className="flex h-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3"
    >
      <h3 className="type-section-title">{title}</h3>
      {body}
    </section>
  );
}
