import type { CitationsFixture } from '../citations-v2-fixture';
import type { paths } from '@/lib/api/schema';
import type { Schemas } from '@/lib/api/types';

/**
 * WP-77: the counting behind the five Citations routes (WP-76, docs/19 "As built (AI visibility WP-76 ...)") over the
 * preview's answers (./../citations-v2-fixture.ts), with the preview's names mapped onto the project that asks. Pure:
 * the handlers (./citations-v2.ts) check the request and call these.
 */

type EngineCode = Schemas['EngineCode'];
type DomainRole = Schemas['CitedPageRow']['domain_role'];
type BrandState = Schemas['BrandCell']['state'];
type CitedPageRow = Schemas['CitedPageRow'];
type RunSlot = Schemas['RunSlot'];
type GapPage = Schemas['GapPage'];

export type RunsChoice = 1 | 2 | 4;

export interface BoardCompetitor {
  entityId: string;
  name: string;
  colorIndex: number | null;
  domain: string | null;
}

export interface BoardTopic {
  termId: string;
  name: string;
}

/** What the model needs of the project that asks. */
export interface BoardWorld {
  ownHost: string;
  timezone: string;
  /** The tracked competitors in role order: fixture competitor `i` is the `i`-th. */
  competitors: readonly BoardCompetitor[];
  /** The project's topic terms: fixture topic `i` is term `i mod length`. */
  topics: readonly BoardTopic[];
}

interface BoardPage {
  urlId: number;
  url: string;
  host: string;
  path: string;
  title: string;
  role: DomainRole;
  /** The fixture competitor's position, for a competitor page. */
  position: number | null;
  competitor: BoardCompetitor | null;
}

interface BoardPrompt {
  index: number;
  id: string;
  text: string;
  topic: BoardTopic | null;
}

interface BoardAnswer {
  prompt: BoardPrompt;
  engine: EngineCode;
  slot: number;
  at: string;
  mentioned: boolean;
  pages: readonly BoardPage[];
  rivals: readonly number[];
}

export interface Board {
  world: BoardWorld;
  pages: readonly BoardPage[];
  answers: readonly BoardAnswer[];
  latestRunNumber: number;
}

export interface BoardScope {
  runs: RunsChoice;
  /** In code order. */
  engines: readonly EngineCode[];
  /** The term asked for and those under it; `null` for every prompt. */
  termIds: ReadonlySet<string> | null;
}

type CitedPagesQuery = NonNullable<
  paths['/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/cited-pages']['get']['parameters']['query']
>;
export type CitedPagesSort = NonNullable<CitedPagesQuery['sort']>;

export interface PageListQuery {
  role: DomainRole | null;
  q: string;
  sort: CitedPagesSort;
  offset: number;
  limit: number;
}

/** The most prompts a page row lists (the prompts popover shows ten, C 428). */
const TOP_PROMPTS = 10;
/** The third-party pages of the gap drawer (D 445) and the closest own pages (D 447). */
const THIRD_PAGES = 5;
const CLOSEST_PAGES = 3;
/** The domains of "Cited alongside" (D 336). */
const ALONGSIDE = 8;

export function boardOf(fixture: CitationsFixture, world: BoardWorld): Board {
  const pages = fixture.urls.map((url, index): BoardPage => {
    const competitor = url.competitor === null ? null : (world.competitors[url.competitor] ?? null);
    const host =
      url.role === 'own' ? world.ownHost : url.role === 'competitor' ? (competitor?.domain ?? url.domain) : url.domain;
    return {
      urlId: index + 1,
      url: `https://${host}${url.path}`,
      host,
      path: url.path,
      title: url.title,
      role: url.role,
      position: url.competitor,
      competitor,
    };
  });
  const prompts = fixture.prompts.map((prompt, index): BoardPrompt => ({
    index,
    id: prompt.id,
    text: prompt.text,
    topic: world.topics.length === 0 ? null : (world.topics[prompt.topic % world.topics.length] ?? null),
  }));
  const answers = fixture.answers.flatMap(
    ([promptIndex, engineIndex, slot, mentioned, urls, rivals]): BoardAnswer[] => {
      const prompt = prompts[promptIndex];
      const engine = fixture.engines[engineIndex];
      const at = fixture.slots[slot - 1];
      if (prompt === undefined || engine === undefined || at === undefined) return [];
      return [
        {
          prompt,
          engine,
          slot,
          at: at[engine],
          mentioned: mentioned === 1,
          pages: urls.flatMap((url) => pages[url] ?? []),
          rivals,
        },
      ];
    },
  );
  return { world, pages, answers, latestRunNumber: fixture.latestRunNumber };
}

