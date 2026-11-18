import { OUTCOME_PARTS, outcomeFigures, type OutcomePart } from '../engines/outcome-model';
import { projectWeeks, type WeekMetric } from '../engines/trend-model';
import type { EngineCode, PromptsSummary, PromptSummaryRow, Run } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';
import {
  orderDistribution,
  recommendedOf,
  SENTIMENT_KEYS,
  SENTIMENT_MIN,
  sentimentOf,
  type FactsRow,
} from '@/lib/prompt-facts';
import { engineRates, type RateFigure } from '@/lib/rates/strip-model';
import { averageVisibility, platformVisibility, visibilityOfPrompts } from '@/lib/rates/visibility-model';
import { equalWeightAverage, MIN_OBSERVATIONS, wholePercents } from '@/lib/stats';

/**
 * The numbers of the headline card (`ai.visibility_split`, parity register OV-HEAD): the AI visibility hero with its
 * four outcomes, and the tiles beside it. Pure: the card puts words and marks to them.
 *
 * Every rate is the strip's own arithmetic (R12): the Prompts page's AI visibility is `visibilityOfPrompts`, and so is
 * the hero's. One platform shows its own figure with its counts. All platforms is the equal-weight average of the
 * platforms that have a rate of their own, never a ratio of pooled counts (R3), and says which platforms it used.
 * Unknown is never zero (R6): a measure the API does not carry yet is `notCollected`.
 */

/**
 * What the counts of a figure are of: answers for a rate, brand mentions for share of voice (D17), answers that give the
 * brand a place for the mention position, judged mentions for sentiment.
 */
export type CountNoun = 'answers' | 'brandMentions' | 'orderedAnswers' | 'judgedMentions';

/** What stands behind a figure, for its tooltip. */
export type Basis =
  /** One platform: `k` of `n`, over `prompts`. */
  | { kind: 'counts'; k: number | null; n: number; noun: CountNoun; prompts: number }
  /**
   * All platforms: the platforms the average is over, in the order given. `parts` are the counts of each platform for a
   * figure that is counted in brand mentions: an average of shares has no pooled count of its own (R3), so the tip names each.
   */
  | { kind: 'average'; codes: readonly string[]; parts?: readonly { code: string; k: number; n: number }[] };

export type Reading =
  | { state: 'ok'; value: number; basis: Basis }
  /** Fewer valid answers than a rate needs: no rate, the count that fell short is said. */
  | { state: 'insufficient'; n: number; noun: CountNoun }
  /** No valid answer at all in the scope. */
  | { state: 'none' }
  /** The API does not carry the measure yet. */
  | { state: 'notCollected' }
  /** Share of voice: the project tracks more brands than the API lists cells for, so the mentions of some are missing. */
  | { state: 'capped' }
  /** The platforms in scope do not classify the measure (recommendation, sentiment). */
  | { state: 'notClassified' }
  /** The member may not read what the figure is made of. */
  | { state: 'noAccess' };

/** The platforms a figure is over, one at a time or all that are asked. */
export interface Platforms {
  /** The platforms asked, in catalog order. */
  asked: readonly EngineCode[];
  /** The one platform chosen, or `null` for All platforms. */
  single: EngineCode | null;
}

function readingOf(figure: RateFigure, noun: CountNoun): Reading {
  if (figure.state === 'ok' && figure.value !== null) {
    return {
      state: 'ok',
      value: figure.value,
      basis: { kind: 'counts', k: figure.successes, n: figure.answers, noun, prompts: figure.prompts },
    };
  }
  if (figure.state === 'insufficient') return { state: 'insufficient', n: figure.answers, noun };
  return figure.reason === 'notCollected'
    ? { state: 'notCollected' }
    : figure.reason === 'capped'
      ? { state: 'capped' }
      : { state: 'none' };
}

