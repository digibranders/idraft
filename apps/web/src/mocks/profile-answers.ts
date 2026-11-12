import type { AiPromptDefinition, DefinitionPrompt, DefinitionSource } from './ai-prompt-definition';
import type { DefinitionWorld } from './ai-prompt-world';
import {
  buildAnswer,
  CITATION_KINDS,
  invalidAnswer,
  PROVIDER_CHECK,
  webAddress,
  type Answer,
  type Planned,
  type SourceSpec,
} from './answer-builder';
import type { EngineCode } from '@/lib/api/types';

/**
 * The answers of a project that has a definition file (./ai-prompt-definition.ts), made from each prompt's
 * visibility profile: how likely each engine is to name the brand, which competitors it names with it, which
 * pages it cites. Nothing is random: every choice is a hash of the prompt, the engine and the day, so the same
 * request always gives the same answer and a later run of the page shows the history it showed before.
 */

const DAY_MS = 86_400_000;
const MAGNIFIER = String.fromCodePoint(0x1f50e);
const PIN = String.fromCodePoint(0x1f4cc);

/** An engine and its place among the engine codes, which the answers' seeds and ids carry. */
export interface EngineSlot {
  code: EngineCode;
  place: number;
}

/**
 * Where the status of an answer falls on the unit interval: a provider error and an unreadable answer (both
 * `error`), a refusal and an empty answer are not valid, three in a hundred together; the next two in a hundred
 * are cut off and still count.
 */
const STATUS_EDGES = { providerError: 0.014, unreadable: 0.024, refused: 0.027, empty: 0.03, partial: 0.05 } as const;
/** Of the answers that name an ambiguous competitor, how many the matcher is unsure of. */
const UNCERTAIN_SHARE = 0.4;
/** Of the answers that name the brand, how many name it a second time. */
const REPEAT_SHARE = 0.15;
/** Of the answers that name a competitor, how many also cite one of its pages. */
const COMPETITOR_PAGE_SHARE = 0.3;
const MISSING_CHECK_SHARE = 0.03;
const MAX_SOURCES = 6;

/** A number in [0, 1) that depends on its parts and on nothing else (a hash, mixed and scaled). */
export function unit(...parts: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    hash = Math.imul(hash ^ (part >>> 0), 0x01000193);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x2c1b3c6d);
    hash ^= hash >>> 12;
    hash = Math.imul(hash, 0x297a2d39);
    hash ^= hash >>> 15;
  }
  return (hash >>> 0) / 4_294_967_296;
}

/** What each draw of an answer is for, so no two draws share a seed. */
const DRAW = {
  status: 1,
  check: 2,
  mention: 3,
  place: 4,
  ownSentence: 5,
  ownAlias: 6,
  repeat: 7,
  ownCite: 8,
  ownPage: 9,
  competitor: 100,
  competitorRank: 200,
  competitorUncertain: 300,
  competitorSentence: 400,
  competitorAlias: 500,
  competitorPage: 600,
  competitorCite: 700,
  source: 800,
  sourcePage: 900,
} as const;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const pick = <T>(items: readonly T[], at: number): T => {
  const found = items[Math.floor(at * items.length)];
  if (found === undefined) throw new Error('Nothing to pick from');
  return found;
};

/** The model an engine reports on a day: the file's, or the new one from the change on. */
function modelOn(definition: AiPromptDefinition, engine: EngineCode, day: number): string | null {
  const change = definition.model_change;
  if (change.engine_code === engine && day >= Date.parse(change.effective_date) / DAY_MS) return change.model;
  return definition.engines.find((candidate) => candidate.engine_code === engine)?.model ?? null;
}

/** The first parent topic of a prompt, which picks the own page that fits it. */
function parentTopic(definition: AiPromptDefinition, prompt: DefinitionPrompt): string | null {
  const first = prompt.topics[0];
  const parent = definition.topics.find(
    (topic) => topic.slug === first || topic.children.some((child) => child.slug === first),
  );
  return parent?.slug ?? null;
}

