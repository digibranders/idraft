import { entityRefView, termPath } from './entity';
import { locationRefFactory } from './location';
import type { EntityWorld } from '../entities-state';
import { MOCK_INVITED_USER, MOCK_USERS } from '../fixtures';
import { fixtureReading, fixtureReadingsOf, METRICS_FETCHED_AT, type FixtureReading } from '../keyword-fixtures';
import { keywordMetrics, metricsHistory } from '../keyword-metrics';
import { rankStateOf, sparklineOf, stoppedAtOf } from '../rank-state';
import { normalizeKeyword } from '@/lib/keywords/keyword-text';
import {
  currentVersion,
  isLive,
  type KeywordWorld,
  type StoredGroup,
  type StoredKeyword,
  type StoredTracked,
} from '../keywords-state';
import type { components } from '@/lib/api/schema';

/**
 * The keyword payloads of the step 5 routes, made from the stored rows: a tracked keyword in its three forms
 * (as written, as a list row with the blocks `include` asks for, as a detail), its keyword, groups, terms,
 * competitor overrides and configuration history, and Labs metrics.
 */

type Schemas = components['schemas'];
type TrackedKeyword = Schemas['TrackedKeyword'];
type TrackedKeywordRow = Schemas['TrackedKeywordRow'];
type TrackedKeywordDetail = Schemas['TrackedKeywordDetail'];
type KeywordView = Schemas['Keyword'];
type KeywordMetrics = Schemas['KeywordMetrics'];
type UrlRef = Schemas['UrlRef'];
type UserRef = Schemas['UserRef'];
type GroupRef = Schemas['GroupRef'];
type TermRef = Schemas['TermRef'];
type KeywordGroup = Schemas['KeywordGroup'];
type KeywordGroupNode = Schemas['KeywordGroupNode'];
type CompetitorOverride = Schemas['CompetitorOverride'];
type ConfigVersion = Schemas['ConfigVersion'];
type LocationRef = Schemas['LocationRef'];

export type Include =
  'metrics' | 'groups' | 'terms' | 'competitors' | 'sparkline' | 'competitor_ranks' | 'features' | 'aio';

/** A keyword added in a browser gets Labs metrics this long after it was added (backend plan D8). */
export const METRICS_DELAY_MS = 2 * 60 * 1000;

const USERS = [...MOCK_USERS, MOCK_INVITED_USER];

export function userRef(userId: string | null): UserRef | null {
  const user = USERS.find((candidate) => candidate.user_id === userId);
  return user === undefined ? null : { user_id: user.user_id, name: user.name, email: user.email };
}

/** A whole number from a text, the same on every run. */
function hashOf(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619);
  return hash >>> 0;
}

/** Cents as the API's decimal string of dollars: 1840 is "18.40". */
export const decimalOfCents = (cents: number): string =>
  `${String(Math.floor(cents / 100))}.${String(cents % 100).padStart(2, '0')}`;

