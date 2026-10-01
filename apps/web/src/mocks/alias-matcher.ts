import type { StoredAlias, StoredDomain, StoredEntity } from './entities-state';

/**
 * The alias test's matcher (19 section 3.4, `POST {P}/alias-test`), a small model of the backend's stages 4
 * and 5 (docs/13-ai-extraction-engine.md, backend `extraction/aliases.py`):
 *
 * - word aliases match between word boundaries and allow a plural `s` or `es`; exact-case aliases too, with
 *   case; substrings anywhere; regex aliases as written; every entity's name by itself, as a word alias that
 *   ignores case (`alias_name`, which a stored alias of the same span replaces); and each host or registrable
 *   domain of an entity is a domain-shaped alias (`acme.io`, without `www.`);
 * - a positive span inside a negative alias's span is dropped, and the negative is reported;
 * - a span scores 0.95, or 0.30 for an ambiguous entity or an alias that needs context, plus 0.35 when one of
 *   the entity's hints is within 40 words (backend plan D6); 0.70 and up is accepted, 0.40 and up uncertain;
 * - of overlapping spans the longest wins, spans that count before discarded ones; a product's span also
 *   counts for its brand.
 *
 * Offsets are UTF-16 code units, which is what JavaScript's string indices are. Unlike the backend, the mock
 * folds no accents, quotes or dashes.
 */

type MatchMethod =
  'alias_word' | 'alias_exact' | 'alias_substring' | 'alias_regex' | 'alias_name' | 'alias_domain' | 'via_product';
type MentionStatus = 'accepted' | 'uncertain' | 'discarded';

export interface MatcherEntity {
  entity: StoredEntity;
  aliases: readonly StoredAlias[];
  domains: readonly StoredDomain[];
}

interface MatchSpan {
  start: number;
  end: number;
  alias_id: string | null;
  match_method: MatchMethod;
  score: number;
  status: MentionStatus;
}

interface MatchMention {
  entity_id: string;
  spans: MatchSpan[];
  confidence: number;
  status: MentionStatus;
}

interface MatchResult {
  mentions: MatchMention[];
  negatives_applied: { start: number; end: number; alias_id: string }[];
  skipped_alias_ids: string[];
}

/** More matches than this in one text is refused (`422 too_many_matches`), as the backend refuses it. */
const MAX_HITS = 250_000;

export class TooManyMatchesError extends Error {
  constructor() {
    super(`The text matched more than ${String(MAX_HITS)} times`);
    this.name = 'TooManyMatchesError';
  }
}

const BASE_PLAIN = 0.95;
const BASE_NEEDS_CONTEXT = 0.3;
const HINT_NEAR = 0.35;
const HINT_WINDOW_TOKENS = 40;
const ACCEPTED_FROM = 0.7;
const UNCERTAIN_FROM = 0.4;

const METHOD: Readonly<Record<'word_boundary' | 'exact_case' | 'substring' | 'regex', MatchMethod>> = {
  word_boundary: 'alias_word',
  exact_case: 'alias_exact',
  substring: 'alias_substring',
  regex: 'alias_regex',
};
/** When one entity is matched twice on the same span, the more specific method is kept. */
const METHOD_RANK: Readonly<Record<MatchMethod, number>> = {
  alias_exact: 0,
  alias_word: 1,
  alias_substring: 2,
  alias_regex: 3,
  alias_name: 4,
  alias_domain: 5,
  via_product: 6,
};

const WORD = '[\\p{L}\\p{N}\\p{M}_]';
const IS_WORD = new RegExp(`^${WORD}$`, 'u');
const TOKEN = /[\p{L}\p{N}]+/gu;

/** `text` with the characters regular expressions treat as syntax escaped (valid with the `u` flag). */
const escaped = (text: string): string => text.replace(/[\^$\\.*+?()[\]{}|/]/g, '\\$&');

interface Hit {
  start: number;
  end: number;
  entityId: string;
  aliasId: string | null;
  method: MatchMethod;
  negative: boolean;
  needsContext: boolean;
}

interface Pattern {
  regex: RegExp;
  entityId: string;
  alias: StoredAlias | null;
  method: MatchMethod;
}

/** A word or exact-case alias between word boundaries, a plural allowed; a substring anywhere. */
function aliasPattern(alias: StoredAlias): RegExp {
  const mode = alias.match_mode ?? 'word_boundary';
  const sensitive = (alias.case_sensitive ?? false) || mode === 'exact_case';
  return mode === 'substring'
    ? new RegExp(wordsOf(alias.alias), sensitive ? 'gu' : 'giu')
    : wordPattern(alias.alias, sensitive);
}

/** The text with any run of spaces matching any run of whitespace. */
const wordsOf = (text: string): string => text.trim().split(/\s+/u).map(escaped).join('\\s+');