const withName = (template: string, name: string): { sentence: string; at: number } => {
  const [before = '', after = ''] = template.split('{name}');
  return { sentence: `${before}${name}${after}`, at: before.length };
};

/** One page of a source, chosen by `at`, as the site a citation names. */
function siteOf(
  world: DefinitionWorld,
  source: DefinitionSource | { competitor: string },
  at: number,
  topic: string | null,
  branded: boolean,
): SourceSpec['site'] {
  const { definition } = world;
  if ('competitor' in source) {
    const entity = definition.competitors.find((candidate) => candidate.key === source.competitor);
    if (entity === undefined) throw new Error(`No competitor has the key ${source.competitor}`);
    const page = pick(definition.competitor_pages, at);
    const host = entity.domains[0] ?? '';
    return {
      url: `https://${host}${page.path}`,
      host,
      title: page.title.replace('{name}', entity.name),
      source_name: entity.name,
      role: 'competitor',
      entity_id: world.entityIdOf(entity.key),
    };
  }
  // The own domain offers the page that fits the topic (and its about page to a prompt that names the brand)
  const fitting =
    source.role === 'own'
      ? source.pages.filter((candidate) => candidate.topic === topic || (branded && candidate.topic === null))
      : source.pages;
  const page = pick(fitting.length > 0 ? fitting : source.pages, at);
  return {
    url: `https://${source.host}${page.path}`,
    host: source.host,
    title: page.title,
    source_name: source.name,
    role: source.role === 'own' ? 'own' : 'third_party',
    entity_id: source.role === 'own' ? world.brandId : null,
  };
}

/**
 * The answer of prompt `index` of the definition on `engine` on day `day` (days since 1970, UTC). Pure.
 * Each span is in UTF-16 code units of `answer_text`, as the API's detail gives them.
 */