/** A UUID made from a text, so the same URL keeps its id. */
function uuidOf(text: string): string {
  const hex = Array.from({ length: 4 }, (_, index) =>
    hashOf(`${String(index)}:${text}`)
      .toString(16)
      .padStart(8, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Two-label endings that belong to the registrable domain (`co.uk`), for the few the fixtures meet. */
const SECOND_LEVEL = new Set(['co.uk', 'com.au', 'co.jp', 'com.br', 'co.in']);

/** The canonical form of an http(s) URL the API keeps (canonicalizer v1, simplified), or `null`. */
export function canonicalUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '' || !url.hostname.includes('.')) return null;
  url.hash = '';
  return url;
}

export function urlRef(raw: string | null): UrlRef | null {
  const url = raw === null ? null : canonicalUrl(raw);
  if (url === null) return null;
  const host = url.hostname.toLowerCase();
  const labels = host.replace(/^www\./, '').split('.');
  const lastTwo = labels.slice(-2).join('.');
  const registrable = SECOND_LEVEL.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
  return {
    url_id: uuidOf(url.toString()),
    canonical_url: url.toString(),
    host,
    registrable_domain: registrable,
    path: url.pathname,
  };
}

export function keywordView(row: StoredKeyword): KeywordView {
  return {
    keyword_id: row.keyword_id,
    text: row.text,
    normalized_text: normalizeKeyword(row.text),
    language_code: row.language_code,
    created_at: row.created_at,
  };
}

const keywordOf = (world: KeywordWorld, keywordId: string): StoredKeyword => {
  const keyword = world.keywords.find((candidate) => candidate.keyword_id === keywordId);
  if (keyword === undefined) throw new Error(`A tracked keyword names a keyword that is missing: ${keywordId}`);
  return keyword;
};

/**
 * Labs' reading of a keyword at a location and language: the fixtures' own, or, for a keyword added in a
 * browser, one made from its text once `METRICS_DELAY_MS` has passed since it was first tracked there.
 */
export function readingOf(
  world: KeywordWorld,
  keywordId: string,
  locationId: number,
  languageCode: string,
  now: number = Date.now(),
): { reading: FixtureReading; fetchedAt: string } | null {
  const fixture = fixtureReading(keywordId, locationId, languageCode);
  if (fixture !== null) return { reading: fixture, fetchedAt: METRICS_FETCHED_AT };
  const keyword = world.keywords.find((candidate) => candidate.keyword_id === keywordId);
  const tracked = world.tracked
    .filter(
      (row) => row.keyword_id === keywordId && row.location_id === locationId && row.language_code === languageCode,
    )
    .map((row) => Date.parse(row.created_at));
  // Fixture keywords without a reading stay pending: they stand for a keyword added minutes ago
  if (keyword === undefined || tracked.length === 0 || fixtureReadingsOf(keywordId).length > 0) return null;
  if (keyword.created_at <= METRICS_FETCHED_AT) return null;
  const first = Math.min(...tracked);
  if (now < first + METRICS_DELAY_MS) return null;
  const seed = hashOf(`${normalizeKeyword(keyword.text)}:${String(locationId)}`);
  const words = normalizeKeyword(keyword.text).split(' ').length;
  const volume = Math.max(10, Math.round(((seed % 1000) + 10) * (words > 3 ? 0.4 : 4)));
  const difficulty = (seed >>> 10) % 90;
  const buying = /\b(agency|services|pricing|tool|software|buy|consultant|hire)\b/.test(normalizeKeyword(keyword.text));
  return {
    reading: {
      volume,
      difficulty,
      cpc: decimalOfCents((seed >>> 4) % 2000),
      intent: buying ? 'commercial' : 'informational',
    },
    fetchedAt: new Date(first + METRICS_DELAY_MS).toISOString(),
  };
}

export function metricsOf(
  world: KeywordWorld,
  row: Pick<StoredTracked, 'keyword_id' | 'location_id' | 'language_code'>,
): KeywordMetrics | null {
  const found = readingOf(world, row.keyword_id, row.location_id, row.language_code);
  if (found === null) return null;
  return keywordMetrics({
    keywordId: row.keyword_id,
    locationId: row.location_id,
    languageCode: row.language_code,
    volume: found.reading.volume,
    difficulty: found.reading.difficulty,
    cpc: found.reading.cpc,
    intent: found.reading.intent,
    fetchedAt: found.fetchedAt,
  });
}

export { metricsHistory };

function locationOf(locationId: number): LocationRef {
  return (
    locationRefFactory(locationId) ?? {
      location_id: locationId,
      name: String(locationId),
      country_iso: '',
      location_type: 'Country',
    }
  );
}

export function trackedKeywordView(world: KeywordWorld, row: StoredTracked): TrackedKeyword {
  const version = currentVersion(row);
  return {
    tracked_keyword_id: row.tracked_keyword_id,
    project_id: row.project_id,
    keyword: keywordView(keywordOf(world, row.keyword_id)),
    search_engine: 'google',
    location_id: row.location_id,
    location: locationOf(row.location_id),
    language_code: row.language_code,
    device: row.device,
    os: row.os,
    depth_profile: version.depth_profile,
    frequency: row.frequency,
    priority: row.priority,
    intent: row.intent,
    intent_source: row.intent_source,
    funnel_stage: row.funnel_stage,
    business_value: row.business_value,
    target_url: urlRef(version.target_url),
    schedule_id: row.schedule_id,
    is_active: row.is_active,
    source: row.source,
    config_version: row.versions.length,
    created_by: userRef(row.created_by),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * What the rank state of a tracked keyword depends on besides the keyword: the mock clock, which a request
 * reads once so that its filter, its sort and its rows agree, and the project's primary domain, which the
 * ranking URLs are under.
 */
export interface RankContext {
  now: number;
  domain: string | null;
}

/**
 * The keyword's rank state at `rank.now`, as the API answers it: derived from its id, when it was created and
 * the clock (./rank-state.ts), and from its target URL for the match. A keyword added in a browser is
 * `not_checked` until its first check runs.
 */
export function stateOf(row: StoredTracked, rank: RankContext): TrackedKeywordRow['state'] {
  return rankStateOf(
    row.tracked_keyword_id,
    row.created_at,
    rank.now,
    rank.domain,
    urlRef(currentVersion(row).target_url)?.canonical_url ?? null,
    stoppedAtOf(row),
  );
}

/** The group's names from the root down, joined by `/`. */
export function groupPath(world: KeywordWorld, row: StoredGroup): string {
  const names = [row.name];
  const seen = new Set([row.group_id]);
  let parentId = row.parent_id;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = world.groups.find((group) => group.group_id === parentId);
    if (parent === undefined) break;
    names.unshift(parent.name);
    seen.add(parent.group_id);
    parentId = parent.parent_id;
  }
  return names.join('/');
}

/** A group and every group under it. */
export function groupAndBelow(world: KeywordWorld, groupId: string): Set<string> {
  const found = new Set([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const group of world.groups) {
      if (group.parent_id !== null && found.has(group.parent_id) && !found.has(group.group_id)) {
        found.add(group.group_id);
        grew = true;
      }
    }
  }
  return found;
}

const byPath = (a: { path: string; id: string }, b: { path: string; id: string }): number =>
  a.path.localeCompare(b.path) || a.id.localeCompare(b.id);

export function groupsOf(world: KeywordWorld, trackedKeywordId: string): GroupRef[] {
  return world.members
    .filter((member) => member.tracked_keyword_id === trackedKeywordId)
    .flatMap((member) => world.groups.filter((group) => group.group_id === member.group_id))
    .map((group) => ({ group_id: group.group_id, name: group.name, path: groupPath(world, group) }))
    .sort((a, b) => byPath({ path: a.path, id: a.group_id }, { path: b.path, id: b.group_id }));
}

export function termsOf(world: KeywordWorld, entities: EntityWorld, trackedKeywordId: string): TermRef[] {
  return world.termLinks
    .filter((link) => link.tracked_keyword_id === trackedKeywordId)
    .flatMap((link) => entities.terms.filter((term) => term.term_id === link.term_id))
    .map((term) => ({
      term_id: term.term_id,
      vocabulary_id: term.vocabulary_id,
      vocabulary_kind:
        entities.vocabularies.find((vocabulary) => vocabulary.vocabulary_id === term.vocabulary_id)?.kind ?? 'custom',
      name: term.name,
      path: termPath(entities, term),
    }))
    .sort(
      (a, b) =>
        a.vocabulary_id.localeCompare(b.vocabulary_id) ||
        a.path.localeCompare(b.path) ||
        a.term_id.localeCompare(b.term_id),
    );
}

export function overridesOf(
  world: KeywordWorld,
  entities: EntityWorld,
  row: Pick<StoredTracked, 'tracked_keyword_id' | 'project_id'>,
): CompetitorOverride[] {
  return world.overrides
    .filter((override) => override.tracked_keyword_id === row.tracked_keyword_id)
    .flatMap((override) => {
      const entity = entities.entities.find((candidate) => candidate.entity_id === override.entity_id);
      if (entity === undefined) return [];
      // Only a live role gives the entity its role and colour
      const role = entities.roles.find(
        (candidate) =>
          candidate.project_id === row.project_id &&
          candidate.entity_id === entity.entity_id &&
          (candidate.removed_at ?? null) === null,
      );
      return [{ entity: entityRefView(entity, role), mode: override.mode }];
    })
    .sort(
      (a, b) =>
        a.entity.canonical_name.toLowerCase().localeCompare(b.entity.canonical_name.toLowerCase()) ||
        a.entity.entity_id.localeCompare(b.entity.entity_id),
    );
}

export function trackedKeywordRowView(
  world: KeywordWorld,
  entities: EntityWorld,
  row: StoredTracked,
  include: ReadonlySet<Include>,
  rank: RankContext,
): TrackedKeywordRow {
  return {
    ...trackedKeywordView(world, row),
    metrics: include.has('metrics') ? metricsOf(world, row) : null,
    groups: include.has('groups') ? groupsOf(world, row.tracked_keyword_id) : null,
    terms: include.has('terms') ? termsOf(world, entities, row.tracked_keyword_id) : null,
    competitors: include.has('competitors') ? overridesOf(world, entities, row) : null,
    // The real API fills these blocks when asked (`include=sparkline,competitor_ranks,features,aio`); this UI
    // fills sparkline when asked; the other three still answer null until their tasks
    sparkline: include.has('sparkline')
      ? sparklineOf(row.tracked_keyword_id, row.created_at, rank.now, rank.domain, stoppedAtOf(row))
      : null,
    competitor_ranks: null,
    features: null,
    aio: null,
    state: stateOf(row, rank),
  };
}

export function trackedKeywordDetailView(
  world: KeywordWorld,
  entities: EntityWorld,
  row: StoredTracked,
  schedule: Schemas['ScheduleRef'] | null,
  rank: RankContext,
): TrackedKeywordDetail {
  return {
    ...trackedKeywordView(world, row),
    metrics: metricsOf(world, row),
    groups: groupsOf(world, row.tracked_keyword_id),
    terms: termsOf(world, entities, row.tracked_keyword_id),
    competitor_overrides: overridesOf(world, entities, row),
    config_history_count: row.versions.length,
    schedule,
    state: stateOf(row, rank),
  };
}

export function configHistoryView(row: StoredTracked): ConfigVersion[] {
  return row.versions.map((version, index) => ({
    config_version: index + 1,
    depth_profile: version.depth_profile,
    target_url: urlRef(version.target_url),
    valid_from: version.valid_from,
    valid_to: row.versions[index + 1]?.valid_from ?? null,
    changed_by: userRef(version.changed_by),
    change_reason: version.change_reason,
  }));
}

/** Live, active tracked keywords in a group and the groups under it. */
export function groupKeywordCount(world: KeywordWorld, groupId: string): number {
  const groups = groupAndBelow(world, groupId);
  const tracked = new Set(
    world.members.filter((member) => groups.has(member.group_id)).map((member) => member.tracked_keyword_id),
  );
  return world.tracked.filter((row) => tracked.has(row.tracked_keyword_id) && isLive(row) && row.is_active).length;
}

export function groupView(world: KeywordWorld, row: StoredGroup): KeywordGroup {
  return {
    group_id: row.group_id,
    name: row.name,
    parent_id: row.parent_id,
    path: groupPath(world, row),
    keyword_count: groupKeywordCount(world, row.group_id),
    created_at: row.created_at,
  };
}

/** A project's groups as a tree, siblings by name. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Path order level by level (backend as built): a group's subtree comes right after it. */
export function byGroupPath(a: string, b: string): number {
  const left = a.split('/');
  const right = b.split('/');
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const order = byCodePoint(left[index] ?? '', right[index] ?? '');
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

export function groupTree(world: KeywordWorld, projectId: string): KeywordGroupNode[] {
  const groups = world.groups.filter((group) => group.project_id === projectId);
  const nodesUnder = (parentId: string | null): KeywordGroupNode[] =>
    groups
      .filter((group) => group.parent_id === parentId)
      .sort((a, b) => byCodePoint(a.name, b.name) || byCodePoint(a.group_id, b.group_id))
      .map((group) => ({ ...groupView(world, group), children: nodesUnder(group.group_id) }));
  return nodesUnder(null);
}
