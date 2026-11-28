import { pageAiPromptPlatformEngine_codeValues } from '@/lib/api/schema';
import type { CategorySeries } from '@/lib/charts/category-chart';
import { formatChartDate } from '@/lib/format';
import type { PageAi } from '@/lib/internal-links/types';

export const AI_TREND_SERIES_ID = 'citations';

export interface AiChange {
  delta: number;
  previous: number;
  days: number;
}

/** Difference against the compared period, or null when uncompared or the compared period had no answers. */
export function changeOf(ai: PageAi): AiChange | null {
  if (
    ai.compare_window === null ||
    ai.previous_answers === null ||
    ai.previous_answers === 0 ||
    ai.previous_answers_citing === null
  ) {
    return null;
  }
  return {
    delta: ai.answers_citing - ai.previous_answers_citing,
    previous: ai.previous_answers_citing,
    days: ai.days,
  };
}

export interface AiTrendText {
  seriesName: string;
  cell: (cited: number, answers: number) => string;
  noAnswers: string;
}

export interface AiTrend {
  categories: string[];
  series: CategorySeries[];
  cellText: (seriesId: string, index: number) => string | null;
}

/** Shape the daily citation counts for `ChartFrame` (bars + Table switch). */
export function trendOf(ai: PageAi, text: AiTrendText): AiTrend {
  return {
    categories: ai.trend.map((day) => formatChartDate(day.date)),
    series: [
      {
        id: AI_TREND_SERIES_ID,
        name: text.seriesName,
        role: { kind: 'brand' },
        values: ai.trend.map((day) => day.answers_citing),
      },
    ],
    cellText: (seriesId, index) => {
      if (seriesId !== AI_TREND_SERIES_ID) return null;
      const day = ai.trend[index];
      if (day === undefined) return null;
      return day.answers === 0 ? text.noAnswers : text.cell(day.answers_citing, day.answers);
    },
  };
}

export type AlongsideKind = 'page' | 'own-outside' | 'competitor' | 'third-party';

/** How one "cited with this page" row renders: clickable own page in crawl, plain own page, competitor or other. */
export function alongsideKind(row: PageAi['alongside'][number]): AlongsideKind {
  if (row.domain_role === 'own') return row.in_crawl ? 'page' : 'own-outside';
  return row.domain_role === 'competitor' ? 'competitor' : 'third-party';
}

/** Prompt ids in the exact row order shown by the Prompts card (for J/K stepping). */
export function promptIdsOf(ai: PageAi): string[] {
  return ai.prompts.map((prompt) => prompt.prompt_id);
}

export type PromptPlatform = PageAi['prompts'][number]['platforms'][number];

/** Platforms that cited the page for one prompt, sorted in canonical engine order. */
export function citingPlatformsOf(platforms: readonly PromptPlatform[]): PromptPlatform[] {
  return platforms
    .filter((platform) => platform.answers_citing > 0)
    .sort(
      (left, right) =>
        pageAiPromptPlatformEngine_codeValues.indexOf(left.engine_code) -
        pageAiPromptPlatformEngine_codeValues.indexOf(right.engine_code),
    );
}

/** Accessible tooltip text across a prompt row's citing platforms ("ChatGPT: 2 of 3 answers · ..."). */
export function platformSummaryText(
  platforms: readonly PromptPlatform[],
  formatLine: (label: string, cited: number, answers: number) => string,
): string {
  return platforms.map((platform) => formatLine(platform.label, platform.answers_citing, platform.answers)).join(' · ');
}

function parseBusinessDate(isoDate: string): Date {
  const [year = 1970, month = 1, day = 1] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export interface AiPeriodDates {
  start: Date;
  end: Date;
  compare: { start: Date; end: Date } | null;
}

/** Business-date `Date` objects for the period and optional compared period, without UTC timezone drift. */
export function periodLine(ai: PageAi): AiPeriodDates {
  return {
    start: parseBusinessDate(ai.window.from),
    end: parseBusinessDate(ai.window.to),
    compare:
      ai.compare_window === null
        ? null
        : {
            start: parseBusinessDate(ai.compare_window.from),
            end: parseBusinessDate(ai.compare_window.to),
          },
  };
}