// -------------------------------------------------------------------------------------------------
// Windows

type Period = 'current' | 'previous' | 'trend';

function answersOf(board: Board, scope: BoardScope, period: Period): BoardAnswer[] {
  return board.answers.filter(
    (answer) =>
      scope.engines.includes(answer.engine) &&
      (scope.termIds === null || (answer.prompt.topic !== null && scope.termIds.has(answer.prompt.topic.termId))) &&
      (period === 'trend' ||
        (period === 'current' ? answer.slot <= scope.runs : answer.slot > scope.runs && answer.slot <= 2 * scope.runs)),
  );
}

const between = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function slotOf(answers: readonly BoardAnswer[], slot: number): RunSlot | null {
  const times = answers
    .filter((answer) => answer.slot === slot)
    .map((answer) => answer.at)
    .sort();
  const first = times[0];
  const last = times[times.length - 1];
  return first === undefined || last === undefined
    ? null
    : { slot, first_at: first, last_at: last, answers: times.length };
}

export function windowOf(board: Board, scope: BoardScope): Schemas['RunWindow'] {
  const all = answersOf(board, scope, 'trend');
  const slots = (numbers: readonly number[]): RunSlot[] => numbers.flatMap((slot) => slotOf(all, slot) ?? []);
  const now = answersOf(board, scope, 'current');
  const latest = now.map((answer) => answer.at).sort()[now.length - 1] ?? null;
  return {
    runs: scope.runs,
    timezone: board.world.timezone,
    current: slots(between(1, scope.runs)),
    previous: slots(between(scope.runs + 1, 2 * scope.runs)),
    trend: slots(between(1, 8).reverse()),
    answers: now.length,
    prompts: new Set(now.map((answer) => answer.prompt.index)).size,
    latest_answer_at: latest,
    latest_run_number: latest === null ? null : board.latestRunNumber,
  };
}

// -------------------------------------------------------------------------------------------------
// Overview

const isOwn = (page: BoardPage): boolean => page.role === 'own';
const citesOwn = (answer: BoardAnswer): boolean => answer.pages.some(isOwn);
const ownUnits = (answers: readonly BoardAnswer[]): number =>
  answers.reduce((sum, answer) => sum + answer.pages.filter(isOwn).length, 0);
const distinct = (values: readonly (string | number)[]): number => new Set(values).size;
const pairOf = (answer: BoardAnswer): string => `${String(answer.prompt.index)}|${answer.engine}`;

