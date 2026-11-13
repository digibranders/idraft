import { matchAliases, type MatcherEntity } from './alias-matcher';
import { isActiveRole, type EntityWorld } from './entities-state';
import { usdOfMicros } from './factories/operations';
import { AI_ANSWER_MICROS } from './operations-fixtures';
import { ENGINE_FACTS, PROMPT_TEXT_MAX } from './prompt-fixtures';
import type { EngineCode, Schemas } from '@/lib/api/types';
import { textLength } from '@/lib/text/length';

/**
 * The lint rules and the items bookkeeping of contract C1 for the mocks: a model of the backend's
 * `api/ai/prompt_lint.py` (the five rules that read a text) and of `match_items` and `estimate_cost` in
 * `api/ai/prompt_service.py`, with the wording of c1-prompts.md. Pure: the handler hands over the names the
 * matcher found and the project's prompts.
 * shortcut: `\w` is ASCII here where the backend's is Unicode, so a superlative next to a non-ASCII letter reads as
 * a word of its own; and the function words cover the seven Latin languages the backend covers. Widen both with the
 * backend.
 */

type LintRule = Schemas['LintWarning']['rule'];
type Severity = Schemas['LintWarning']['severity'];
type PromptType = Schemas['PromptLint']['suggested_prompt_type'];

export interface Finding {
  rule: LintRule;
  severity: Severity;
  message: string;
  /** UTF-16 code units, as a JavaScript string indexes the text. */
  span: { start: number; end: number } | null;
}

/** An own or competitor name the matcher found: its accepted places, as UTF-16 offsets in text order. */
export interface Named {
  name: string;
  isCompetitor: boolean;
  spans: readonly (readonly [number, number])[];
}

export const WORDS_MIN = 5;
export const WORDS_MAX = 60;
/** A superlative this many words or fewer from a name leads the answer. */
const LEADING_DISTANCE = 3;
/** A shorter text is too short to tell its language. */
const MISMATCH_MIN_WORDS = 4;
/** Percent of the letters in scripts the language does not use. */
const FOREIGN_LETTERS_PERCENT = 60;
/** Another language's function words must hit this many times more than the set language's. */
const FUNCTION_WORD_MARGIN = 2;
const RUNS_PER_WEEK = 2;
const ANSWERS_PER_ENGINE = 1;
const MICROS_PER_CENT = 10_000;
/** The engines the price book has no price for: their cost is `null`, never a guess of zero. */
const UNPRICED: ReadonlySet<EngineCode> = new Set<EngineCode>(['google_ai_mode']);

