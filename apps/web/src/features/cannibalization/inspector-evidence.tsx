'use client';

import { CircleHelp, FileSearch, ListChecks } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type ReactElement } from 'react';

import { causesOf, evidenceSentence, pageRefs, rankLines, roleOfLetter, type PageRef } from './cann-evidence';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { Icon } from '@/components/ui/icon';
import type { CannKeywordDetail } from '@/lib/api/types';
import type { CategorySeries } from '@/lib/charts/category-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatChartDate, formatInteger, formatPercent } from '@/lib/format';

export interface InspectorEvidenceProps {
  detail: CannKeywordDetail;
  days: number;
  /** The keyword's page on the Keywords page. */
  keywordHref: Route;
}

/** Evidence (docs/33 section 7.2): the sentence and three figures, the rank of each page, the causes to check, the options. */
export function InspectorEvidence({ detail, days, keywordHref }: InspectorEvidenceProps): ReactElement {
  const t = useTranslations('cannibalization.inspector');
  const verdicts = useTranslations('cannibalization.verdict');
  const { keyword } = detail;
  const sentence = evidenceSentence(detail, days);
  const gap = Math.round(keyword.rank_gap);
  return (
    <>
      <InspectorSection
        title={t('evidence.title')}
        icon={FileSearch}
        meta={t('evidence.meta', { count: keyword.ranked_checks })}
        status="ready"
      >
        <div className="flex flex-col gap-3">
          <p className="type-body text-foreground">{t(`sentence.${sentence.key}`, sentence.values)}</p>
          <dl className="grid grid-cols-3 gap-3">
            <Figure label={t('evidence.gap')} value={gap > 0 ? `+${formatInteger(gap)}` : '0'} />
            <Figure label={t('evidence.switches')} value={formatInteger(keyword.switches.length)} />
            <Figure
              label={t('evidence.together')}
              value={keyword.together_rate > 0 ? formatPercent(keyword.together_rate, { decimals: 0 }) : '0%'}
            />
          </dl>
          <p className="type-meta">{t('evidence.note', { what: verdicts(`${keyword.verdict}.what`) })}</p>
        </div>
      </InspectorSection>
      <RankByPage detail={detail} days={days} />
      <InspectorSection title={t('causes.title')} icon={ListChecks} meta={t('causes.meta')} status="ready">
        <ul className="flex flex-col gap-2">
          {causesOf(detail).map((cause) => (
            <li key={cause.key} className="flex gap-2 type-body text-foreground">
              <Icon icon={CircleHelp} size="sm" className="mt-0.5 shrink-0 text-foreground-tertiary" />
              <span>{t(`causes.${cause.key}`, cause.values)}</span>
            </li>
          ))}
        </ul>
      </InspectorSection>
      <InspectorSection title={t('options.title')} meta={t('options.meta')} status="ready">
        <div className="flex flex-col gap-2">
          <Link
            href={keywordHref}
            className="inline-flex items-center gap-1 self-start rounded-sm type-body text-link outline-none hover:underline focus-visible:focus-ring"
          >
            {t('options.keywordPage')}
          </Link>
          <p className="type-meta">{t('options.note')}</p>
        </div>
      </InspectorSection>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="type-label text-foreground-tertiary">{label}</dt>
      <dd className="num type-body-strong text-foreground">{value}</dd>
    </div>
  );
}

const lineName = (page: PageRef): string => `${page.letter}: ${page.path}`;

/** Where a line's letter goes: its last rank, so the letter names the line without color. */
const lastRankIndex = (values: readonly (number | null)[]): number => values.findLastIndex((value) => value !== null);

function RankByPage({ detail, days }: { detail: CannKeywordDetail; days: number }): ReactElement | null {
  const t = useTranslations('cannibalization.inspector.rank');
  const { dates, lines } = useMemo(() => rankLines(detail, pageRefs(detail)), [detail]);
  const categories = useMemo(() => dates.map((date) => formatChartDate(date)), [dates]);
  const series = useMemo(
    (): CategorySeries[] =>
      lines.map((line) => ({
        id: line.page.id,
        name: lineName(line.page),
        role: roleOfLetter(line.page.letter),
        values: line.values,
      })),
    [lines],
  );
  const ranks = lines.flatMap((line) => line.values).filter((value): value is number => value !== null);
  const [low, high] = [Math.min(...ranks), Math.max(...ranks)];
  const extendOption = useCallback(
    (base: Record<string, unknown>, tokens: ChartTokens): Record<string, unknown> => {
      const baseSeries = Array.isArray(base.series) ? (base.series as Record<string, unknown>[]) : [];
      return {
        ...base,
        grid: { ...(base.grid as Record<string, unknown>), right: 28 },
        yAxis: {
          ...(base.yAxis as Record<string, unknown>),
          inverse: true,
          minInterval: 1,
          min: Math.max(1, low - 2),
          max: high + 2,
        },
        series: baseSeries.map((entry) => {
          const line = lines.find((candidate) => candidate.page.id === entry.id);
          if (line === undefined) return entry;
          const last = lastRankIndex(line.values);
          const data = Array.isArray(entry.data) ? (entry.data as (number | null)[]) : [];
          return {
            ...entry,
            smooth: false,
            areaStyle: undefined,
            lineStyle: { width: line.page.isPrimary ? 3 : 2, join: 'round' },
            endLabel: { show: false },
            // The letter at the end of each line names it, so the chart does not rely on color
            data: data.map((value, index) =>
              index === last
                ? {
                    value,
                    label: {
                      show: true,
                      position: 'right',
                      formatter: line.page.letter,
                      color: tokens.foreground,
                      fontFamily: tokens.fontFamily,
                      fontSize: 12,
                      fontWeight: 600,
                    },
                  }
                : value,
            ),
          };
        }),
      };
    },
    [lines, low, high],
  );
  if (lines.length === 0 || ranks.length === 0) return null;
  const summary = t('summary', {
    keyword: detail.keyword.keyword,
    days,
    pages: lines
      .map((line) =>
        t('page', { letter: line.page.letter, path: line.page.path, median: Math.round(line.page.median ?? 0) }),
      )
      .join(' '),
  });
  return (
    <section className="rounded-lg border border-border bg-surface px-4 pt-3 pb-4">
      <ChartFrame
        title={t('title')}
        variant="inspector"
        meta={t('meta')}
        kind="line"
        categories={categories}
        categoryHeader={t('header')}
        series={series}
        formatValue={formatInteger}
        extendOption={extendOption}
        legendMarkers
        height={180}
        summary={summary}
        status="ready"
      />
    </section>
  );
}
