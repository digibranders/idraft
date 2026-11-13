import { TZDate } from '@date-fns/tz';

import { isAiSeeded } from '../ai-seed';
import {
  answerOf,
  DAY_MS,
  ENGINE_CODES,
  fixtureEngines,
  fixturePrompts,
  observationIdOf,
  runInstants,
  type StoredPrompt,
} from '../prompt-fixtures';
import { mondayOf, summaryWeeks } from '../prompt-summary';
import { promptsOf } from '../prompts-state';
import { daysBetween, shiftIsoDate } from '../serp-views';
import { onMockReset } from '../state';
import type { CitationOut, EngineCode, Schemas } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * The arithmetic of the citation reads (docs/16 section 7, contracts/sources-additions.md), as the API does it
 * (backend `api/ai/sources.py` and `source_repository.py`): which answers count, the citation units of each, the
 * sources they make up, their shares, windows before, weekly points, changes and diversity. Pure functions over
 * the answers of the mock world: no MSW, no Response. The routes (./citations.ts) validate and page.
 */

export type DomainRole = CitationOut['domain_role'];
export type SourceSort = '-citation_units' | '-observations' | '-prompts';
type MetricCell = Schemas['MetricCell'];
type MetricWindow = Schemas['MetricWindow'];
type PreviousUnits = Schemas['PreviousUnits'];

/** The roles of a citation, in the order `meta.by_role` lists them. */
export const ROLES: readonly DomainRole[] = ['own', 'competitor', 'third_party'];

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isoOf = (instant: number): string => new Date(instant).toISOString();

// Hosts and addresses

/** The suffixes with two labels, which a registrable domain keeps three labels of. */
const TWO_LABEL_SUFFIXES: ReadonlySet<string> = new Set(['co.uk', 'com.au', 'co.in', 'com.br']);

/** What sources are grouped by: the host in lower case, `www.` left out, the last two labels (three under `co.uk` and its kind). */
export function registrableOf(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  return labels.slice(TWO_LABEL_SUFFIXES.has(labels.slice(-2).join('.')) ? -3 : -2).join('.');
}

