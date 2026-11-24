import { cell, promptWeighted } from './prompt-summary';
import type {
  AnswerFactsExtra,
  EngineFacts,
  EngineSummaryWithFacts,
  LatestAnswer,
  LinkedKeywordVolume,
  OrderCounts,
  OtherBrand,
  PositionCounts,
  PromptIntent,
  PromptSummaryRowWithFacts,
  SentimentCounts,
  TopicSummaryRowWithFacts,
  TopLink,
} from '@/lib/api/prompt-facts';
import type {
  CitationOut,
  EngineSummary,
  MetricCell,
  ObservationDetail,
  PromptSummaryRow,
  TopicSummaryRow,
} from '@/lib/api/types';

/**
 * The facts of the new Prompts columns for the mocks (`include=facts` of the prompts summary), made from the answers of
 * a window so they never change between requests: where an answer holds the fact (position, cited links, the newest
 * answer) it is read from it; the rest (sentiment, recommendation, brands nobody tracks, search volume) is sample data
 * drawn from seeds, labelled so in the backend request list. Nothing here reaches production: the real API sends the
 * fields when they are built, and the app reads an absent field as unknown.
 */

type Facts = NonNullable<ObservationDetail['facts']>;

/** An answer as the facts read it: its id, its time, its fact row and its sources. */
export interface FactsAnswer {
  id: string;
  at: string;
  facts: Facts;
  citations: readonly CitationOut[];
}

/** What a prompt row needs besides its answers. */
export interface FactsPrompt {
  intent: PromptIntent;
  /** The names of the topics the prompt is in, the first one names its keyword. */
  topicNames: readonly string[];
}

/** The brands the answers name that nobody tracks, as the design preview draws them. */
export const OTHER_BRANDS: readonly string[] = [
  'Copper',
  'Insightly',
  'Monday CRM',
  'Close',
  'Nutshell',
  'Zendesk Sell',
  'Keap',
  'Capsule',
  'Less Annoying CRM',
  'Apptivo',
];

/** Engines whose answers are classified for sentiment and recommendation (ChatGPT and Gemini, as in the preview). */
const CLASSIFYING: ReadonlySet<string> = new Set(['chatgpt_web', 'gemini_web']);
const LINKS_MAX = 20;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The preview's seeded generator (mulberry32): the same seed gives the same draws. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(text: string): number {
  let value = 7;
  for (const character of text) value = (value * 31 + character.charCodeAt(0)) % 2147483647;
  return value;
}

// ---- The keyword a prompt is linked to, and its searches --------------------------------------------------------

const KEYWORD_SUFFIX: readonly string[] = ['agency', 'services', 'tools', 'software', 'pricing'];

/** The keyword a prompt is linked to, or null for about one prompt in five. Prompts of one topic share a few keywords. */
/**
 * What an answer adds for the prompt drawer, as sample data from the answer's id: ChatGPT and Gemini classify the
 * recommendation, one answer in three that names the brand is a list with a place in it. Nothing here reaches production.
 */
export function answerFactsExtra(observationId: string, code: string, facts: Facts): AnswerFactsExtra {
  const seed = hashText(observationId);
  const place = facts.own_mention_order;
  return {
    recommended: CLASSIFYING.has(code) ? facts.own_mentioned && seed % 5 < 3 : null,
    list_rank:
      place !== null && seed % 3 === 0
        ? { place, listed: Math.max(place, facts.tracked_entities_mentioned) + (seed % 2) }
        : null,
  };
}

export function linkedKeywordOf(promptId: string, topicNames: readonly string[]): LinkedKeywordVolume | null {
  const seed = hashText(promptId);
  if (seed % 5 === 0) return null;
  const [topic] = topicNames;
  const keyword = `${(topic ?? 'ai visibility').toLowerCase()} ${KEYWORD_SUFFIX[seed % 3] ?? 'agency'}`;
  const random = seeded(hashText(keyword));
  const low = Math.log(90);
  const high = Math.log(18000);
  // One keyword in eleven has no metrics yet, so the column shows its unknown state too
  const volume = hashText(keyword) % 11 === 0 ? null : Math.round(Math.exp(low + random() * (high - low)) / 10) * 10;
  // The rank check of the keyword, as the preview draws it: a place or beyond 20, an overview that cites the site or not
  const rank = hashText(`${keyword}:rank`) % 9 === 0 ? null : (hashText(`${keyword}:rank`) % 12) + 1;
  const overview = hashText(`${keyword}:overview`) % 3;
  return {
    keyword,
    search_volume: volume,
    rank,
    ai_overview: overview === 0 ? null : { cited_position: overview === 1 ? null : (hashText(keyword) % 3) + 1 },
  };
}

// ---- One prompt on one engine ----------------------------------------------------------------------------------

/** What the answers of one prompt on one engine say, before they become cells. */
/** The newest valid answer of an engine for a prompt: what `latest` is made from. */
export type NewestAnswer = Pick<LatestAnswer, 'observation_id' | 'observed_at'>;