export function profileAnswer(world: DefinitionWorld, index: number, engine: EngineSlot, day: number): Answer {
  const { definition } = world;
  const prompt = definition.prompts[index];
  const profile = prompt?.profile[engine.code];
  if (prompt === undefined || profile === undefined) {
    throw new Error(`The definition has no profile for prompt ${String(index)} on ${engine.code}`);
  }
  const draw = (kind: number, extra = 0): number => unit(kind + extra, index, engine.place, day);

  const base = {
    model_reported: modelOn(definition, engine.code, day),
    check_url: draw(DRAW.check) < MISSING_CHECK_SHARE ? null : webAddress(PROVIDER_CHECK[engine.code]),
  };
  const roll = draw(DRAW.status);
  if (roll < STATUS_EDGES.providerError) return invalidAnswer('error', base, '50000');
  if (roll < STATUS_EDGES.unreadable) return invalidAnswer('error', base, 'schema_mismatch');
  if (roll < STATUS_EDGES.refused) return invalidAnswer('refused', base);
  if (roll < STATUS_EDGES.empty) return invalidAnswer('empty', base);
  const partial = roll < STATUS_EDGES.partial;

  const brand = { entity_id: world.brandId, name: definition.brand.name, role: 'own' } as const;
  const change = definition.model_change;
  const shifted = change.engine_code === engine.code && day >= Date.parse(change.effective_date) / DAY_MS;
  const ownNamed = draw(DRAW.mention) < clamp(profile.mention + (shifted ? change.mention_delta : 0));

  // The competitors it names, the stronger ones first with some shuffling from day to day
  const named = profile.competitors
    .map(([key, chance], place) => ({
      key,
      place,
      rank: chance + (draw(DRAW.competitorRank, place) - 0.5) * 0.6,
      chance,
    }))
    .filter(({ place, chance }) => draw(DRAW.competitor, place) < chance)
    .sort((a, b) => b.rank - a.rank);
  const competitors = named.map(({ key, place }): Planned => {
    const entity = definition.competitors.find((candidate) => candidate.key === key);
    if (entity === undefined) throw new Error(`No competitor has the key ${key}`);
    const written = pick(entity.aliases, draw(DRAW.competitorAlias, place));
    const text = withName(pick(definition.phrases.competitor, draw(DRAW.competitorSentence, place)), written);
    return {
      who: { entity_id: world.entityIdOf(key), name: entity.name, role: 'competitor' },
      written,
      ...text,
      viaProduct: false,
      uncertain: entity.ambiguous === true && draw(DRAW.competitorUncertain, place) < UNCERTAIN_SHARE,
    };
  });

  // The brand takes its typical place among them, a place either way now and then
  const planned: Planned[] = [...competitors];
  let own: Planned | null = null;
  if (ownNamed) {
    const written = pick(definition.brand.aliases, draw(DRAW.ownAlias));
    own = {
      who: brand,
      written,
      ...withName(pick(definition.phrases.own, draw(DRAW.ownSentence)), written),
      viaProduct: false,
      uncertain: false,
    };
    const jitter = Math.floor(draw(DRAW.place) * 3) - 1;
    planned.splice(Math.min(Math.max(profile.order - 1 + jitter, 0), planned.length), 0, own);
  }

  // The pages it cites: the brand's own, the ones the profile names, and now and then a competitor's
  const topic = parentTopic(definition, prompt);
  const kind = CITATION_KINDS[engine.code];
  const tag = engine.code === 'chatgpt_web' ? 'chatgpt.com' : null;
  const sites: SourceSpec['site'][] = [];
  const ownSource = definition.sources.find((candidate) => candidate.role === 'own');
  if (ownSource !== undefined && draw(DRAW.ownCite) < profile.cite) {
    sites.push(siteOf(world, ownSource, draw(DRAW.ownPage), topic, prompt.branded));
  }
  profile.sources.forEach(([key, chance], place) => {
    if (draw(DRAW.source, place) >= chance) return;
    const found = definition.sources.find((candidate) => candidate.key === key);
    const at = draw(DRAW.sourcePage, place);
    sites.push(siteOf(world, found ?? { competitor: key }, at, topic, false));
  });
  for (const { key, place } of named) {
    if (draw(DRAW.competitorCite, place) < COMPETITOR_PAGE_SHARE) {
      sites.push(siteOf(world, { competitor: key }, draw(DRAW.competitorPage, place), topic, false));
    }
  }
  // An answer always cites something: the first source the profile lists, else the first third party of the file
  if (sites.length === 0) {
    const fallback = profile.sources[0]?.[0];
    const source =
      definition.sources.find((candidate) => candidate.key === fallback) ??
      definition.sources.find((candidate) => candidate.role === 'third_party');
    if (source !== undefined) sites.push(siteOf(world, source, draw(DRAW.sourcePage, 99), topic, false));
  }
  const seen = new Set<string>();
  const unique = sites
    .filter((site) => (seen.has(site.url) ? false : Boolean(seen.add(site.url))))
    .slice(0, MAX_SOURCES);
  // The first page that is not the brand's is quoted in the text for some prompts, ChatGPT and Gemini only
  const quoted =
    engine.code !== 'google_ai_mode' && index % 3 === 1 ? unique.find((site) => site.role !== 'own') : undefined;
  const sources: SourceSpec[] = unique.map((site) => ({
    site,
    raw: tag === null ? site.url : `${site.url}?utm_source=${tag}`,
    kind: site === quoted ? 'inline' : kind,
    tag,
    flags: [],
  }));

  const intro = definition.phrases.intro[prompt.prompt_type] ?? '';
  const outro = definition.phrases.outro[prompt.funnel_stage] ?? '';
  const repeat =
    own !== null && draw(DRAW.repeat) < REPEAT_SHARE ? withName(definition.phrases.repeat_own, own.written) : null;
  return buildAnswer({
    base,
    // An emoji before the names moves every span on by two UTF-16 units, so a viewer must not count characters
    lead: index % 13 === 5 ? `${MAGNIFIER} ${intro}` : intro,
    bullet: index % 11 === 3 ? `${PIN} ` : '',
    planned,
    repeat: own !== null && repeat !== null ? { planned: own, ...repeat } : null,
    sources,
    inline: (address) => ` ${definition.phrases.inline.replace('{url}', address)}`,
    closing: partial ? ` ${definition.phrases.cut_off}` : ` ${outro}`,
    partial,
    product: null,
  });
}