/** The address without its fragment, its `utm_` parameters and a trailing slash; anything that is not a web address as it came. */
export function canonicalOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
  const query = new URLSearchParams(
    [...parsed.searchParams].filter(([name]) => !name.toLowerCase().startsWith('utm_')),
  ).toString();
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}${query === '' ? '' : `?${query}`}`;
}

/** A positive number that stands for a canonical address and always will (FNV-1a over its characters). */
export function urlIdOf(canonical: string): number {
  let hash = 0x811c9dc5;
  for (let place = 0; place < canonical.length; place += 1) {
    hash = Math.imul(hash ^ canonical.charCodeAt(place), 0x01000193);
  }
  return (hash >>> 0) + 1;
}

// The answers

/** An answer with the sources it cited and the entities it names. */
export interface CitedAnswer {
  id: string;
  at: number;
  promptId: string;
  engine: EngineCode;
  valid: boolean;
  citations: readonly CitationOut[];
  /** The tracked entities it names, each once (accepted mentions). */
  named: readonly string[];
}

/** The newest answer first, ties by the larger number: the order of the observations list. */
const newestFirst = (a: CitedAnswer, b: CitedAnswer): number => b.at - a.at || Number(BigInt(b.id) - BigInt(a.id));

const memo = new Map<string, readonly CitedAnswer[]>();
onMockReset(() => memo.clear());

/**
 * Every answer a project's fixture prompts got and every one Run now delivered, newest first, with the sources
 * of each: the same answers, with the same numbers, as `/ai/observations` lists.
 * shortcut: a copy of answersOf in prompt-answers.ts (leased to WP-20); export that one and delete this once WP-20 has merged.
 */
export function answersWithCitations(projectId: string, now: number): readonly CitedAnswer[] {
  const delivered = promptsOf(projectId).observations;
  // The runs that have answered and the answers Run now added are all that can change what this makes
  const key = [projectId, runInstants(now)[0], delivered.length, isAiSeeded()].join(' ');
  const found = memo.get(key);
  if (found !== undefined) return found;
  const named = (mentions: readonly { entity_id: string; mention_status: string }[]): string[] => [
    ...new Set(mentions.filter((mention) => mention.mention_status === 'accepted').map((mention) => mention.entity_id)),
  ];
  const engines = fixtureEngines(projectId);
  const made: CitedAnswer[] = [
    ...runInstants(now).flatMap((at) =>
      fixturePrompts(projectId).flatMap((prompt) => {
        const { index } = prompt;
        if (index === null) return [];
        const day = Math.floor(at / DAY_MS);
        return engines.map((engine): CitedAnswer => {
          const answer = answerOf(index, prompt.language_code, engine.engine_code, day, prompt.project_id);
          return {
            id: observationIdOf(day, index, ENGINE_CODES.indexOf(engine.engine_code)),
            at,
            promptId: prompt.prompt_id,
            engine: engine.engine_code,
            valid: answer.facts.is_valid,
            citations: answer.citations,
            named: named(answer.mentions),
          };
        });
      }),
    ),
    ...delivered.flatMap((detail): CitedAnswer[] => {
      const engine = ENGINE_CODES.find((code) => code === detail.engine_code);
      return engine === undefined
        ? []
        : [
            {
              id: detail.observation_id,
              at: Date.parse(detail.observed_at),
              promptId: detail.subject.prompt_id,
              engine,
              valid: detail.facts?.is_valid === true,
              citations: detail.citations,
              named: named(detail.mentions),
            },
          ];
    }),
  ].sort(newestFirst);
  memo.set(key, made);
  return made;
}

// Windows and scope

export interface SourceWindow {
  first: string;
  last: string;
  timezone: string;
  /** The start of `first` and the start of the day after `last`, as instants. */
  since: number;
  until: number;
}

/** The start of a project day as an instant. */
const dayStart = (date: string, timezone: string): number => {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new TZDate(year, month - 1, day, timezone).getTime();
};

export const windowOf = (first: string, last: string, timezone: string): SourceWindow => ({
  first,
  last,
  timezone,
  since: dayStart(first, timezone),
  until: dayStart(shiftIsoDate(last, 1), timezone),
});

/** As many days as `window`, ending the day before it. */
export function windowBefore(window: SourceWindow): SourceWindow {
  const days = daysBetween(window.first, window.last);
  return windowOf(shiftIsoDate(window.first, -days), shiftIsoDate(window.first, -1), window.timezone);
}

const metricWindow = (window: SourceWindow): MetricWindow => ({
  from: window.first,
  to: window.last,
  timezone: window.timezone,
});

/** Which citation flags a read counts: both off unless asked for (docs/14 section 9). */
export interface Flags {
  unresolvedRedirects: boolean;
  engineInternal: boolean;
}

export const NO_FLAGS: Flags = { unresolvedRedirects: false, engineInternal: false };

export interface SourceScope {
  window: SourceWindow;
  /** At most 3 engine codes, in code order. */
  engines: readonly EngineCode[];
  promptIds: ReadonlySet<string>;
  /** Narrows the rows of a list and nothing else; empty is every role. */
  roles: readonly DomainRole[];
  includeBranded: boolean;
  flags: Flags;
}

type PromptScope = Pick<StoredPrompt, 'prompt_id' | 'is_active' | 'is_branded' | 'country_iso' | 'term_ids'>;

export interface ScopeInput {
  now: number;
  timezone: string;
  /** Project days; `to` defaults to today and `from` to the 28 days ending on `to`. */
  from: string | null;
  to: string | null;
  engines: readonly EngineCode[];
  prompts: readonly PromptScope[];
  promptId: string | null;
  /** The term asked for and every term below it; `null` for no term filter. */
  termIds: ReadonlySet<string> | null;
  country: string | null;
  roles: readonly DomainRole[];
  includeBranded: boolean;
  includeUnresolvedRedirects: boolean;
  includeEngineInternal: boolean;
}

/** The term and every term below it; none for a term the vocabularies do not have. */
export function termSubtree(
  terms: readonly { term_id: string; parent_id?: string | null }[],
  termId: string,
): ReadonlySet<string> {
  const found = new Set<string>();
  if (!terms.some((term) => term.term_id === termId)) return found;
  found.add(termId);
  for (let grown = true; grown;) {
    const before = found.size;
    for (const term of terms) if (term.parent_id != null && found.has(term.parent_id)) found.add(term.term_id);
    grown = found.size > before;
  }
  return found;
}

/**
 * The answers a read counts: the active prompts, the branded ones only with `include_branded`; with a prompt
 * given that prompt alone, whatever its state. A term keeps the prompts given it or one below it, a country
 * those of that market. The engines asked for, else all three, in code order.
 */
export function scopeOf(input: ScopeInput): SourceScope {
  const last = input.to ?? formatIsoDate(new Date(input.now).toISOString(), input.timezone);
  const first = input.from ?? shiftIsoDate(last, -27);
  const termIds = input.termIds;
  const prompts = input.prompts.filter(
    (prompt) =>
      (input.promptId === null
        ? prompt.is_active && (input.includeBranded || !prompt.is_branded)
        : prompt.prompt_id === input.promptId) &&
      (termIds === null || prompt.term_ids.some((id) => termIds.has(id))) &&
      (input.country === null || prompt.country_iso === input.country),
  );
  const asked = new Set(input.engines);
  return {
    window: windowOf(first, last, input.timezone),
    engines: ENGINE_CODES.filter((code) => asked.size === 0 || asked.has(code)),
    promptIds: new Set(prompts.map((prompt) => prompt.prompt_id)),
    roles: input.roles,
    includeBranded: input.includeBranded,
    flags: { unresolvedRedirects: input.includeUnresolvedRedirects, engineInternal: input.includeEngineInternal },
  };
}

/** The valid answers of the scope's prompts and engines inside its window. */
export const countedAnswers = (answers: readonly CitedAnswer[], scope: SourceScope): CitedAnswer[] =>
  answers.filter(
    (answer) =>
      answer.valid &&
      answer.at >= scope.window.since &&
      answer.at < scope.window.until &&
      scope.engines.includes(answer.engine) &&
      scope.promptIds.has(answer.promptId),
  );

/** The citation units of an answer: one citation per distinct canonical address, those a toggle left out dropped (docs/16 C2). */
export function unitsOf(answer: CitedAnswer, flags: Flags): CitationOut[] {
  const seen = new Set<string>();
  const units: CitationOut[] = [];
  for (const citation of answer.citations) {
    // A citation with several flags counts only when every flag it carries is asked for
    const counted = citation.flags.every((flag) =>
      flag === 'unresolved_redirect'
        ? flags.unresolvedRedirects
        : flag === 'engine_internal'
          ? flags.engineInternal
          : true,
    );
    const address = canonicalOf(citation.url);
    if (!counted || seen.has(address)) continue;
    seen.add(address);
    units.push(citation);
  }
  return units;
}

const weekOf = (at: number, timezone: string): string => mondayOf(formatIsoDate(isoOf(at), timezone));

// Totals and meta

interface Totals {
  answers: number;
  citing: number;
  units: number;
  byRole: Record<DomainRole, { units: number; answers: number }>;
}

function totalsOf(counted: readonly CitedAnswer[], scope: SourceScope): Totals {
  const totals: Totals = {
    answers: counted.length,
    citing: 0,
    units: 0,
    byRole: {
      own: { units: 0, answers: 0 },
      competitor: { units: 0, answers: 0 },
      third_party: { units: 0, answers: 0 },
    },
  };
  for (const answer of counted) {
    const units = unitsOf(answer, scope.flags);
    totals.units += units.length;
    if (units.length > 0) totals.citing += 1;
    for (const role of ROLES) {
      const count = units.filter((unit) => unit.domain_role === role).length;
      totals.byRole[role].units += count;
      if (count > 0) totals.byRole[role].answers += 1;
    }
  }
  return totals;
}

export interface MetaOptions {
  series?: boolean;
  byRoleByEngine?: boolean;
  compare?: boolean;
}

/** `meta` of the domain and page reads; the optional blocks only when asked for. The role filter narrows none of it. */
export function metaOf(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  { series = false, byRoleByEngine = false, compare = false }: MetaOptions = {},
): Schemas['SourcesMeta'] {
  const counted = countedAnswers(answers, scope);
  const totals = totalsOf(counted, scope);
  const before = windowBefore(scope.window);
  return {
    window: metricWindow(scope.window),
    include_branded: scope.includeBranded,
    engine_codes: [...scope.engines],
    answers: totals.answers,
    answers_citing: totals.citing,
    citation_units: totals.units,
    by_role: ROLES.map((role) => ({
      domain_role: role,
      citation_units: totals.byRole[role].units,
      observations: totals.byRole[role].answers,
    })),
    ...(byRoleByEngine
      ? {
          by_role_by_engine: scope.engines.map((engine): Schemas['EngineRoleUnits'] => {
            const split = totalsOf(
              counted.filter((answer) => answer.engine === engine),
              scope,
            ).byRole;
            const roleOf = (role: DomainRole): Schemas['RoleAnswers'] => ({
              citation_units: split[role].units,
              answers_citing: split[role].answers,
            });
            return {
              engine_code: engine,
              own: roleOf('own'),
              competitor: roleOf('competitor'),
              third_party: roleOf('third_party'),
            };
          }),
        }
      : {}),
    ...(series ? { series: weeksOf(counted, scope) } : {}),
    ...(compare
      ? {
          compare_window: metricWindow(before),
          previous_answers: countedAnswers(answers, { ...scope, window: before }).length,
        }
      : {}),
  };
}

/** A point per week of the window: the answers, the units and the registrable domains cited, zero filled. */
function weeksOf(counted: readonly CitedAnswer[], scope: SourceScope): Schemas['SourcesWeek'][] {
  const found = new Map<string, { answers: number; units: number; domains: Set<string> }>(
    summaryWeeks(scope.window.first, scope.window.last).map((week) => [
      week,
      { answers: 0, units: 0, domains: new Set() },
    ]),
  );
  for (const answer of counted) {
    const week = found.get(weekOf(answer.at, scope.window.timezone));
    if (week === undefined) continue;
    const units = unitsOf(answer, scope.flags);
    week.answers += 1;
    week.units += units.length;
    for (const unit of units) week.domains.add(registrableOf(unit.host));
  }
  return [...found].map(([week_start, week]) => ({
    week_start,
    answers: week.answers,
    citation_units: week.units,
    distinct_domains: week.domains.size,
  }));
}

// Sources: domains and pages

type By = 'domain' | 'page';

/** One row of a list before it is shaped: a domain, or a page, with the role and entity it was cited as. */
interface Source {
  key: string;
  registrable: string;
  role: DomainRole;
  entityId: string | null;
  urlId: number;
  url: string;
  host: string;
  title: string | null;
  /** The answers that cite it, each with how many units it gave. */
  hits: { answer: CitedAnswer; units: number }[];
  prompts: Set<string>;
  engineUnits: number[];
}

const unitsIn = (source: Source): number => source.hits.reduce((sum, hit) => sum + hit.units, 0);

function groupSources(counted: readonly CitedAnswer[], scope: SourceScope, by: By): Map<string, Source> {
  const found = new Map<string, Source>();
  for (const answer of counted) {
    const engine = scope.engines.indexOf(answer.engine);
    for (const citation of unitsOf(answer, scope.flags)) {
      const registrable = registrableOf(citation.host);
      const urlId = urlIdOf(canonicalOf(citation.url));
      const key = [by === 'page' ? urlId : registrable, citation.domain_role, citation.role_entity_id ?? ''].join('|');
      let source = found.get(key);
      if (source === undefined) {
        source = {
          key,
          registrable,
          role: citation.domain_role,
          entityId: citation.role_entity_id,
          urlId,
          url: citation.url,
          host: citation.host,
          title: null,
          hits: [],
          prompts: new Set(),
          engineUnits: scope.engines.map(() => 0),
        };
        found.set(key, source);
      }
      const last = source.hits.at(-1);
      if (last?.answer === answer) last.units += 1;
      else source.hits.push({ answer, units: 1 });
      source.prompts.add(answer.promptId);
      source.title ??= citation.title;
      source.engineUnits[engine] = (source.engineUnits[engine] ?? 0) + 1;
    }
  }
  return found;
}

const SORT_VALUE: Record<SourceSort, (source: Source) => number> = {
  '-citation_units': unitsIn,
  '-observations': (source) => source.hits.length,
  '-prompts': (source) => source.prompts.size,
};

/** The sources a list shows: at least `min_support` units, of the roles asked for, the sort's order and then units, then the keys. */
function listed(
  found: ReadonlyMap<string, Source>,
  scope: SourceScope,
  sort: SourceSort,
  minSupport: number | null,
): Source[] {
  const value = SORT_VALUE[sort];
  return [...found.values()]
    .filter(
      (source) =>
        (minSupport === null || unitsIn(source) >= minSupport) &&
        (scope.roles.length === 0 || scope.roles.includes(source.role)),
    )
    .sort(
      (a, b) =>
        value(b) - value(a) ||
        unitsIn(b) - unitsIn(a) ||
        byText(a.registrable, b.registrable) ||
        a.urlId - b.urlId ||
        byText(a.role, b.role) ||
        byText(a.entityId ?? '', b.entityId ?? ''),
    );
}

/** The window before: the answers it counts and each source's units and citing answers there, by key. */
export function previousOf(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  by: By,
): { answers: number; units: ReadonlyMap<string, PreviousUnits> } {
  const prior = { ...scope, window: windowBefore(scope.window) };
  const counted = countedAnswers(answers, prior);
  return {
    answers: counted.length,
    units: new Map(
      [...groupSources(counted, prior, by)].map(([key, source]) => [
        key,
        { citation_units: unitsIn(source), observations: source.hits.length },
      ]),
    ),
  };
}

export interface RowOptions {
  sort?: SourceSort;
  minSupport?: number | null;
  /** A weekly point per row. */
  series?: boolean;
  /** Domains only: the entity named in most of the answers that cite it. */
  citedWith?: boolean;
  /** Each row's units in the window before. */
  compare?: boolean;
  /** Pages only: one domain's pages. */
  registrableDomain?: string | null;
}

/** What every row of a list carries, from the source and the totals of its scope. */
function commonOf(
  source: Source,
  scope: SourceScope,
  totals: Totals,
  { series, compare }: { series: Schemas['SourceWeekUnits'][] | null; compare: PreviousUnits | null },
): Pick<
  Schemas['SourceDomainRow'],
  | 'citation_units'
  | 'observations'
  | 'prompts'
  | 'engines'
  | 'source_share'
  | 'first_seen_at'
  | 'last_seen_at'
  | 'registrable_domain'
  | 'domain_role'
  | 'role_entity_id'
  | 'previous'
  | 'series'
> {
  const units = unitsIn(source);
  const times = source.hits.map((hit) => hit.answer.at);
  const share: MetricCell = {
    value: totals.units === 0 ? null : units / totals.units,
    numerator: units,
    denominator: totals.units,
    n_observations: totals.answers,
    pooled: null,
  };
  return {
    registrable_domain: source.registrable,
    domain_role: source.role,
    role_entity_id: source.entityId,
    citation_units: units,
    observations: source.hits.length,
    prompts: source.prompts.size,
    engines: scope.engines.map((engine, place) => ({
      engine_code: engine,
      citation_units: source.engineUnits[place] ?? 0,
    })),
    source_share: share,
    first_seen_at: isoOf(Math.min(...times)),
    last_seen_at: isoOf(Math.max(...times)),
    ...(compare === null ? {} : { previous: compare }),
    ...(series === null ? {} : { series }),
  };
}

/** A source's point for every week of the window: the units its answers gave and how many answers. */
function weeklyUnits(source: Source, weeks: readonly string[], timezone: string): Schemas['SourceWeekUnits'][] {
  const found = new Map(weeks.map((week) => [week, { units: 0, answers: 0 }]));
  for (const hit of source.hits) {
    const week = found.get(weekOf(hit.answer.at, timezone));
    if (week === undefined) continue;
    week.units += hit.units;
    week.answers += 1;
  }
  return [...found].map(([week_start, week]) => ({
    week_start,
    citation_units: week.units,
    observations: week.answers,
  }));
}

/** The entity named in the most answers that cite the source, ties by entity id; `null` when none names one. */
function citedWithOf(source: Source): Schemas['CitedWith'] | null {
  const seen = new Map<string, number>();
  for (const { answer } of source.hits) for (const id of answer.named) seen.set(id, (seen.get(id) ?? 0) + 1);
  const [top] = [...seen].sort(([a, x], [b, y]) => y - x || byText(a, b));
  return top === undefined ? null : { entity_id: top[0], observations: top[1] };
}

/** The domain rows of the scope (all of them: the route pages): units, share, units per engine, the optional blocks. */
export function aggregateDomains(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  { sort = '-citation_units', minSupport = null, series = false, citedWith = false, compare = false }: RowOptions = {},
): Schemas['SourceDomainRow'][] {
  const counted = countedAnswers(answers, scope);
  const totals = totalsOf(counted, scope);
  const before = compare ? previousOf(answers, scope, 'domain').units : null;
  const weeks = summaryWeeks(scope.window.first, scope.window.last);
  return listed(groupSources(counted, scope, 'domain'), scope, sort, minSupport).map((source) => {
    const named = citedWith ? citedWithOf(source) : null;
    return {
      ...commonOf(source, scope, totals, {
        series: series ? weeklyUnits(source, weeks, scope.window.timezone) : null,
        compare: before === null ? null : (before.get(source.key) ?? { citation_units: 0, observations: 0 }),
      }),
      ...(named === null ? {} : { cited_with: named }),
    };
  });
}

/** The page rows of the scope, as `aggregateDomains` does the domains; `registrableDomain` keeps one domain's pages. */
export function aggregatePages(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  {
    sort = '-citation_units',
    minSupport = null,
    series = false,
    compare = false,
    registrableDomain = null,
  }: RowOptions = {},
): Schemas['SourcePageRow'][] {
  const counted = countedAnswers(answers, scope);
  const totals = totalsOf(counted, scope);
  const before = compare ? previousOf(answers, scope, 'page').units : null;
  const weeks = summaryWeeks(scope.window.first, scope.window.last);
  return listed(groupSources(counted, scope, 'page'), scope, sort, minSupport)
    .filter((source) => registrableDomain === null || source.registrable === registrableDomain)
    .map((source) => ({
      ...commonOf(source, scope, totals, {
        series: series ? weeklyUnits(source, weeks, scope.window.timezone) : null,
        compare: before === null ? null : (before.get(source.key) ?? { citation_units: 0, observations: 0 }),
      }),
      url_id: source.urlId,
      url: source.url,
      host: source.host,
      title: source.title,
    }));
}

// Effective sources and diversity

/** The effective number of sources (docs/16 C3): the sum of units squared over the sum of each domain's units squared; `null` without a unit. */
export function effectiveSources(unitsPerDomain: readonly number[]): number | null {
  const sum = unitsPerDomain.reduce((total, units) => total + units, 0);
  return sum === 0 ? null : (sum * sum) / unitsPerDomain.reduce((total, units) => total + units * units, 0);
}

/** Units per registrable domain, roles merged. */
function unitsPerDomain(answers: readonly CitedAnswer[], flags: Flags): Map<string, number> {
  const found = new Map<string, number>();
  for (const answer of answers) {
    for (const unit of unitsOf(answer, flags)) {
      const domain = registrableOf(unit.host);
      found.set(domain, (found.get(domain) ?? 0) + 1);
    }
  }
  return found;
}

/** `GET sources/diversity`: per engine of the scope its answers, units, distinct domains and effective sources; never pooled. */
export function diversityOf(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  { series = false }: { series?: boolean } = {},
): Schemas['SourceDiversity'] {
  const counted = countedAnswers(answers, scope);
  const weeks = summaryWeeks(scope.window.first, scope.window.last);
  const data = scope.engines.map((engine): Schemas['SourceDiversityEngine'] => {
    const own = counted.filter((answer) => answer.engine === engine);
    const perDomain = [...unitsPerDomain(own, scope.flags).values()];
    const units = perDomain.reduce((sum, value) => sum + value, 0);
    const squares = perDomain.reduce((sum, value) => sum + value * value, 0);
    return {
      engine_code: engine,
      answers: own.length,
      answers_citing: own.filter((answer) => unitsOf(answer, scope.flags).length > 0).length,
      citation_units: units,
      distinct_domains: perDomain.length,
      effective_sources: {
        value: effectiveSources(perDomain),
        numerator: units * units,
        denominator: squares,
        n_observations: own.length,
        pooled: null,
      },
      ...(series
        ? {
            series: weeks.map((week): Schemas['DiversityWeek'] => {
              const perWeekDomain = [
                ...unitsPerDomain(
                  own.filter((answer) => weekOf(answer.at, scope.window.timezone) === week),
                  scope.flags,
                ).values(),
              ];
              return {
                week_start: week,
                citation_units: perWeekDomain.reduce((sum, value) => sum + value, 0),
                distinct_domains: perWeekDomain.length,
                effective_sources: effectiveSources(perWeekDomain),
              };
            }),
          }
        : {}),
    };
  });
  const values = data.flatMap((engine) =>
    engine.effective_sources.value === null ? [] : [engine.effective_sources.value],
  );
  return {
    data,
    meta: {
      window: metricWindow(scope.window),
      include_branded: scope.includeBranded,
      engine_codes: [...scope.engines],
      distinct_domains: unitsPerDomain(counted, scope.flags).size,
      effective_sources_engine_average:
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    },
  };
}

// New and lost sources

/**
 * New (docs/16 C5): at least `minSupport` units in the window and none in the window before. Lost (C6): at least
 * `minSupport` units in a support window and none in each of the 2 windows after it (the window before the asked one,
 * and the asked one). `window` is what the units of a row's `current_units` are counted over, `compareWindow` the other.
 */
export function changesOf(
  kind: 'new' | 'lost',
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  minSupport: number,
): { rows: Schemas['SourceChangeRow'][]; window: MetricWindow; compareWindow: MetricWindow } {
  const gap = windowBefore(scope.window);
  const [now, support] =
    kind === 'new'
      ? [scope.window, gap]
      : [windowOf(gap.first, scope.window.last, scope.window.timezone), windowBefore(gap)];
  const read = (window: SourceWindow): Map<string, Source> =>
    groupSources(countedAnswers(answers, { ...scope, window }), scope, 'domain');
  const current = read(now);
  const previous = read(support);
  const keys = new Set([...current.keys(), ...previous.keys()]);
  const rows = [...keys].flatMap((key) => {
    const source = current.get(key) ?? previous.get(key);
    if (source === undefined || (scope.roles.length > 0 && !scope.roles.includes(source.role))) return [];
    const nowUnits = current.has(key) ? unitsIn(current.get(key) ?? source) : 0;
    const beforeUnits = previous.has(key) ? unitsIn(previous.get(key) ?? source) : 0;
    if (kind === 'new' ? nowUnits < minSupport || beforeUnits > 0 : beforeUnits < minSupport || nowUnits > 0) return [];
    const times = (current.get(key)?.hits ?? []).map((hit) => hit.answer.at);
    return [
      {
        source,
        row: {
          registrable_domain: source.registrable,
          domain_role: source.role,
          role_entity_id: source.entityId,
          current_units: nowUnits,
          previous_units: beforeUnits,
          first_seen_at: times.length === 0 ? null : isoOf(Math.min(...times)),
          last_seen_at: times.length === 0 ? null : isoOf(Math.max(...times)),
        },
      },
    ];
  });
  const size = (row: Schemas['SourceChangeRow']): number => (kind === 'new' ? row.current_units : row.previous_units);
  return {
    rows: rows
      .sort(
        (a, b) =>
          size(b.row) - size(a.row) ||
          byText(a.source.registrable, b.source.registrable) ||
          byText(a.source.role, b.source.role) ||
          byText(a.source.entityId ?? '', b.source.entityId ?? ''),
      )
      .map(({ row }) => row),
    window: metricWindow(now),
    compareWindow: metricWindow(support),
  };
}

// Own pages per prompt, and the citations behind the counts

/** One row per prompt and engine with a counted answer: the own pages cited, as `sources/prompts` lists them; `ownCited` keeps those that cite one (`true`) or none (`false`). */
export function ownPagesOf(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  ownCited: boolean | null,
): Schemas['PromptOwnPagesRow'][] {
  const pairs = new Map<string, { prompt: string; engine: EngineCode; answers: CitedAnswer[] }>();
  for (const answer of countedAnswers(answers, scope)) {
    const key = `${answer.promptId} ${answer.engine}`;
    const pair = pairs.get(key) ?? { prompt: answer.promptId, engine: answer.engine, answers: [] };
    pair.answers.push(answer);
    pairs.set(key, pair);
  }
  return [...pairs.values()]
    .map((pair): Schemas['PromptOwnPagesRow'] => {
      const pages = new Map<number, { url: string; units: number }>();
      let citing = 0;
      let units = 0;
      for (const answer of pair.answers) {
        const own = unitsOf(answer, scope.flags).filter((unit) => unit.domain_role === 'own');
        if (own.length > 0) citing += 1;
        units += own.length;
        for (const unit of own) {
          const id = urlIdOf(canonicalOf(unit.url));
          pages.set(id, { url: unit.url, units: (pages.get(id)?.units ?? 0) + 1 });
        }
      }
      // The page with the most units, the lowest url id among equals
      const [top] = [...pages].sort(([a, x], [b, y]) => y.units - x.units || a - b);
      return {
        prompt_id: pair.prompt,
        engine_code: pair.engine,
        answers: pair.answers.length,
        answers_citing_own: citing,
        own_citation_units: units,
        own_pages: pages.size,
        top_own_page: top === undefined ? null : { url_id: top[0], url: top[1].url },
      };
    })
    .filter((row) => ownCited === null || row.answers_citing_own > 0 === ownCited)
    .sort((a, b) => byText(a.prompt_id, b.prompt_id) || byText(a.engine_code, b.engine_code));
}

/**
 * Every citation of the counted answers, the newest answer first and each answer's in its order: a URL listed
 * twice is two rows. Flags are not applied (the list is the evidence behind the counts); the role filter is.
 */
export function citationRowsOf(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  { registrableDomain = null, urlId = null }: { registrableDomain?: string | null; urlId?: number | null } = {},
): Schemas['CitationRow'][] {
  return countedAnswers(answers, scope).flatMap((answer) =>
    answer.citations.flatMap((citation): Schemas['CitationRow'][] => {
      const id = urlIdOf(canonicalOf(citation.url));
      const registrable = registrableOf(citation.host);
      return (scope.roles.length > 0 && !scope.roles.includes(citation.domain_role)) ||
        (registrableDomain !== null && registrable !== registrableDomain) ||
        (urlId !== null && id !== urlId)
        ? []
        : [
            {
              observation_id: answer.id,
              observed_at: isoOf(answer.at),
              prompt_id: answer.promptId,
              engine_code: answer.engine,
              citation_index: citation.citation_index,
              url_id: id,
              url: citation.url,
              raw_url: citation.raw_url,
              host: citation.host,
              registrable_domain: registrable,
              title: citation.title,
              citation_kind: citation.citation_kind,
              domain_role: citation.domain_role,
              role_entity_id: citation.role_entity_id,
              occurrences: citation.occurrences,
            },
          ];
    }),
  );
}