/** One measure over the platforms: its own figure for one platform, else the equal-weight average of those with a rate. */
export function readAcross(
  figures: readonly { code: EngineCode; figure: RateFigure }[],
  single: boolean,
  noun: CountNoun,
): Reading {
  if (figures.length === 0) return { state: 'none' };
  if (single) {
    const [only] = figures;
    return only === undefined ? { state: 'none' } : readingOf(only.figure, noun);
  }
  const rated = figures.filter(({ figure }) => figure.state === 'ok' && figure.value !== null);
  const { value } = equalWeightAverage(rated.map(({ figure }) => figure.value));
  if (value !== null) {
    const parts =
      noun === 'brandMentions'
        ? rated.flatMap(({ code, figure }) =>
            figure.successes === null ? [] : [{ code, k: figure.successes, n: figure.answers }],
          )
        : undefined;
    return {
      state: 'ok',
      value,
      basis: { kind: 'average', codes: rated.map(({ code }) => code), ...(parts === undefined ? {} : { parts }) },
    };
  }
  const thin = figures.filter(({ figure }) => figure.state === 'insufficient');
  if (thin.length === 0) {
    const reasons = figures.map(({ figure }) => figure.reason);
    // Every platform lacks the counts for the same reason: that is the reading, not "no valid answers"
    const [first] = reasons;
    if (first === 'notCollected' && reasons.every((reason) => reason === first)) return { state: 'notCollected' };
    if (first === 'capped' && reasons.every((reason) => reason === first)) return { state: 'capped' };
    return { state: 'none' };
  }
  return { state: 'insufficient', n: Math.max(...thin.map(({ figure }) => figure.answers)), noun };
}

/** The wording a tooltip needs for an insufficient count: a count under the floor is named, else it is just too few. */
export const isNamedCount = (n: number): boolean => n > 0 && n < MIN_OBSERVATIONS;

/** The four segments of the split, in the order of the bar. */
export const SEGMENTS = OUTCOME_PARTS;
export type Segment = OutcomePart;

export interface Split {
  /** Four shares on the 0 to 1 scale. For All platforms the average of the platforms' shares. */
  shares: Readonly<Record<Segment, number>>;
  /** The answers of each share, for one platform only; `null` for the average, which has no pooled count. */
  counts: Readonly<Record<Segment, number>> | null;
  /** The valid answers behind `counts`. */
  answers: number | null;
}

export interface Hero {
  reading: Reading;
  /** The prompts the figure is over, each counted once: all prompts in scope for All platforms, else those answered there. */
  prompts: number | null;
  /** `null` with no rate: the bar is not drawn from nothing. */
  split: Split | null;
}

/** The hero: AI visibility from `visibilityOfPrompts` (the Prompts strip's own function) and the split of its outcomes. */
export function buildHero(
  prompts: readonly PromptSummaryRow[],
  { asked, single }: Platforms,
  promptCount: number | null,
): Hero {
  const figures = asked.map((code) => ({ code, figure: visibilityOfPrompts(prompts, code) }));
  const average =
    single === null ? averageVisibility(figures.map(({ code, figure }) => platformVisibility(code, figure))) : null;
  const reading: Reading =
    average === null
      ? readAcross(figures, true, 'answers')
      : average.state === 'ok' && average.value !== null
        ? { state: 'ok', value: average.value, basis: { kind: 'average', codes: average.names } }
        : average.state === 'insufficient'
          ? { state: 'insufficient', n: average.answers, noun: 'answers' }
          : { state: 'none' };
  if (reading.state !== 'ok') return { reading, prompts: null, split: null };
  const contributing = figures.flatMap(({ code, figure }) => (figure.state === 'ok' ? [{ code, figure }] : []));
  const parts = contributing.map(({ code }) => outcomeFigures(prompts, code));
  const shareOf = (part: Segment): number => equalWeightAverage(parts.map((outcome) => outcome[part].value)).value ?? 0;
  const shares: Record<Segment, number> = {
    mentioned_and_cited: shareOf('mentioned_and_cited'),
    mentioned_only: shareOf('mentioned_only'),
    cited_only: shareOf('cited_only'),
    neither: shareOf('neither'),
  };
  const [first] = parts;
  const counts =
    single !== null && first !== undefined
      ? {
          mentioned_and_cited: first.mentioned_and_cited.successes ?? 0,
          mentioned_only: first.mentioned_only.successes ?? 0,
          cited_only: first.cited_only.successes ?? 0,
          neither: first.neither.successes ?? 0,
        }
      : null;
  return {
    reading,
    prompts: single === null ? promptCount : (contributing[0]?.figure.prompts ?? null),
    split: { shares, counts, answers: counts === null ? null : (first?.mentioned_and_cited.answers ?? null) },
  };
}