export interface EnginePiece {
  /** Every counted answer, valid or not. */
  observations: number;
  valid: number;
  position: PositionCounts;
  sentiment: SentimentCounts | null;
  recommendedK: number | null;
  others: readonly { name: string; k: number }[];
  links: ReadonlyMap<string, TopLink>;
  latest: NewestAnswer | null;
}

/** Positive, neutral, negative and mixed counts of the mentions on one engine; they always add up to its mentions. */
function sentimentCounts(promptId: string, code: string, mentions: number): SentimentCounts {
  const strength = seeded(hashText(promptId) + 99)();
  const random = seeded(hashText(promptId) + 313 + hashText(code) * 29);
  const positive = Math.round(mentions * clamp(0.3 + strength * 0.55 + (random() - 0.5) * 0.25, 0.12, 0.92));
  const negative = Math.min(
    mentions - positive,
    Math.round(mentions * clamp(0.14 - strength * 0.1 + (random() - 0.5) * 0.08, 0.01, 0.3)),
  );
  const mixed = Math.min(mentions - positive - negative, Math.round(mentions * clamp(0.04 + random() * 0.05, 0, 0.12)));
  return { positive, neutral: mentions - positive - negative - mixed, negative, mixed };
}

/** The places of the answers that name the brand with one: counts of first, second, third, fourth or later, and their sum. */
function orderCounts(orders: readonly number[]): OrderCounts {
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const order of orders) {
    const slot = Math.min(Math.max(order, 1), 4) - 1;
    counts[slot] = (counts[slot] ?? 0) + 1;
  }
  return { counts, rank_sum: orders.reduce((total, order) => total + order, 0) };
}

export function enginePieceOf(promptId: string, code: string, answers: readonly FactsAnswer[]): EnginePiece {
  const valid = answers.filter((answer) => answer.facts.is_valid);
  const named = valid.filter((answer) => answer.facts.own_mentioned);
  // An ordered answer: a list that names the brand with a place in it
  const ordered = named.filter((answer) => answer.facts.had_structured_list && answer.facts.own_mention_order !== null);
  const classified = CLASSIFYING.has(code);
  const random = seeded(hashText(promptId) + 521 + hashText(code) * 31);
  const links = new Map<string, TopLink>();
  for (const answer of valid) {
    const cited = new Set<string>();
    for (const citation of answer.citations) {
      if (cited.has(citation.url)) continue;
      cited.add(citation.url);
      const known = links.get(citation.url);
      links.set(citation.url, {
        url: citation.url,
        domain: citation.host,
        domain_role: citation.domain_role,
        answers: (known?.answers ?? 0) + 1,
      });
    }
  }
  const newest = valid.reduce<FactsAnswer | null>(
    (best, answer) => (best === null || Date.parse(answer.at) > Date.parse(best.at) ? answer : best),
    null,
  );
  return {
    observations: answers.length,
    valid: valid.length,
    position: {
      rank_sum: ordered.reduce((sum, answer) => sum + (answer.facts.own_mention_order ?? 0), 0),
      ordered_answers: ordered.length,
      mentions: named.length,
      answers: valid.length,
      by_order: orderCounts(named.flatMap((answer) => answer.facts.own_mention_order ?? [])),
    },
    sentiment: classified ? sentimentCounts(promptId, code, named.length) : null,
    recommendedK: classified
      ? Math.min(named.length, Math.round(named.length * clamp(0.5 + (random() - 0.5) * 0.4, 0.2, 0.9)))
      : null,
    others: OTHER_BRANDS.map((name, index) => ({
      name,
      k: clamp(Math.round(valid.length * (0.11 - index * 0.009) * (0.4 + random() * 1.2)), 0, valid.length),
    })).filter((brand) => brand.k > 0),
    links,
    latest: newest === null ? null : { observation_id: newest.id, observed_at: newest.at },
  };
}

const byLinks = (a: TopLink, b: TopLink): number =>
  b.answers - a.answers || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

/** The facts of a prompt row's engine: plain counts of its valid answers. `latestOf` adds the screenshot state. */
export function promptEngineFacts(piece: EnginePiece, latestOf: (newest: NewestAnswer) => LatestAnswer): EngineFacts {
  const { valid, observations } = piece;
  return {
    position: piece.position,
    sentiment: piece.sentiment,
    recommended: piece.recommendedK === null ? null : cell(piece.recommendedK, valid, observations),
    other_brands: piece.others.map((brand): OtherBrand => ({
      name: brand.name,
      mentioned: cell(brand.k, valid, observations),
    })),
    top_links: [...piece.links.values()].sort(byLinks).slice(0, LINKS_MAX),
    latest: piece.latest === null ? null : latestOf(piece.latest),
  };
}

