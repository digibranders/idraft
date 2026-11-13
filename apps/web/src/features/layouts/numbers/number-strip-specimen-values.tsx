/**
 * The values the specimen's number strip shows: the preview's `NUMBER_DATA`, for the numbers of the overview. Fixture
 * data for /design-system/layouts-live only; a page gives its own values from its own queries, and nothing outside
 * the specimen imports this file.
 */
import type { Route } from 'next';
import type { ReactElement } from 'react';

import type { NumberValue } from './number-cell';
import { Delta } from '@/components/app/metric/delta';
import { formatCompact, formatInteger, formatPercent, type MetricDeltaInput } from '@/lib/format';
import type { NumberItem } from '@/lib/layouts';

interface Row {
  value: string;
  context: string;
  href: Route;
  /** The change in points, and whether the API's test found it detectable (only then does it take a colour). */
  points?: { value: number; detectable: boolean };
  change?: MetricDeltaInput;
  /** The value is not a number: it reads in the tertiary colour. */
  notApplicable?: true;
}

// The gallery has no pages of keywords or prompts: every number leads back to the gallery's own page
const KEYWORDS = '/design-system/layouts-live#keywords';
const PROMPTS = '/design-system/layouts-live#prompts';
const COMPETITORS = '/design-system/layouts-live#competitors';

const rate = (ratio: number, points: number, detectable: boolean, context: string, href: Route = PROMPTS): Row => ({
  value: formatPercent(ratio),
  context,
  href,
  points: { value: points, detectable },
});
const count = (value: number, change: number, context: string): Row => ({
  value: formatInteger(value),
  context,
  href: KEYWORDS,
  change: { value: change, unit: 'count', polarity: 'higher_is_better', isDetectable: true },
});
const responses = (found: number, total: number, what = 'responses'): string =>
  `${formatInteger(found)} of ${formatInteger(total)} ${what}`;
const NOT_CLASSIFIED: Row = {
  value: 'n/a',
  context: 'not classified for this engine',
  href: PROMPTS,
  notApplicable: true,
};

/** Keyed `metric` for an SEO number and `metric|engine` for an AI one. */
const ROWS: Readonly<Record<string, Row>> = {
  'seo.keywords_tracked': { value: formatInteger(1000), context: '986 checked', href: KEYWORDS },
  'seo.visibility_volume': rate(0.314, 1.2, true, 'volume-weighted', KEYWORDS),
  'seo.visibility_equal': rate(0.289, 0.7, false, 'equal-weight, 986 keywords', KEYWORDS),
  'seo.top3_count': count(88, 6, 'of 986 checked'),
  'seo.top10_count': count(301, 14, 'of 986 checked'),
  'seo.top20_count': count(488, 9, 'of 986 checked'),
  'seo.average_rank': { value: '9.1', context: '612 ranked', href: KEYWORDS },
  'seo.est_clicks': {
    value: formatCompact(18_400),
    context: 'estimate, per month',
    href: KEYWORDS,
    change: { value: 0.031, unit: 'relative', polarity: 'higher_is_better', isDetectable: false },
  },
  'seo.aio_citation_rate': rate(0.382, 0.4, false, responses(157, 411, 'checks'), KEYWORDS),
  'seo.share_of_voice': rate(0.182, 0.6, false, 'among 5 tracked entities', COMPETITORS),
  'ai.mention_rate|chatgpt_web': rate(0.34, 2.1, false, responses(612, 1800)),
  'ai.mention_rate|gemini_web': rate(0.29, -0.8, false, responses(376, 1296)),
  'ai.mention_rate|google_ai_mode': rate(0.41, -6, true, responses(398, 980, 'observations')),
  'ai.citation_rate|chatgpt_web': rate(0.21, 3.4, true, responses(378, 1800)),
  'ai.citation_rate|gemini_web': rate(0.14, 0.2, false, responses(181, 1296)),
  'ai.citation_rate|google_ai_mode': rate(0.33, -1.1, false, responses(323, 980, 'observations')),
  'ai.recommendation_rate|chatgpt_web': rate(0.18, 0.9, false, responses(324, 1800)),
  'ai.recommendation_rate|gemini_web': rate(0.15, -0.4, false, responses(194, 1296)),
  'ai.recommendation_rate|google_ai_mode': NOT_CLASSIFIED,
  'ai.share_of_voice|chatgpt_web': rate(0.27, 1, false, `${formatInteger(1204)} responses with a tracked entity`),
  'ai.share_of_voice|gemini_web': rate(0.24, -0.5, false, `${formatInteger(842)} responses with a tracked entity`),
  'ai.share_of_voice|google_ai_mode': rate(
    0.31,
    -2.2,
    false,
    `${formatInteger(711)} observations with a tracked entity`,
  ),
};

const delta = (input: MetricDeltaInput): ReactElement => <Delta input={input} tip={false} />;

/** What the specimen shows for a number; a number without a row says so and is not a link to anywhere. */
export function specimenValueOf(item: NumberItem): NumberValue {
  const row = ROWS[item.engine === undefined ? item.metric : `${item.metric}|${item.engine}`];
  if (row === undefined) return { value: 'Not available', unknown: { kind: 'not-applicable' } };
  const change: MetricDeltaInput | undefined =
    row.points === undefined
      ? row.change
      : {
          // the formatter reads a change in points as a ratio of the rate: 0.012 is "+1.2 pts"
          value: row.points.value / 100,
          unit: 'points',
          polarity: 'higher_is_better',
          isDetectable: row.points.detectable,
        };
  return {
    value: row.value,
    context: row.context,
    href: row.href,
    ...(row.notApplicable === true ? { unknown: { kind: 'not-applicable' as const } } : {}),
    ...(change === undefined ? {} : { delta: delta(change) }),
  };
}