/** `text` between word boundaries, a plural allowed. */
function wordPattern(text: string, sensitive: boolean): RegExp {
  const first = text.trim().at(0) ?? '';
  const last = text.trim().at(-1) ?? '';
  // A side needs a boundary only where the text itself has a word character there (`C++`)
  const before = IS_WORD.test(first) ? `(?<!${WORD})` : '';
  const after = IS_WORD.test(last) ? `(?=(?:es|s)?(?!${WORD}))` : '';
  return new RegExp(`${before}${wordsOf(text)}${after}`, sensitive ? 'gu' : 'giu');
}

/** `www.acme.io` and `acme.io/pricing` hold the domain; `notacme.io` and `acme.io.evil.com` do not. */
const domainPattern = (host: string): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}\\p{M}_-])${escaped(host.replace(/^www\./, ''))}(?![\\p{L}\\p{N}\\p{M}_-]|\\.${WORD})`,
    'giu',
  );

function patternsOf(entities: readonly MatcherEntity[], skipped: string[]): Pattern[] {
  const patterns: Pattern[] = [];
  for (const { entity, aliases, domains } of entities) {
    for (const alias of aliases) {
      const mode = alias.match_mode ?? 'word_boundary';
      let regex: RegExp;
      try {
        regex = mode === 'regex' ? new RegExp(alias.alias, alias.case_sensitive ? 'gu' : 'giu') : aliasPattern(alias);
      } catch (error) {
        // A stored pattern the matcher cannot run is left out and named, so one alias cannot stop the test
        if (!(error instanceof SyntaxError)) throw error;
        skipped.push(alias.alias_id);
        continue;
      }
      patterns.push({ regex, entityId: entity.entity_id, alias, method: METHOD[mode] });
    }
    // The name by itself, so an entity with no aliases is still found
    if (entity.canonical_name.trim() !== '') {
      patterns.push({
        regex: wordPattern(entity.canonical_name, false),
        entityId: entity.entity_id,
        alias: null,
        method: 'alias_name',
      });
    }
    const hosts = new Set(
      domains.filter((domain) => (domain.match_scope ?? 'registrable') !== 'path_prefix').map((domain) => domain.host),
    );
    for (const host of hosts) {
      patterns.push({ regex: domainPattern(host), entityId: entity.entity_id, alias: null, method: 'alias_domain' });
    }
  }
  return patterns;
}

function hitsOf(text: string, patterns: readonly Pattern[], entities: ReadonlyMap<string, StoredEntity>): Hit[] {
  const hits: Hit[] = [];
  for (const pattern of patterns) {
    const ambiguous = entities.get(pattern.entityId)?.is_ambiguous ?? false;
    for (const found of text.matchAll(pattern.regex)) {
      if (found[0] === '') continue;
      hits.push({
        start: found.index,
        end: found.index + found[0].length,
        entityId: pattern.entityId,
        aliasId: pattern.alias?.alias_id ?? null,
        method: pattern.method,
        negative: pattern.alias?.is_negative ?? false,
        needsContext: ambiguous || (pattern.alias?.requires_context ?? false),
      });
      if (hits.length > MAX_HITS) throw new TooManyMatchesError();
    }
  }
  return hits;
}

const statusOf = (score: number): MentionStatus =>
  score >= ACCEPTED_FROM ? 'accepted' : score >= UNCERTAIN_FROM ? 'uncertain' : 'discarded';

const tokensOf = (text: string): string[] => [...text.toLowerCase().matchAll(TOKEN)].map((found) => found[0]);

interface Token {
  start: number;
  word: string;
}

/** Whether one of `hints` (each one or more words) is within the token window around the span. */
function hintNear(tokens: readonly Token[], hit: Hit, hints: readonly string[]): boolean {
  if (hints.length === 0) return false;
  const first = tokens.findIndex((token) => token.start >= hit.start);
  const firstInside = first === -1 ? tokens.length : first;
  const after = tokens.findIndex((token) => token.start >= hit.end);
  const firstAfter = after === -1 ? tokens.length : after;
  const window = [
    ...tokens.slice(Math.max(0, firstInside - HINT_WINDOW_TOKENS), firstInside),
    ...tokens.slice(firstAfter, firstAfter + HINT_WINDOW_TOKENS),
  ].map((token) => token.word);
  return hints.some((hint) => {
    const words = tokensOf(hint);
    if (words.length === 0) return false;
    return window.some((_, index) => words.every((word, offset) => window[index + offset] === word));
  });
}

/** The longest span wins; every hit on exactly that span keeps it. `taken` is extended in place. */
function resolveOverlaps<T extends { hit: Hit }>(candidates: readonly T[], taken: [number, number][]): T[] {
  const byRange = new Map<string, T[]>();
  for (const candidate of candidates) {
    const key = `${String(candidate.hit.start)}:${String(candidate.hit.end)}`;
    byRange.set(key, [...(byRange.get(key) ?? []), candidate]);
  }
  const ranges = [...byRange.values()].sort(
    (a, b) =>
      (b[0]?.hit.end ?? 0) - (b[0]?.hit.start ?? 0) - ((a[0]?.hit.end ?? 0) - (a[0]?.hit.start ?? 0)) ||
      (a[0]?.hit.start ?? 0) - (b[0]?.hit.start ?? 0),
  );
  const accepted: T[] = [];
  for (const group of ranges) {
    const head = group[0];
    if (!head) continue;
    const { start, end } = head.hit;
    if (taken.some(([takenStart, takenEnd]) => start < takenEnd && takenStart < end)) continue;
    taken.push([start, end]);
    accepted.push(...group);
  }
  return accepted;
}

export function matchAliases(text: string, entities: readonly MatcherEntity[]): MatchResult {
  const skipped: string[] = [];
  const byId = new Map(entities.map(({ entity }) => [entity.entity_id, entity]));
  const hits = hitsOf(text, patternsOf(entities, skipped), byId);

  const negatives = hits.filter((hit) => hit.negative);
  const positives = hits.filter((hit) => !hit.negative);
  const applied = new Map<string, { start: number; end: number; alias_id: string }>();
  const kept = positives.filter((hit) => {
    const covering = negatives.filter((negative) => negative.start <= hit.start && hit.end <= negative.end);
    for (const negative of covering) {
      const aliasId = negative.aliasId ?? '';
      applied.set(`${String(negative.start)}:${String(negative.end)}:${aliasId}`, {
        start: negative.start,
        end: negative.end,
        alias_id: aliasId,
      });
    }
    return covering.length === 0;
  });

  const tokens: Token[] = kept.some((hit) => hit.needsContext)
    ? [...text.matchAll(TOKEN)].map((found) => ({ start: found.index, word: found[0].toLowerCase() }))
    : [];
  const scored = kept.map((hit) => {
    const entity = byId.get(hit.entityId);
    const base = hit.needsContext ? BASE_NEEDS_CONTEXT : BASE_PLAIN;
    const near = hit.needsContext && hintNear(tokens, hit, entity?.disambiguation_hints ?? []);
    const score = Math.round(Math.min(1, base + (near ? HINT_NEAR : 0)) * 100) / 100;
    return { hit, score };
  });
  // Spans that would be discarded do not take text from spans that would count
  const taken: [number, number][] = [];
  const winners = [
    ...resolveOverlaps(
      scored.filter(({ score }) => statusOf(score) !== 'discarded'),
      taken,
    ),
    ...resolveOverlaps(
      scored.filter(({ score }) => statusOf(score) === 'discarded'),
      taken,
    ),
  ];

  const spans = new Map<string, Map<string, MatchSpan>>();
  const keep = (entityId: string, span: MatchSpan): void => {
    const ofEntity = spans.get(entityId) ?? new Map<string, MatchSpan>();
    const key = `${String(span.start)}:${String(span.end)}`;
    const current = ofEntity.get(key);
    if (!current || METHOD_RANK[span.match_method] < METHOD_RANK[current.match_method]) ofEntity.set(key, span);
    spans.set(entityId, ofEntity);
  };
  for (const { hit, score } of winners) {
    const span: MatchSpan = {
      start: hit.start,
      end: hit.end,
      alias_id: hit.aliasId,
      match_method: hit.method,
      score,
      status: statusOf(score),
    };
    keep(hit.entityId, span);
    const parent = byId.get(hit.entityId)?.parent_entity_id ?? null;
    if (parent !== null && byId.has(parent)) keep(parent, { ...span, match_method: 'via_product' });
  }

  const mentions = [...spans.entries()].map(([entityId, byRange]): MatchMention => {
    const ordered = [...byRange.values()].sort((a, b) => a.start - b.start || a.end - b.end);
    const confidence = Math.max(...ordered.map((span) => span.score));
    return { entity_id: entityId, spans: ordered, confidence, status: statusOf(confidence) };
  });
  // By the first span that counts; mentions with none come after, by their first span
  const firstCounting = (mention: MatchMention): number =>
    mention.spans.find((span) => span.status !== 'discarded')?.start ?? Number.POSITIVE_INFINITY;
  mentions.sort(
    (a, b) =>
      firstCounting(a) - firstCounting(b) ||
      (a.spans[0]?.start ?? 0) - (b.spans[0]?.start ?? 0) ||
      a.entity_id.localeCompare(b.entity_id),
  );

  return {
    mentions,
    negatives_applied: [...applied.values()].sort(
      (a, b) => a.start - b.start || a.end - b.end || a.alias_id.localeCompare(b.alias_id),
    ),
    skipped_alias_ids: skipped,
  };
}