export function overviewOf(board: Board, scope: BoardScope): Schemas['CitationOverview'] {
  const now = answersOf(board, scope, 'current');
  const before = answersOf(board, scope, 'previous');
  const beforePairs = new Set(before.map(pairOf));
  const both = new Set(now.map(pairOf).filter((pair) => beforePairs.has(pair)));
  const matched = (answers: readonly BoardAnswer[]): BoardAnswer[] =>
    answers.filter((answer) => both.has(pairOf(answer)));
  const ownUrls = (answers: readonly BoardAnswer[]): number =>
    distinct(answers.flatMap((answer) => answer.pages.filter(isOwn).map((page) => page.urlId)));
  const domains = (answers: readonly BoardAnswer[]): number =>
    distinct(answers.flatMap((answer) => answer.pages.map((page) => page.host)));
  const promptsOf = (answers: readonly BoardAnswer[]): number => distinct(answers.map((answer) => answer.prompt.index));
  return {
    citations: ownUnits(now),
    previous_citations: ownUnits(before),
    matched_citations: ownUnits(matched(now)),
    matched_previous_citations: ownUnits(matched(before)),
    matched_pairs: both.size,
    own_urls: ownUrls(now),
    previous_own_urls: ownUrls(before),
    domains: domains(now),
    previous_domains: domains(before),
    engines: scope.engines.map((code) => {
      const current = now.filter((answer) => answer.engine === code);
      const previous = before.filter((answer) => answer.engine === code);
      return {
        engine_code: code,
        answers: current.length,
        answers_citing: current.filter(citesOwn).length,
        prompts: promptsOf(current),
        prompts_citing: promptsOf(current.filter(citesOwn)),
        previous_answers: previous.length,
        previous_answers_citing: previous.filter(citesOwn).length,
        previous_prompts: promptsOf(previous),
        previous_prompts_citing: promptsOf(previous.filter(citesOwn)),
      };
    }),
    window: windowOf(board, scope),
  };
}

// -------------------------------------------------------------------------------------------------
// Cited pages

interface PageTally {
  page: BoardPage;
  citations: number;
  previous: number;
  prompts: Map<number, { prompt: BoardPrompt; citations: number }>;
  engines: Map<EngineCode, number>;
  last: string;
  trend: Map<number, number>;
}

function pageRowsOf(board: Board, scope: BoardScope): CitedPageRow[] {
  const tallies = new Map<number, PageTally>();
  for (const answer of answersOf(board, scope, 'current')) {
    for (const page of answer.pages) {
      const tally = tallies.get(page.urlId) ?? {
        page,
        citations: 0,
        previous: 0,
        prompts: new Map(),
        engines: new Map(),
        last: '',
        trend: new Map(),
      };
      tally.citations += 1;
      const prompt = tally.prompts.get(answer.prompt.index) ?? { prompt: answer.prompt, citations: 0 };
      prompt.citations += 1;
      tally.prompts.set(answer.prompt.index, prompt);
      tally.engines.set(answer.engine, (tally.engines.get(answer.engine) ?? 0) + 1);
      if (answer.at > tally.last) tally.last = answer.at;
      tallies.set(page.urlId, tally);
    }
  }
  for (const answer of answersOf(board, scope, 'previous')) {
    for (const page of answer.pages) {
      const tally = tallies.get(page.urlId);
      if (tally !== undefined) tally.previous += 1;
    }
  }
  for (const answer of answersOf(board, scope, 'trend')) {
    for (const page of answer.pages) {
      const tally = tallies.get(page.urlId);
      if (tally !== undefined) tally.trend.set(answer.slot, (tally.trend.get(answer.slot) ?? 0) + 1);
    }
  }
  const slots = windowOf(board, scope).trend.map((slot) => slot.slot);
  return [...tallies.values()].map((tally): CitedPageRow => ({
    url_id: tally.page.urlId,
    url: tally.page.url,
    host: tally.page.host,
    path: tally.page.path,
    registrable_domain: tally.page.host,
    title: tally.page.title,
    domain_role: tally.page.role,
    entity_id: tally.page.competitor?.entityId ?? null,
    entity_name: tally.page.competitor?.name ?? null,
    color_index: tally.page.competitor?.colorIndex ?? null,
    citations: tally.citations,
    previous_citations: tally.previous,
    prompts: tally.prompts.size,
    top_prompts: [...tally.prompts.values()]
      .sort((a, b) => b.citations - a.citations || a.prompt.text.localeCompare(b.prompt.text))
      .slice(0, TOP_PROMPTS)
      .map((entry) => ({ prompt_id: entry.prompt.id, text: entry.prompt.text, citations: entry.citations })),
    engines: scope.engines.map((code) => ({ engine_code: code, citation_units: tally.engines.get(code) ?? 0 })),
    trend: slots.map((slot) => tally.trend.get(slot) ?? 0),
    last_cited_at: tally.last,
  }));
}