/** The tiles that are a rate or an order read from the cells; position, recommendation and sentiment are not here. */
export type CellTile = 'mention' | 'sov' | 'citation';
export type NotCollectedTile = 'position' | 'recommendation' | 'sentiment';

const NOT_COLLECTED: Reading = { state: 'notCollected' };

/** One tile read from the cells of the prompt rows; share of voice from the `total` row, which holds the entity cells. */
export function readTile(
  { prompts, total }: Pick<PromptsSummary, 'prompts' | 'total'>,
  { asked, single }: Platforms,
  tile: CellTile,
): Reading {
  const figures = asked.map((code) => {
    const rates = engineRates(
      prompts,
      code,
      total?.engines.find((engine) => engine.engine_code === code),
    );
    return {
      code,
      figure: tile === 'mention' ? rates.mentioned : tile === 'citation' ? rates.cited : rates.shareOfVoice,
    };
  });
  return readAcross(figures, single !== null, tile === 'sov' ? 'brandMentions' : 'answers');
}

/** The tile of a measure the API does not carry yet. */
export const notCollected = (): Reading => NOT_COLLECTED;

/** The tiles read from the facts of the prompt rows (position counts, recommendation, sentiment counts). */
export type FactTile = 'position' | 'recommendation' | 'sentiment';

/** The platforms a facts tile is over: the one chosen, else every platform asked. */
const factScope = ({ asked, single }: Platforms): string[] => (single === null ? [...asked] : [single]);

/**
 * A tile from the same facts as its card (R12): the mean position (1 is first, lower is better), the recommendation
 * rate, the positive share of the judged mentions. The platforms are never pooled: All platforms is the equal-weight
 * average of those with a figure. Without facts in the rows (production until the backend sends them) the figure is
 * `notCollected`, never a sample.
 */
export function readFactTile(prompts: readonly FactsRow[], platforms: Platforms, tile: FactTile): Reading {
  const scope = factScope(platforms);
  const single = platforms.single !== null;
  if (tile === 'position') {
    // The Mention position card's own reading, so the tile and the card never differ (R12)
    const orders = scope.map((code) => ({ code, order: orderDistribution(prompts, code) }));
    const rated = orders.flatMap(({ code, order }) => (order.state === 'ok' ? [{ code, order }] : []));
    const average = equalWeightAverage(rated.map(({ order }) => order.mean));
    if (average.value !== null) {
      const basis: Basis = single
        ? { kind: 'counts', k: null, n: rated[0]?.order.ordered ?? 0, noun: 'orderedAnswers', prompts: 0 }
        : { kind: 'average', codes: rated.map(({ code }) => code) };
      return { state: 'ok', value: average.value, basis };
    }
    if (orders.every(({ order }) => order.state === 'not_collected')) return NOT_COLLECTED;
    return {
      state: 'insufficient',
      n: Math.max(0, ...orders.map(({ order }) => order.ordered)),
      noun: 'orderedAnswers',
    };
  }
  if (tile === 'recommendation') {
    const recommended = recommendedOf(prompts, scope);
    if (recommended.state === 'ok') {
      const basis: Basis = single
        ? { kind: 'counts', k: null, n: recommended.answers, noun: 'answers', prompts: 0 }
        : { kind: 'average', codes: recommended.codes };
      return { state: 'ok', value: recommended.value, basis };
    }
    if (recommended.reason === 'not_collected') return NOT_COLLECTED;
    if (recommended.reason === 'not_classified') return { state: 'notClassified' };
    return { state: 'insufficient', n: recommended.answers, noun: 'answers' };
  }
  const sentiment = sentimentOf(prompts, scope);
  if (sentiment.state === 'ok' && sentiment.shares !== null) {
    const basis: Basis = single
      ? { kind: 'counts', k: null, n: sentiment.mentions, noun: 'judgedMentions', prompts: 0 }
      : { kind: 'average', codes: sentiment.codes };
    // One platform: the whole percent the Sentiment card prints for Positive (largest remainder over the four shares)
    const positive = single
      ? (wholePercents(SENTIMENT_KEYS.map((key) => sentiment.shares?.[key] ?? 0))[0] ?? 0) / 100
      : sentiment.shares.positive;
    return { state: 'ok', value: positive, basis };
  }
  if (sentiment.state === 'not_collected') return NOT_COLLECTED;
  if (sentiment.state === 'none') return { state: 'notClassified' };
  if (sentiment.state === 'unobserved') return { state: 'none' };
  return { state: 'insufficient', n: sentiment.mentions, noun: 'judgedMentions' };
}