const QUESTION_MARKS = ['?', '？', '؟'];
const QUESTION_RUN = /[?？؟]+/g;
const HOW_TO = /(?<!\w)how\s+to(?!\w)/;
const LEADING_WORD = /^\W*(\w+)/;
const INTERROGATIVES = new Set([
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'where',
  'when',
  'why',
  'how',
  'is',
  'are',
  'can',
  'could',
  'should',
  'does',
  'do',
  'did',
  'will',
  'would',
]);
const COMPARISON = /(?<!\w)(?:vs\.?|versus)(?!\w)/i;
const SUPERLATIVE = /(?<![\w#])(?:best|top|leading|greatest|number\s+one|#1)(?!\w)/gi;
/** Sentence ending punctuation: ASCII, fullwidth, ideographic and Arabic. */
const SENTENCE_END = '.?!\\uff1f\\uff01\\u3002\\u061f';
/** "why is <words> the best" inside one sentence; group 1 is the superlative. */
const WHY_IS_BEST = new RegExp(
  `(?<!\\w)why\\s+is\\s+[^\\s${SENTENCE_END}][^${SENTENCE_END}]*?\\s+the\\s+(best)(?!\\w)`,
  'id',
);

const SCRIPT_NAMES = [
  'Latin',
  'Cyrillic',
  'Han',
  'Hiragana',
  'Katakana',
  'Hangul',
  'Arabic',
  'Hebrew',
  'Greek',
  'Thai',
  'Devanagari',
  'Lao',
  'Khmer',
  'Myanmar',
] as const;
const SCRIPT_TESTS = SCRIPT_NAMES.map(
  (name) => [name.toUpperCase(), new RegExp(`^\\p{Script=${name}}$`, 'u')] as const,
);
/** Scripts whose words are not separated by spaces: a token counts half its characters. */
const UNSPACED = new Set(['HAN', 'HIRAGANA', 'KATAKANA', 'THAI', 'LAO', 'KHMER', 'MYANMAR']);

/** The scripts each language is written in; a language not listed is not checked. */
const SCRIPTS = new Map<string, ReadonlySet<string>>(
  (
    [
      ['en de fr es it pt nl sv da no nb fi pl cs sk hu ro tr id vi ca', 'LATIN'],
      ['ru uk bg be mk kk', 'CYRILLIC'],
      ['sr', 'CYRILLIC LATIN'],
      ['ja', 'HAN HIRAGANA KATAKANA'],
      ['zh', 'HAN'],
      ['ko', 'HANGUL HAN'],
      ['ar fa ur', 'ARABIC'],
      ['he', 'HEBREW'],
      ['el', 'GREEK'],
      ['th', 'THAI'],
      ['hi', 'DEVANAGARI'],
    ] as const
  ).flatMap(([codes, names]) => codes.split(' ').map((code) => [code, new Set(names.split(' '))] as const)),
);

const LANGUAGES = new Map<string, string>([
  ['en', 'English'],
  ['de', 'German'],
  ['fr', 'French'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['ko', 'Korean'],
  ['ar', 'Arabic'],
  ['he', 'Hebrew'],
  ['el', 'Greek'],
  ['th', 'Thai'],
  ['hi', 'Hindi'],
]);

const FUNCTION_WORDS = new Map<string, ReadonlySet<string>>(
  (
    [
      [
        'en',
        'the is are were of and to for with what which how why when where who that this these those does did can could should would you your we they it not be from by about than',
      ],
      [
        'de',
        'der die das ist und zu nicht ein eine einer einen mit für von welche welcher welches wie warum wer wo auf im den dem des sich wir ich oder bei aus sind kann wird',
      ],
      [
        'fr',
        'le la les un une des du de et est sont pas pour dans que qui quoi quel quelle quels quelles comment pourquoi avec sur par au aux ce cette ces vous nous je il elle ou où en',
      ],
      [
        'es',
        'de y en lo mi el la los las un una unos unas es son para por con que qué cuál cuáles cómo quién dónde cuándo del al se su sus esta este',
      ],
      [
        'it',
        'e il lo la le gli un una uno di del della dei che per con non sono come quale quali cosa è nel nella sul anche questo questa perché dove quando chi',
      ],
      [
        'pt',
        'e a o os um uma de do da dos das que para com não por em mais como qual quais você é são ao na nos ele ela',
      ],
      [
        'nl',
        'de het een en van voor niet met op dat die wat welke hoe waarom wie waar zijn ik je jij wij ook naar bij aan uit kan wordt deze',
      ],
    ] as const
  ).map(([code, words]) => [code, new Set(words.split(' '))] as const),
);

/** The script a character belongs to, as an upper case name; `OTHER` for a script the rules do not name. */
const scriptOf = (char: string): string => SCRIPT_TESTS.find(([, test]) => test.test(char))?.[0] ?? 'OTHER';
const isLetter = (char: string): boolean => /^\p{L}$/u.test(char);
const title = (name: string): string => `${name.charAt(0)}${name.slice(1).toLowerCase()}`;

/** White space tokens; a token holding a character of a script written without spaces counts half its characters, rounded up. */
export function countWords(text: string): number {
  return text
    .split(/\s+/)
    .filter((token) => token !== '')
    .reduce((sum, token) => {
      const chars = [...token];
      return sum + (chars.some((char) => UNSPACED.has(scriptOf(char))) ? Math.ceil(chars.length / 2) : 1);
    }, 0);
}

/** A word bounded `vs`, `vs.` or `versus`. */
export const isComparison = (text: string): boolean => COMPARISON.test(text);

/**
 * The type the server gives a prompt when the caller names none (the owner's rule, docs/19 3.7.1): case folded,
 * first match wins. Comparison, then how to, then a leading interrogative or a closing question mark, else other.
 */
export function suggestPromptType(text: string): PromptType {
  const folded = text.toLowerCase();
  if (isComparison(folded)) return 'comparison';
  if (HOW_TO.test(folded)) return 'how_to';
  const leading = LEADING_WORD.exec(folded)?.[1];
  const last = folded.trimEnd().slice(-1);
  if ((leading !== undefined && INTERROGATIVES.has(leading)) || QUESTION_MARKS.includes(last)) return 'question';
  return 'other';
}

const lookup = (index: readonly number[], at: number): number => index.filter((start) => start <= at).length - 1;

function competitors(text: string, named: readonly Named[]): Finding[] {
  const comparison = isComparison(text);
  return named.flatMap((item): Finding[] => {
    const [first] = item.spans;
    if (!item.isCompetitor || first === undefined) return [];
    return [
      {
        rule: 'contains_competitor_alias',
        severity: comparison ? 'info' : 'warning',
        message: comparison
          ? `Compares with ${item.name}.`
          : `Names ${item.name}. A competitor named in the prompt is likely to be named in the answer.`,
        span: { start: first[0], end: first[1] },
      },
    ];
  });
}

/** The first superlative within `LEADING_DISTANCE` words of a name, or the pattern "why is <words> the best". */
function leading(text: string, named: readonly Named[]): Finding | null {
  const starts = [...text.matchAll(/\S+/g)].map((token) => token.index);
  const word = (at: number): number => lookup(starts, at);
  const nearAName = (start: number, end: number): boolean =>
    named.some((item) =>
      item.spans.some(([nameStart, nameEnd]) => {
        // The superlative is part of the name
        if (nameStart < end && start < nameEnd) return false;
        const gap = end <= nameStart ? word(nameStart) - word(end - 1) : word(start) - word(nameEnd - 1);
        return gap <= LEADING_DISTANCE;
      }),
    );
  const spans: [number, number][] = [...text.matchAll(SUPERLATIVE)]
    .filter((found) => nearAName(found.index, found.index + found[0].length))
    .map((found): [number, number] => [found.index, found.index + found[0].length]);
  const pattern = WHY_IS_BEST.exec(text)?.indices?.[1];
  if (pattern !== undefined) spans.push([pattern[0], pattern[1]]);
  const first = spans.sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
  if (first === undefined) return null;
  return {
    rule: 'leading_wording',
    severity: 'warning',
    message: 'The wording leads the answer. It measures agreement, not visibility.',
    span: { start: first[0], end: first[1] },
  };
}

function questions(text: string): Finding | null {
  if ((text.match(QUESTION_RUN) ?? []).length <= 1) return null;
  return {
    rule: 'multiple_questions',
    severity: 'warning',
    message: 'Asks more than one question. Answers to it will mix them.',
    span: null,
  };
}

function length(text: string): Finding | null {
  const words = countWords(text);
  if (words >= WORDS_MIN && words <= WORDS_MAX) return null;
  return {
    rule: 'word_count',
    severity: 'warning',
    message: `Has ${String(words)} ${words === 1 ? 'word' : 'words'}. Prompts of ${String(WORDS_MIN)} to ${String(WORDS_MAX)} words read like real questions.`,
    span: null,
  };
}

/** The most common script outside `scripts`, when those letters are at least `FOREIGN_LETTERS_PERCENT` of all. */
function foreignScript(text: string, scripts: ReadonlySet<string>): string | null {
  const letters = new Map<string, number>();
  for (const char of text) {
    if (isLetter(char)) letters.set(scriptOf(char), (letters.get(scriptOf(char)) ?? 0) + 1);
  }
  const foreign = [...letters].filter(([name]) => !scripts.has(name));
  const total = [...letters.values()].reduce((sum, count) => sum + count, 0);
  const foreignTotal = foreign.reduce((sum, [, count]) => sum + count, 0);
  if (foreign.length === 0 || foreignTotal * 100 < FOREIGN_LETTERS_PERCENT * total) return null;
  return foreign.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
}

/** The language, of the seven with function words, whose words the text uses clearly more than the set language's. */
function foreignLanguage(text: string, languageCode: string): string | null {
  if (!FUNCTION_WORDS.has(languageCode)) return null;
  const seen = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const hits = new Map(
    [...FUNCTION_WORDS].map(([code, words]) => [code, seen.filter((word) => words.has(word)).length] as const),
  );
  const own = hits.get(languageCode) ?? 0;
  const others = [...hits].filter(([code]) => code !== languageCode);
  const best = others.reduce((top, entry) => (entry[1] > top[1] ? entry : top));
  return best[1] >= own + FUNCTION_WORD_MARGIN ? best[0] : null;
}

function language(text: string, languageCode: string | null): Finding | null {
  if (languageCode === null || countWords(text) < MISMATCH_MIN_WORDS) return null;
  const scripts = SCRIPTS.get(languageCode);
  const script = scripts === undefined ? null : foreignScript(text, scripts);
  const other = script === null ? foreignLanguage(text, languageCode) : null;
  const readsAs = script !== null ? title(script) : other === null ? null : (LANGUAGES.get(other) ?? other);
  if (readsAs === null) return null;
  return {
    rule: 'language_mismatch',
    severity: 'warning',
    message: `Reads as ${readsAs}, and the prompt is set to ${LANGUAGES.get(languageCode) ?? languageCode}.`,
    span: null,
  };
}

/** The findings of the five rules, in the contract's order. Left without a language, `language_mismatch` is not checked. */
export function checkText(text: string, named: readonly Named[], languageCode: string | null): Finding[] {
  return [
    ...competitors(text, named),
    ...[leading(text, named), questions(text), length(text), language(text, languageCode)].flatMap((found) =>
      found === null ? [] : [found],
    ),
  ];
}

/** The own and competitor names a text holds, found through the project's entities and their aliases. */
export function namedOf(world: EntityWorld, projectId: string, text: string): Named[] {
  const roles = world.roles.filter(
    (role) =>
      role.project_id === projectId && isActiveRole(role) && (role.role === 'own' || role.role === 'competitor'),
  );
  const entities = roles.flatMap((role): MatcherEntity[] => {
    const entity = world.entities.find((candidate) => candidate.entity_id === role.entity_id);
    return entity === undefined
      ? []
      : [
          {
            entity,
            aliases: world.aliases.filter((alias) => alias.entity_id === entity.entity_id),
            domains: world.domains.filter((domain) => domain.entity_id === entity.entity_id),
          },
        ];
  });
  return matchAliases(text, entities).mentions.flatMap((mention): Named[] => {
    const role = roles.find((candidate) => candidate.entity_id === mention.entity_id);
    const entity = entities.find((candidate) => candidate.entity.entity_id === mention.entity_id)?.entity;
    const spans = mention.spans
      .filter((span) => span.status === 'accepted')
      .map((span): readonly [number, number] => [span.start, span.end])
      .sort((a, b) => a[0] - b[0]);
    if (mention.status !== 'accepted' || role === undefined || entity === undefined || spans.length === 0) return [];
    return [{ name: entity.canonical_name, isCompetitor: role.role === 'competitor', spans }];
  });
}

/** Case and spacing set aside: what makes two texts near duplicates. */
export const foldText = (text: string): string =>
  text
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part !== '')
    .join(' ');

/** A prompt of the project, archived ones included, as the matching reads it. */
export interface TrackedRow {
  id: string;
  text: string;
  language_code: string;
  country_iso: string;
  is_active: boolean;
}

export interface ItemMatches {
  tracked: ({ prompt_id: string; is_active: boolean } | null)[];
  near_duplicate_of: ({ prompt_id: string; text: string } | null)[];
  /** Whether saving the item would create a prompt: not tracked, not a repeat of an earlier item, not too long to save. */
  creates: boolean[];
}

const identity = (text: string, languageCode: string, countryIso: string): string =>
  `${text.normalize('NFC')}\u0000${languageCode}\u0000${countryIso}`;

/** For each item the prompt it is (`tracked`) or, when none is, the one it nearly is; the oldest row wins. */
export function matchItems(
  items: readonly { text: string; language_code: string; country_iso: string }[],
  rows: readonly TrackedRow[],
): ItemMatches {
  const byKey = new Map<string, TrackedRow>();
  const byFold = new Map<string, TrackedRow>();
  for (const row of rows) {
    const key = identity(row.text, row.language_code, row.country_iso);
    if (!byKey.has(key)) byKey.set(key, row);
    const folded = `${row.language_code}\u0000${row.country_iso}\u0000${foldText(row.text)}`;
    if (!byFold.has(folded)) byFold.set(folded, row);
  }
  const seen = new Set<string>();
  const matches: ItemMatches = { tracked: [], near_duplicate_of: [], creates: [] };
  for (const item of items) {
    const key = identity(item.text, item.language_code, item.country_iso);
    const found = byKey.get(key);
    const similar =
      found === undefined
        ? byFold.get(`${item.language_code}\u0000${item.country_iso}\u0000${foldText(item.text)}`)
        : undefined;
    matches.tracked.push(found === undefined ? null : { prompt_id: found.id, is_active: found.is_active });
    matches.near_duplicate_of.push(similar === undefined ? null : { prompt_id: similar.id, text: similar.text });
    matches.creates.push(found === undefined && !seen.has(key) && textLength(item.text) <= PROMPT_TEXT_MAX);
    seen.add(key);
  }
  return matches;
}

const centsText = (cents: number): string =>
  `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, '0')}`;

/**
 * What the texts to be created cost on each engine of `codes` on the standard queue: the texts the engine takes,
 * asked twice a week. Answers a month are rounded down, money to the cent, the run now values are not rounded; an
 * engine with no price has no cost.
 */
export function estimateCost(creating: readonly string[], codes: readonly EngineCode[]): Schemas['LintEstimate'] {
  const engines = codes.map((code): Schemas['EngineEstimate'] => {
    const fit = creating.filter((text) => textLength(text) <= ENGINE_FACTS[code].max_prompt_chars).length;
    const runNow = fit * ANSWERS_PER_ENGINE;
    const priced = !UNPRICED.has(code);
    return {
      engine_code: code,
      prompts_fit: fit,
      answers_per_month: Math.floor((runNow * RUNS_PER_WEEK * 52) / 12),
      monthly_cost_usd: priced
        ? centsText(Math.round((runNow * RUNS_PER_WEEK * AI_ANSWER_MICROS * 52) / 12 / MICROS_PER_CENT))
        : null,
      run_now_answers: runNow,
      run_now_cost_usd: priced ? usdOfMicros(runNow * AI_ANSWER_MICROS) : null,
    };
  });
  const cents = engines.flatMap((engine) =>
    engine.monthly_cost_usd === null ? [] : [Math.round(Number(engine.monthly_cost_usd) * 100)],
  );
  return {
    engines,
    total_monthly_cost_usd: cents.length === 0 ? null : centsText(cents.reduce((sum, value) => sum + value, 0)),
  };
}