function sortValue(key: string, row: CitedPageRow): number | string {
  switch (key) {
    case 'change':
      return row.citations - row.previous_citations;
    case 'prompts':
      return row.prompts;
    case 'last_cited':
      return row.last_cited_at;
    case 'page':
      return row.url;
    default:
      return row.citations;
  }
}

const compareValues = (x: number | string, y: number | string): number =>
  typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));

export function citedPagesOf(board: Board, scope: BoardScope, query: PageListQuery): Schemas['CitedPagePage'] {
  const rows = pageRowsOf(board, scope);
  const needle = query.q.toLowerCase();
  const kept = rows.filter(
    (row) =>
      (query.role === null || row.domain_role === query.role) &&
      (needle === '' || row.url.toLowerCase().includes(needle) || (row.title ?? '').toLowerCase().includes(needle)),
  );
  const desc = query.sort.startsWith('-');
  const key = desc ? query.sort.slice(1) : query.sort;
  kept.sort((a, b) => {
    const order = compareValues(sortValue(key, a), sortValue(key, b));
    return (desc ? -order : order) || b.citations - a.citations || a.url.localeCompare(b.url);
  });
  const count = (role: DomainRole): number => rows.filter((row) => row.domain_role === role).length;
  return {
    data: kept.slice(query.offset, query.offset + query.limit),
    meta: {
      citations: kept.reduce((sum, row) => sum + row.citations, 0),
      owners: {
        own: count('own'),
        competitor: count('competitor'),
        third_party: count('third_party'),
        all: rows.length,
      },
      window: windowOf(board, scope),
    },
    page: { offset: query.offset, limit: query.limit, total: kept.length },
  };
}

export function citedPageOf(board: Board, scope: BoardScope, urlId: number): Schemas['CitedPageDetail'] | null {
  const page = pageRowsOf(board, scope).find((row) => row.url_id === urlId);
  if (page === undefined) return null;
  interface PromptEntry {
    prompt: BoardPrompt;
    answers: number;
    cited: number;
    last: string;
    engines: Map<EngineCode, { answers: number; cited: number }>;
  }
  const byPrompt = new Map<number, PromptEntry>();
  const alongside = new Map<string, { page: BoardPage; answers: number }>();
  for (const answer of answersOf(board, scope, 'current')) {
    const entry = byPrompt.get(answer.prompt.index) ?? {
      prompt: answer.prompt,
      answers: 0,
      cited: 0,
      last: '',
      engines: new Map(),
    };
    const cell = entry.engines.get(answer.engine) ?? { answers: 0, cited: 0 };
    cell.answers += 1;
    entry.answers += 1;
    if (answer.pages.some((candidate) => candidate.urlId === urlId)) {
      cell.cited += 1;
      entry.cited += 1;
      if (answer.at > entry.last) entry.last = answer.at;
      // Once per answer (D-9): a domain with two URLs in one answer is one answer
      const domains = new Map<string, BoardPage>();
      for (const other of answer.pages) {
        if (other.urlId !== urlId && !domains.has(other.host)) domains.set(other.host, other);
      }
      for (const [host, other] of domains) {
        const item = alongside.get(host) ?? { page: other, answers: 0 };
        item.answers += 1;
        alongside.set(host, item);
      }
    }
    entry.engines.set(answer.engine, cell);
    byPrompt.set(answer.prompt.index, entry);
  }
  return {
    page,
    prompts: [...byPrompt.values()]
      .filter((entry) => entry.cited > 0)
      .sort((a, b) => b.cited - a.cited || a.prompt.text.localeCompare(b.prompt.text))
      .map((entry) => ({
        prompt_id: entry.prompt.id,
        text: entry.prompt.text,
        answers: entry.answers,
        cited: entry.cited,
        last_cited_at: entry.last,
        engines: scope.engines.map((code) => ({
          engine_code: code,
          answers: entry.engines.get(code)?.answers ?? 0,
          cited: entry.engines.get(code)?.cited ?? 0,
        })),
      })),
    alongside: [...alongside.entries()]
      .sort(([hostA, a], [hostB, b]) => b.answers - a.answers || hostA.localeCompare(hostB))
      .slice(0, ALONGSIDE)
      .map(([host, item]) => ({
        registrable_domain: host,
        domain_role: item.page.role,
        entity_id: item.page.competitor?.entityId ?? null,
        entity_name: item.page.competitor?.name ?? null,
        color_index: item.page.competitor?.colorIndex ?? null,
        answers: item.answers,
      })),
    window: windowOf(board, scope),
  };
}

