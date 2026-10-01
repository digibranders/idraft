'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useCallback, useId, useState, type ReactElement, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { categoryChartOption, seriesColorVar, type CategorySeries } from '@/lib/charts/category-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { cn } from '@/lib/utils';

// ECharts loads on the client only, after the page; the frame holds the chart's height meanwhile
const EChart = dynamic(() => import('./echart').then((module) => module.EChart), {
  ssr: false,
  loading: () => <Skeleton shape="block" className="h-full w-full" />,
});

export type ChartHeight = 140 | 180 | 240 | 280;

export interface ChartFrameProps {
  title: string;
  /** `panel` on a page; `inspector` drops the border and side padding and uses the smaller title. */
  variant: 'panel' | 'inspector';
  /** Window, sample size, version boundaries: "Last 12 months · Google Ads data". */
  meta?: string | null | undefined;
  /** Method and filters that change how to read it. */
  footnote?: ReactNode;
  kind: 'line' | 'bar';
  categories: readonly string[];
  /** The first column of the table view: "Month". */
  categoryHeader: string;
  series: readonly CategorySeries[];
  formatValue: (value: number) => string;
  height: ChartHeight;
  /** What the chart shows, in one or two sentences, for people who cannot see it. */
  summary: string;
  status: 'loading' | 'ready';
}

/**
 * Every chart's frame (15-data-visualization.md section 2): the title, a meta line, a React legend that
 * toggles series, a Table view of the same numbers, Patterns for bars, and a footnote. The canvas is an
 * image named by the title and described by the summary; the table is the full alternative.
 */
export function ChartFrame({
  title,
  variant,
  meta,
  footnote,
  kind,
  categories,
  categoryHeader,
  series,
  formatValue,
  height,
  summary,
  status,
}: ChartFrameProps): ReactElement {
  const t = useTranslations('chart');
  const summaryId = useId();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [table, setTable] = useState(false);
  const [patterns, setPatterns] = useState(false);
  const toggleSeries = (id: string): void =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const option = useCallback(
    (tokens: ChartTokens) => categoryChartOption({ kind, categories, series, hidden, patterns, tokens, formatValue }),
    [kind, categories, series, hidden, patterns, formatValue],
  );
  const inspector = variant === 'inspector';
  const Title = inspector ? 'h3' : 'h2';
  return (
    <section
      aria-busy={status === 'loading' ? true : undefined}
      className={cn('flex flex-col gap-3', inspector ? 'py-1' : 'rounded-lg border border-border bg-surface p-4')}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <Title className={inspector ? 'type-subsection-title' : 'type-section-title'}>{title}</Title>
          {meta === null || meta === undefined ? null : <p className="type-meta">{meta}</p>}
        </div>
        {series.length > 1 ? (
          <ul aria-label={t('legend', { title })} className="flex flex-wrap items-center gap-3">
            {series.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-pressed={!hidden.has(entry.id)}
                  onClick={() => toggleSeries(entry.id)}
                  className="inline-flex items-center gap-1.5 rounded-xs type-label outline-none focus-visible:focus-ring aria-[pressed=false]:opacity-50"
                >
                  {entry.role.kind === 'reference' || entry.role.kind === 'other' ? (
                    // A dashed series shows a 12 x 2 px line in its dash, not a dot (15 section 2)
                    <span
                      aria-hidden="true"
                      className="w-3 border-t-2 border-dashed"
                      style={{ borderColor: seriesColorVar(entry.role) }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ backgroundColor: seriesColorVar(entry.role) }}
                    />
                  )}
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div role="group" aria-label={t('views', { title })} className="flex items-center gap-1">
          {/* Toggle buttons: pressed reads as the secondary fill, released as ghost */}
          {kind === 'bar' && !table ? (
            <Button
              size="sm"
              variant={patterns ? 'secondary' : 'ghost'}
              aria-pressed={patterns}
              onClick={() => setPatterns((on) => !on)}
            >
              {t('patterns')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={table ? 'secondary' : 'ghost'}
            aria-pressed={table}
            onClick={() => setTable((on) => !on)}
          >
            {t('table')}
          </Button>
        </div>
      </div>
      {table ? (
        <ChartTable
          title={title}
          categoryHeader={categoryHeader}
          categories={categories}
          series={series}
          formatValue={formatValue}
          noValue={t('noValue')}
        />
      ) : (
        <div role="img" aria-label={title} aria-describedby={summaryId} style={{ height }}>
          {status === 'loading' ? (
            <Skeleton shape="block" className="h-full w-full" />
          ) : (
            <EChart option={option} height={height} />
          )}
        </div>
      )}
      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      {footnote === undefined || footnote === null ? null : <div className="type-meta">{footnote}</div>}
    </section>
  );
}

/** The chart's numbers as a simple table (12-tables.md section 15): a row per category, a column per series. */
function ChartTable({
  title,
  categoryHeader,
  categories,
  series,
  formatValue,
  noValue,
}: {
  title: string;
  categoryHeader: string;
  categories: readonly string[];
  series: readonly CategorySeries[];
  formatValue: (value: number) => string;
  noValue: string;
}): ReactElement {
  return (
    <div className="max-h-70 overflow-auto rounded-lg border border-border-subtle">
      <table className="w-full border-collapse type-table">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="bg-surface-subtle">
            <th scope="col" className="h-row-compact px-4 text-left type-label font-normal text-foreground-tertiary">
              {categoryHeader}
            </th>
            {series.map((entry) => (
              <th
                key={entry.id}
                scope="col"
                className="h-row-compact px-4 text-right type-label font-normal text-foreground-tertiary"
              >
                {entry.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((category, index) => (
            <tr key={category} className="border-t border-border-subtle">
              <th scope="row" className="h-row-compact px-4 text-left font-normal text-foreground-secondary">
                {category}
              </th>
              {series.map((entry) => {
                const value = entry.values[index];
                return (
                  <td key={entry.id} className="h-row-compact px-4 text-right num">
                    {value === null || value === undefined ? (
                      <span className="text-foreground-tertiary">{noValue}</span>
                    ) : (
                      formatValue(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