/** The facts of a topic row's engine from the pieces of its prompts that have an answer on it: prompt weighted. */
export function topicEngineFacts(code: string, pieces: readonly EnginePiece[]): EngineFacts {
  const observations = pieces.reduce((sum, piece) => sum + piece.observations, 0);
  const sum = (pick: (counts: PositionCounts) => number): number =>
    pieces.reduce((total, piece) => total + pick(piece.position), 0);
  const tone = (key: keyof SentimentCounts): number =>
    pieces.reduce((total, piece) => total + (piece.sentiment?.[key] ?? 0), 0);
  const weighted = (pick: (piece: EnginePiece) => number): MetricCell =>
    promptWeighted(
      pieces.map((piece) => [pick(piece), piece.valid] as const),
      observations,
    );
  const names = [...new Set(pieces.flatMap((piece) => piece.others.map((brand) => brand.name)))];
  const links = new Map<string, TopLink>();
  for (const piece of pieces) {
    for (const link of piece.links.values()) {
      const known = links.get(link.url);
      links.set(link.url, { ...link, answers: (known?.answers ?? 0) + link.answers });
    }
  }
  const classified = CLASSIFYING.has(code);
  return {
    position: {
      rank_sum: sum((counts) => counts.rank_sum),
      ordered_answers: sum((counts) => counts.ordered_answers),
      mentions: sum((counts) => counts.mentions),
      answers: sum((counts) => counts.answers),
      by_order: {
        counts: [
          sum((counts) => counts.by_order?.counts[0] ?? 0),
          sum((counts) => counts.by_order?.counts[1] ?? 0),
          sum((counts) => counts.by_order?.counts[2] ?? 0),
          sum((counts) => counts.by_order?.counts[3] ?? 0),
        ],
        rank_sum: sum((counts) => counts.by_order?.rank_sum ?? 0),
      },
    },
    sentiment: classified
      ? {
          positive: tone('positive'),
          neutral: tone('neutral'),
          negative: tone('negative'),
          mixed: tone('mixed'),
        }
      : null,
    recommended: classified ? weighted((piece) => piece.recommendedK ?? 0) : null,
    other_brands: names.map((name): OtherBrand => ({
      name,
      mentioned: weighted((piece) => piece.others.find((brand) => brand.name === name)?.k ?? 0),
    })),
    top_links: [...links.values()].sort(byLinks).slice(0, LINKS_MAX),
  };
}

// ---- The rows --------------------------------------------------------------------------------------------------

export interface FactsBuilderInput {
  /** The prompts of the window with their intent and topics, by prompt id. */
  prompts: ReadonlyMap<string, FactsPrompt>;
  /** The counted answers of a prompt on an engine in the window. */
  answers: (promptId: string, code: string) => readonly FactsAnswer[];
  /** The newest answer of an engine as `latest` says it, with the state of its screenshot. */
  latestOf: (code: string, newest: NewestAnswer) => LatestAnswer;
}

export interface FactsBuilder {
  promptRow: (row: PromptSummaryRow) => PromptSummaryRowWithFacts;
  topicRow: (row: TopicSummaryRow, members: ReadonlySet<string>) => TopicSummaryRowWithFacts;
}

/**
 * Adds the facts to the rows of a prompts summary: a prompt row gets its intent and linked keyword and, on each engine,
 * its facts; a topic row gets its linked keywords (each once) and its engines' facts from the prompts that answered.
 * An engine that has no counted answer for a prompt has the facts of an empty piece: zero counts, no list, no latest.
 */
export function factsBuilder({ prompts, answers, latestOf }: FactsBuilderInput): FactsBuilder {
  const pieceOf = (promptId: string, code: string): EnginePiece =>
    enginePieceOf(promptId, code, answers(promptId, code));
  const withFacts = (engine: EngineSummary, facts: EngineFacts): EngineSummaryWithFacts => ({ ...engine, ...facts });
  return {
    promptRow: (row) => {
      const found = prompts.get(row.prompt_id);
      return {
        ...row,
        ...(found === undefined
          ? {}
          : { intent: found.intent, linked_keyword: linkedKeywordOf(row.prompt_id, found.topicNames) }),
        engines: row.engines.map((engine) =>
          withFacts(
            engine,
            promptEngineFacts(pieceOf(row.prompt_id, engine.engine_code), (newest) =>
              latestOf(engine.engine_code, newest),
            ),
          ),
        ),
      };
    },
    topicRow: (row, members) => ({
      ...row,
      linked_keywords: [
        ...new Map(
          [...members].flatMap((id) => {
            const found = prompts.get(id);
            const link = found === undefined ? null : linkedKeywordOf(id, found.topicNames);
            return link === null ? [] : [[link.keyword, link] as const];
          }),
        ).values(),
      ],
      engines: row.engines.map((engine) =>
        withFacts(
          engine,
          topicEngineFacts(
            engine.engine_code,
            [...members]
              .filter((id) => answers(id, engine.engine_code).length > 0)
              .map((id) => pieceOf(id, engine.engine_code)),
          ),
        ),
      ),
    }),
  };
}