// -------------------------------------------------------------------------------------------------
// Gap analysis

interface Cell {
  answers: number;
  cited: number;
  mentioned: number;
}

const blank = (): Cell => ({ answers: 0, cited: 0, mentioned: 0 });
const stateOf = (cell: Cell): BrandState =>
  cell.answers === 0 ? 'none' : cell.cited > 0 ? 'cited' : cell.mentioned > 0 ? 'mentioned' : 'not';

function tallyInto(cells: Map<EngineCode, Cell>, engine: EngineCode, cited: boolean, mentioned: boolean): void {
  const cell = cells.get(engine) ?? blank();
  cell.answers += 1;
  if (cited) cell.cited += 1;
  if (mentioned) cell.mentioned += 1;
  cells.set(engine, cell);
}

function brandOf(engines: readonly EngineCode[], cells: ReadonlyMap<EngineCode, Cell>): Schemas['BrandOnPrompt'] {
  const list = engines.map((code) => {
    const cell = cells.get(code) ?? blank();
    return { engine_code: code, ...cell, state: stateOf(cell) };
  });
  const total = list.reduce(
    (sum, cell) => ({
      answers: sum.answers + cell.answers,
      cited: sum.cited + cell.cited,
      mentioned: sum.mentioned + cell.mentioned,
    }),
    blank(),
  );
  return {
    total: { ...total, state: stateOf(total) },
    engines: list,
    platforms: list.filter((cell) => cell.answers > 0).length,
    cited_on: list.filter((cell) => cell.cited > 0).length,
  };
}

const positionsOf = (board: Board, ids: readonly string[]): number[] =>
  ids.map((id) => board.world.competitors.findIndex((competitor) => competitor.entityId === id));

export function gapRowsOf(board: Board, scope: BoardScope, ids: readonly string[]): Schemas['CitationGapRow'][] {
  const positions = positionsOf(board, ids);
  const tallies = new Map<
    number,
    { prompt: BoardPrompt; you: Map<EngineCode, Cell>; rivals: Map<EngineCode, Cell>[] }
  >();
  for (const answer of answersOf(board, scope, 'current')) {
    const tally = tallies.get(answer.prompt.index) ?? {
      prompt: answer.prompt,
      you: new Map<EngineCode, Cell>(),
      rivals: ids.map(() => new Map<EngineCode, Cell>()),
    };
    tallyInto(tally.you, answer.engine, citesOwn(answer), answer.mentioned);
    positions.forEach((position, index) => {
      const flag = answer.rivals[position] ?? 0;
      const target = tally.rivals[index];
      if (target !== undefined) tallyInto(target, answer.engine, flag === 2, flag >= 1);
    });
    tallies.set(answer.prompt.index, tally);
  }
  const rows = [...tallies.values()].map((tally): Schemas['CitationGapRow'] => {
    const you = brandOf(scope.engines, tally.you);
    const competitors = ids.map((id, index) => ({
      entity_id: id,
      ...brandOf(scope.engines, tally.rivals[index] ?? new Map()),
    }));
    // Decided per engine: answers there, none cites you, a selected competitor is cited there (D 386)
    const lostOn = scope.engines.filter((code) => {
      const mine = tally.you.get(code);
      return (
        mine !== undefined &&
        mine.answers > 0 &&
        mine.cited === 0 &&
        tally.rivals.some((cells) => (cells.get(code)?.cited ?? 0) > 0)
      );
    });
    return {
      prompt_id: tally.prompt.id,
      text: tally.prompt.text,
      topic: tally.prompt.topic === null ? null : { term_id: tally.prompt.topic.termId, name: tally.prompt.topic.name },
      you,
      competitors,
      gap: lostOn.length,
      lost_on: lostOn,
      lost_to: ids.filter((_, index) => lostOn.some((code) => (tally.rivals[index]?.get(code)?.cited ?? 0) > 0)),
      competitor_answers: competitors.reduce((sum, competitor) => sum + competitor.total.cited, 0),
    };
  });
  return rows
    .filter((row) => row.you.total.answers > 0)
    .sort(
      (a, b) =>
        b.gap - a.gap ||
        b.lost_to.length - a.lost_to.length ||
        b.competitor_answers - a.competitor_answers ||
        a.text.localeCompare(b.text),
    );
}