/** The floor each count noun is held to, for the "not enough data" words. */
export const FLOOR_OF: Readonly<Record<CountNoun, number>> = {
  answers: MIN_OBSERVATIONS,
  brandMentions: MIN_OBSERVATIONS,
  orderedAnswers: MIN_OBSERVATIONS,
  judgedMentions: SENTIMENT_MIN,
};

const SPARK_WEEKS = 8;
/** The tiles and the hero (`visibility`) that draw a weekly line. */
export type SparkTile = CellTile | 'visibility';
const TREND_OF = {
  visibility: 'visibility',
  mention: 'mention',
  sov: 'share_of_voice',
  citation: 'citation',
} as const satisfies Record<SparkTile, WeekMetric>;

/**
 * The last eight weekly points of a tile or the hero, a gap as `null`: a week of one platform that has a rate (a
 * point under the floor has none), or for All platforms the equal-weight average of the platforms that have one that
 * week. Fewer than two points is no line, so `null`: with no weekly visibility from the API (backend request 1) the
 * hero has none, and nothing is made up.
 */
export function sparkOf(
  summary: PromptsSummary,
  { asked, single }: Platforms,
  tile: SparkTile,
): (number | null)[] | null {
  const metric = TREND_OF[tile];
  const range = summary.window;
  const byPlatform = asked.map(
    (code) =>
      new Map(
        projectWeeks(summary, code, metric, range).map((point) => [point.weekStart, point.thin ? null : point.value]),
      ),
  );
  const weeks = [...new Set(byPlatform.flatMap((points) => [...points.keys()]))].sort().slice(-SPARK_WEEKS);
  const values = weeks.map((weekStart) => {
    const week = byPlatform.map((points) => points.get(weekStart) ?? null);
    return single === null ? equalWeightAverage(week).value : (week[0] ?? null);
  });
  return values.filter((value) => value !== null).length >= 2 ? values : null;
}

/** The runs that collected answers: a planned, cancelled, blocked or failed run holds none behind the numbers. */
const COLLECTING: ReadonlySet<Run['status']> = new Set(['running', 'completed', 'completed_with_errors']);

export interface RunsInWindow {
  /** How many collecting runs began inside the window, in project days. */
  count: number;
  /** When the newest of them finished (or began, while it is running); `null` with none. */
  last: string | null;
}

/**
 * The runs behind the numbers: the collecting ones that began on a day of the window, in the project's zone.
 * shortcut: the caller asks for the newest 200 runs, so a window with more of them counts only those.
 */
export function runsInWindow(
  runs: readonly Run[],
  range: { from: string; to: string },
  timeZone: string,
): RunsInWindow {
  const inside = runs.filter((run) => {
    if (!COLLECTING.has(run.status)) return false;
    const day = formatIsoDate(run.created_at, timeZone);
    return day >= range.from && day <= range.to;
  });
  const times = inside.map((run) => run.completed_at ?? run.created_at).sort();
  return { count: inside.length, last: times.at(-1) ?? null };
}