export function gapsOf(board: Board, scope: BoardScope, ids: readonly string[]): Schemas['CitationGapList'] {
  const rows = gapRowsOf(board, scope, ids);
  return {
    data: rows,
    meta: {
      competitors: ids.flatMap((id) => {
        const competitor = board.world.competitors.find((candidate) => candidate.entityId === id);
        return competitor === undefined
          ? []
          : [{ entity_id: id, name: competitor.name, color_index: competitor.colorIndex, domain: competitor.domain }];
      }),
      gaps: rows.filter((row) => row.gap > 0).length,
      prompts: rows.length,
      window: windowOf(board, scope),
    },
  };
}

function pagesOf(
  answers: readonly BoardAnswer[],
  engines: readonly EngineCode[],
  keep: (page: BoardPage, answer: BoardAnswer) => boolean,
): GapPage[] {
  const tallies = new Map<number, { page: BoardPage; citations: number; engines: Set<EngineCode> }>();
  for (const answer of answers) {
    for (const page of answer.pages) {
      if (!keep(page, answer)) continue;
      const tally = tallies.get(page.urlId) ?? { page, citations: 0, engines: new Set<EngineCode>() };
      tally.citations += 1;
      tally.engines.add(answer.engine);
      tallies.set(page.urlId, tally);
    }
  }
  return [...tallies.values()]
    .sort((a, b) => b.citations - a.citations || a.page.url.localeCompare(b.page.url))
    .map((tally) => ({
      url_id: tally.page.urlId,
      url: tally.page.url,
      entity_id: tally.page.competitor?.entityId ?? null,
      citations: tally.citations,
      engines: engines.filter((code) => tally.engines.has(code)),
    }));
}

export function gapOf(
  board: Board,
  scope: BoardScope,
  ids: readonly string[],
  promptId: string,
): Schemas['CitationGapDetail'] | null {
  const row = gapRowsOf(board, scope, ids).find((candidate) => candidate.prompt_id === promptId);
  if (row === undefined) return null;
  const now = answersOf(board, scope, 'current');
  const mine = now.filter((answer) => answer.prompt.id === promptId);
  const selected = new Set(positionsOf(board, ids));
  const topic = row.topic;
  return {
    row,
    answers: mine.length,
    competitor_pages: pagesOf(
      mine,
      scope.engines,
      (page, answer) =>
        page.role === 'competitor' &&
        page.position !== null &&
        selected.has(page.position) &&
        answer.rivals[page.position] === 2,
    ),
    own_pages: pagesOf(mine, scope.engines, isOwn),
    third_party_pages: pagesOf(mine, scope.engines, (page) => page.role === 'third_party').slice(0, THIRD_PAGES),
    // The own pages cited for the other prompts that share its topic term, the ones to improve first (D 434)
    closest_pages:
      topic === null
        ? []
        : pagesOf(
            now.filter((answer) => answer.prompt.id !== promptId && answer.prompt.topic?.termId === topic.term_id),
            scope.engines,
            isOwn,
          ).slice(0, CLOSEST_PAGES),
    window: windowOf(board, scope),
  };
}
