# Internal links, plan 11: Link map tab (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Link map" tab in Internal links that draws every live page of a crawl as one graph, so a reader can find a page, tell pages apart and see which pages link to which.

**Architecture:** The tab reads the crawl once from `GET .../internal-links/graph` (plan 10). Four pure modules turn that answer into a picture: the graph model, a deterministic layout (run in a Web Worker), the focus (what is lit) and the ECharts option. One thin canvas component owns the ECharts instance and its pointer events; the tab composes it with the toolbar, legend, card and view controls. The approved mock is the reference for behaviour and looks.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, TanStack Query, nuqs, next-intl, ECharts 6 (`echarts/core`, already a dependency), Vitest with Testing Library and MSW, Playwright.

Date: 2026-11-26. Branch: `feat/link-map-web`, worktree `.claude/worktrees/link-map-web` (`git worktree add .claude/worktrees/link-map-web -b feat/link-map-web origin/develop`, after plan 10 is on `origin/develop`). Builder: one Sonnet session, one task at a time. Each task ends with an independent review on Sonnet (never Opus or Fable). Targeted serial tests only (`pnpm vitest run <path> --maxWorkers=1`); `pnpm build` once, in the last task. No dev server is left running.

## Read before the first task

1. `apps/web/AGENTS.md`: this Next.js has breaking changes. Read the guides in `apps/web/node_modules/next/dist/docs/` for anything you are about to use (dynamic imports, Web Workers), before writing it.
2. `AI_DEVELOPMENT_UI_RULES.md` and `DESIGN_SYSTEM.md` at the repository root, and `docs/design-system/15-data-visualization.md` sections 1 to 3.
3. `docs/glossary/final-list.md` before any visible string. A new word goes into `docs/glossary/terms.md` first.
4. The approved mock, which is the reference: `apps/web/design-preview/il-map.js` (screen) and `il-map-layout.js` (graph and layout). Run it with the `design-preview-develop` preview entry at `http://localhost:4190/#/internal-links/map`, look, then stop it.
5. The tab this one sits beside: `src/features/internal-links/flow/flow-tab.tsx` (a small tab: read, states, export) and `src/features/internal-links/tabs.ts`.
6. The canvas wrapper to model the new one on: `src/components/app/chart/echart.tsx` and its test `echart.test.tsx` (how ECharts is mocked).

---

## Decisions taken as given

- **W1 Renderer: ECharts graph series.** It is already a dependency. Measured on 2026-11-26 in headless Chromium with every page named: 400 pages paint in 41 ms and zoom at 7 ms a step; 2,000 pages 113 ms and 38 ms; 5,000 pages 280 ms and 133 ms; 10,000 pages 526 ms and 320 ms. So the map is good to about 3,000 pages and no new renderer is added. sigma.js is the upgrade when a customer needs a bigger map; it is not in this plan.
- **W2 Layout: the mock's algorithm, in a Web Worker.** Pure and deterministic (no random start), so a crawl gives the same picture to everyone. Measured at 400 rounds: 160 linked pages 0.3 s, 500 pages 1.7 s, 1,000 pages 3.5 s, 2,000 pages 11 s. So the rounds fall with size (task 3) and the work never runs on the main thread.
- **W3 Size cap.** The tab asks for `max_pages=3000`. When the answer is `truncated`, a banner says the map shows the 3,000 most linked pages of N.
- **W4 Menu and footer links are not edges** (owner, 2026-11-26). A page they point to shows it on its card and under Highlight.
- **W5 Tier colours on the map are one hue per tier**, not the one-blue scale of the tier badges: a dot a few pixels wide cannot carry four shades of blue. T1 `chart-1`, T2 `chart-2`, T3 `chart-other`, T4 `chart-bar-neutral` with a `border-strong` outline, T5 to T8 `chart-3` to `chart-6`, Untiered a hollow dot. Task 9 records this in the design system.
- **W6 Reading a page.** Pointing shows a two line tooltip above the pointer and dims the rest of the map a little, with a 140 ms fade. A click selects: the page and the pages it links with stay lit, links in green and dotted, links out blue and solid, and a card opens with "Page details" (the inspector) and "Open in Journey". Escape, the card's close button or a click on the background lets go. A click does not open the inspector by itself.
- **W7 Finding a page.** A search box lights the pages whose address or title contains the text and shows "n of N pages"; Enter zooms to them, and selects the page when there is one.
- **W8 Names.** Every page carries the last part of its address. Names that would overlap give way to the bigger dot (ECharts `labelLayout.hideOverlap`) and return on zoom. Pages in the block of unlinked pages get names from 200 percent zoom, or while a search or a selection lights them.
- **W9 Dot size** grows with links in plus links out, so the page a group gathers around stands out. Dots and names grow on a large canvas and shrink on a small one.
- **W10 The block of unlinked pages** stands to the right of the map, or under it when the canvas is taller than wide, one grid per tier.
- **W11 Full screen** fills the window (a fixed panel under the inspector's layer) and asks the browser for its own full screen where that is allowed.
- **W12 Address state.** `tab=map`, `mq` (search), `mauto=1` (auto-generated links drawn), `mcol=section` (colour), `mhl` (highlight: `noIn`, `deadEnd`, `sitewide`), `mpage` (the selected page's url id). The zoom, dragged pages, legend switches and the minimap are not in the address.
- **W13 The accessible version is the Pages tab.** The canvas is `role="img"` with a sentence that says what the map shows. Every control is a real button or field.

## File structure

| File | Responsibility |
|---|---|
| Modify `src/lib/internal-links/types.ts`, `queries.ts` | The graph types and `linkGraphQuery`. |
| Create `src/mocks/fixtures/link-graph.ts`; modify `src/mocks/handlers/internal-links.ts` | A small graph and its handler. |
| Create `src/lib/internal-links/map-graph.ts` (+ test) | The view model: nodes with names and sections, colour groups, the summary. |
| Create `src/lib/internal-links/map-layout.ts` (+ test) | Positions: force layout for linked pages, grids for the rest. Pure. |
| Create `src/lib/internal-links/map-layout.worker.ts`, `src/features/internal-links/map/use-map-layout.ts` (+ test) | The layout off the main thread. |
| Create `src/lib/internal-links/map-focus.ts` (+ test) | Which pages are lit: selection, search, highlight. |
| Create `src/lib/internal-links/map-option.ts` (+ test) | The ECharts option from model, layout, focus, tokens and canvas size. |
| Create `src/components/app/link-map/link-map-chart.tsx` (+ test) | The ECharts instance, its pointer rules and its handle (zoom, fit, show). |
| Create `src/features/internal-links/map/map-tab.tsx`, `map-toolbar.tsx`, `map-legend.tsx`, `map-card.tsx`, `map-help.tsx` (+ tests) | The tab and its parts. |
| Modify `src/features/internal-links/url-state.ts`, `tabs.ts` (+ their tests) | The tab id, its place and its address keys. |
| Modify `messages/en.json`, `docs/glossary/terms.md`, `docs/glossary/final-list.md` | Words. |
| Modify `docs/design-system/15-data-visualization.md`, `docs/design-system/25-component-inventory.md`, `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md` | The design system entry and the spec section. |
| Create `e2e/flows/internal-links-map.spec.ts` | One flow. |

---

### Task 1: Types, query and mock data

**Files:**
- Modify: `apps/web/src/lib/api/schema.ts` (generated), `src/lib/internal-links/types.ts`, `src/lib/internal-links/queries.ts`
- Create: `src/mocks/fixtures/link-graph.ts`
- Modify: `src/mocks/handlers/internal-links.ts`
- Test: `src/lib/internal-links/queries.test.ts`

- [ ] **Step 1: Regenerate the client.** From `apps/web`: `pnpm gen:api`. Expected: `src/lib/api/schema.ts` gains the path `/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/graph` and the schemas `GraphNode`, `GraphEdge`, `LinkGraph`, `LinkGraphResponse`. Commit it alone: `git commit -m "Web: regenerate the API client for the graph read"`.

- [ ] **Step 2: Add the types** to `src/lib/internal-links/types.ts`:

```ts
export type LinkGraph = Schemas['LinkGraph'];
export type GraphNode = Schemas['GraphNode'];
export type GraphEdge = Schemas['GraphEdge'];
```

- [ ] **Step 3: Write the failing test** in `src/lib/internal-links/queries.test.ts` (follow the file's existing cases for the key and the path):

```ts
it('reads the graph of the crawl in view, with auto-generated links when asked', () => {
  const scope = { workspaceId: 'w1', projectId: 'p1' } as LinksScope;
  const latest = linkGraphQuery(scope, false, null);
  const older = linkGraphQuery(scope, true, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  expect(latest.queryKey).not.toEqual(older.queryKey);
  expect(JSON.stringify(latest.queryKey)).toContain('max_pages');
  expect(JSON.stringify(older.queryKey)).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
```

Build `scope` the way the other cases of that file build a `LinksScope`. Run: `pnpm vitest run src/lib/internal-links/queries.test.ts --maxWorkers=1`. Expected: FAIL, `linkGraphQuery is not defined`.

- [ ] **Step 4: Add the query** to `src/lib/internal-links/queries.ts`, beside `tierFlowQuery`:

```ts
const GRAPH = `${P}/internal-links/graph` as const;

/** The most pages the Link map draws (plan 11, W3): the canvas stays smooth to about this many. */
export const MAP_MAX_PAGES = 3000;

/** The whole crawl as the Link map's nodes and edges. A finished crawl never changes, so the answer is kept. */
export const linkGraphQuery = (
  scope: LinksScope,
  includeAuto: boolean,
  run: string | null,
): ApiQueryOptions<typeof GRAPH> => ({
  ...apiQuery(GRAPH, {
    params: { path: pathOf(scope), query: withRun({ include_auto: includeAuto, max_pages: MAP_MAX_PAGES }, run) },
  }),
  staleTime: run === null ? 60_000 : Number.POSITIVE_INFINITY,
});
```

Run the test again. Expected: PASS.

- [ ] **Step 5: Mock data.** Create `src/mocks/fixtures/link-graph.ts`. Take the tier ids from the tier list the mock already serves for `GET .../page-tiers` (find it in `src/mocks/handlers/internal-links.ts`; import that list, do not copy ids):

```ts
import type { LinkGraph } from '@/lib/internal-links/types';

/**
 * A small crawl for the Link map: a home page, two money pages, a hub with three posts, two case studies that link
 * to the same guides, and four pages no body link reaches. `tierIds` are the workspace's tiers in order (T1 first).
 */
export function linkGraphFixture(runId: string, tierIds: readonly string[], includeAuto: boolean): LinkGraph {
  const [t1, t2, t3, t4] = tierIds;
  const node = (
    url_id: string,
    path: string,
    title: string,
    tier_id: string | undefined,
    links_in: number,
    links_out: number,
    sitewide_from = 0,
  ): LinkGraph['nodes'][number] => ({ url_id, path, title, tier_id: tier_id ?? null, links_in, links_out, sitewide_from });
  const edge = (source: string, target: string, links = 1): LinkGraph['edges'][number] => ({ source, target, links });
  const edges = [
    edge('1', '2'), edge('1', '3'), edge('4', '5'), edge('4', '6'), edge('4', '7'),
    edge('5', '2'), edge('8', '2'), edge('8', '10'), edge('8', '11'), edge('9', '2'),
    edge('9', '10'), edge('9', '11'), edge('10', '3', 2),
    ...(includeAuto ? [edge('5', '6'), edge('6', '5')] : []),
  ];
  const count = (id: string, end: 'source' | 'target'): number => edges.filter((item) => item[end] === id).length;
  const page = (id: string, path: string, title: string, tier: string | undefined, sitewide = 0) =>
    node(id, path, title, tier, count(id, 'target'), count(id, 'source'), sitewide);
  return {
    run_id: runId,
    include_auto: includeAuto,
    pages_total: 15,
    truncated: false,
    home_url_id: '1',
    nodes: [
      page('1', '/', 'Eventus Security', t1, 15),
      page('2', '/managed-soc-service', 'Managed SOC service', t1, 15),
      page('3', '/incident-response', 'Incident response', t1, 15),
      page('4', '/blog', 'Blog', t2, 15),
      page('5', '/blog/soc-modernization', 'Why SOC modernization matters', t3),
      page('6', '/blog/ransomware-groups', 'Five ransomware groups', t3),
      page('7', '/blog/ai-in-the-soc', 'AI in the SOC', t3),
      page('8', '/india/bfsi/case-study/digital-bank', 'Digital bank case study', t2),
      page('9', '/india/bfsi/case-study/stockbroker', 'Stockbroker case study', t2),
      page('10', '/cybersecurity/soc/siem', 'What is SIEM?', t3),
      page('11', '/cybersecurity/soc/soar', 'What is SOAR?', t3),
      page('12', '/cybersecurity/soc/edr', 'What is EDR?', t3),
      page('13', '/cybersecurity/threat-hunting', 'What is threat hunting?', t3),
      page('14', '/privacy-policy', 'Privacy policy', t4, 15),
      page('15', '/old-landing', 'Old landing page', undefined),
    ],
    edges,
  };
}
```

- [ ] **Step 6: Add the handler** in `src/mocks/handlers/internal-links.ts`, beside the `tier-flow` handler and in its form (same auth, project and run checks, same `404 no_crawl` and `410 links_dropped` answers that handler gives):

```ts
  mock('get', `${P}/internal-links/graph`, ({ request, cookies, params }) => {
    // Copy the checks at the top of the tier-flow handler here: session, project, run, links dropped.
    const url = new URL(request.url);
    const includeAuto = url.searchParams.get('include_auto') === 'true';
    return HttpResponse.json({ data: linkGraphFixture(runId, tierIds, includeAuto) });
  }),
```

`runId` and `tierIds` come from what the tier-flow handler already resolves for its own answer. Run `pnpm vitest run src/mocks/handlers/internal-links.test.ts --maxWorkers=1` and add one case there that the handler answers 200 with 15 nodes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/internal-links/types.ts apps/web/src/lib/internal-links/queries.ts apps/web/src/lib/internal-links/queries.test.ts apps/web/src/mocks
git commit -m "Link map: the graph query, its types and mock data"
```

---

### Task 2: The graph model

**Files:**
- Create: `apps/web/src/lib/internal-links/map-graph.ts`
- Test: `apps/web/src/lib/internal-links/map-graph.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { colourGroups, nameOf, sectionOf, summarise, toMapGraph } from './map-graph';
import type { LinkGraph, PageTier } from './types';

const tiers = [
  { tier_id: 't1', position: 1, code: 'T1', name: 'Money pages' },
  { tier_id: 't2', position: 2, code: 'T2', name: 'Supporting pages' },
] as unknown as PageTier[];

const api = {
  run_id: 'r',
  include_auto: false,
  pages_total: 5,
  truncated: false,
  home_url_id: '1',
  nodes: [
    { url_id: '1', path: '/', title: 'Home', tier_id: 't1', links_in: 0, links_out: 2, sitewide_from: 4 },
    { url_id: '2', path: '/blog', title: 'Blog', tier_id: 't2', links_in: 1, links_out: 1, sitewide_from: 0 },
    { url_id: '3', path: '/blog/post-a', title: null, tier_id: null, links_in: 2, links_out: 0, sitewide_from: 0 },
    { url_id: '4', path: '/about', title: 'About', tier_id: 'gone', links_in: 0, links_out: 0, sitewide_from: 0 },
    { url_id: '5', path: '/blog/post-b/', title: 'B', tier_id: null, links_in: 0, links_out: 0, sitewide_from: 0 },
  ],
  edges: [
    { source: '1', target: '2', links: 1 },
    { source: '1', target: '3', links: 2 },
    { source: '2', target: '3', links: 1 },
    { source: '2', target: '99', links: 1 },
  ],
} as LinkGraph;

describe('nameOf and sectionOf', () => {
  it('names a page by the last part of its address', () => {
    expect(nameOf('/')).toBe('');
    expect(nameOf('/blog/post-a')).toBe('post-a');
    expect(nameOf('/blog/post-b/')).toBe('post-b');
    expect(nameOf(`/x/${'a'.repeat(40)}`)).toBe(`${'a'.repeat(29)}...`);
  });

  it('puts a page in its first folder', () => {
    expect(sectionOf('/')).toBe('home');
    expect(sectionOf('/about')).toBe('top');
    expect(sectionOf('/blog/post-a')).toBe('/blog');
  });
});

describe('toMapGraph', () => {
  it('keeps the pages, drops an edge with an end that is not on the map, and resolves tiers', () => {
    const graph = toMapGraph(api, tiers);

    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(['1>2', '1>3', '2>3']);
    expect(graph.byId.get('1')?.tierPosition).toBe(1);
    // A tier the workspace no longer has reads as untiered
    expect(graph.byId.get('4')?.tierPosition).toBeNull();
    expect(graph.byId.get('3')?.title).toBe('');
    expect(graph.homeId).toBe('1');
  });
});

describe('summarise', () => {
  it('counts the pages, the links, the largest group and the pages with no link', () => {
    expect(summarise(toMapGraph(api, tiers))).toEqual({ pages: 5, links: 3, largest: 3, unlinked: 2 });
  });
});

describe('colourGroups', () => {
  it('groups by tier in tier order, untiered last, and leaves out empty groups', () => {
    const groups = colourGroups(toMapGraph(api, tiers), 'tier', tiers);

    expect(groups.list.map((group) => [group.key, group.count])).toEqual([['t1', 1], ['t2', 1], ['', 3]]);
    expect(groups.keyOf(toMapGraph(api, tiers).byId.get('4')!)).toBe('');
  });

  it('groups by section, the largest first, and folds the rest into other after six', () => {
    const groups = colourGroups(toMapGraph(api, tiers), 'section', tiers);

    // `/blog` and `/about` have no folder (top); the two posts are in `/blog`. Most pages first, then by key.
    expect(groups.list.map((group) => [group.key, group.count])).toEqual([['/blog', 2], ['top', 2], ['home', 1]]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run src/lib/internal-links/map-graph.test.ts --maxWorkers=1`
Expected: FAIL, cannot resolve `./map-graph`.

- [ ] **Step 3: Write the implementation**

```ts
import type { LinkGraph, PageTier } from './types';

/**
 * The Link map's view model (plan 11): the API's graph with what the screen needs worked out once. A node is a live
 * page under its canonical address; an edge is one page linking to another in the body. The API has already folded
 * redirects and variants and left menu and footer links out of the edges.
 */
export interface MapNode {
  id: string;
  path: string;
  /** The page's title, empty when it has none. */
  title: string;
  /** The page's tier, or null when untiered or when the workspace no longer has that tier. */
  tierId: string | null;
  tierPosition: number | null;
  linksIn: number;
  linksOut: number;
  /** Pages that link to it from a menu or footer; 0 unless that is at least half of the pages. */
  sitewideFrom: number;
  /** The last part of the address; empty for the home page (the screen says "Home page"). */
  name: string;
  /** `home`, `top` (a page with no folder) or the first folder with its slash. */
  section: string;
}

export interface MapEdge {
  from: string;
  to: string;
  links: number;
}

export interface MapGraph {
  nodes: readonly MapNode[];
  edges: readonly MapEdge[];
  byId: ReadonlyMap<string, MapNode>;
  pagesTotal: number;
  truncated: boolean;
  homeId: string | null;
}

const NAME_MAX = 30;

const parts = (path: string): string[] => path.split('/').filter(Boolean);

export function nameOf(path: string): string {
  const last = parts(path).at(-1) ?? '';
  return last.length > NAME_MAX ? `${last.slice(0, NAME_MAX - 1)}...` : last;
}

export function sectionOf(path: string): string {
  const list = parts(path);
  if (list.length === 0) return 'home';
  return list.length === 1 ? 'top' : `/${list[0]}`;
}

export function toMapGraph(api: LinkGraph, tiers: readonly PageTier[]): MapGraph {
  const positions = new Map(tiers.map((tier) => [tier.tier_id, tier.position]));
  const nodes = api.nodes.map((node): MapNode => {
    const tierPosition = node.tier_id === null ? null : (positions.get(node.tier_id) ?? null);
    return {
      id: node.url_id,
      path: node.path,
      title: node.title ?? '',
      tierId: tierPosition === null ? null : node.tier_id,
      tierPosition,
      linksIn: node.links_in,
      linksOut: node.links_out,
      sitewideFrom: node.sitewide_from,
      name: nameOf(node.path),
      section: sectionOf(node.path),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    nodes,
    byId,
    // An edge to a page the cap left out is not drawn
    edges: api.edges
      .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
      .map((edge) => ({ from: edge.source, to: edge.target, links: edge.links })),
    pagesTotal: api.pages_total,
    truncated: api.truncated,
    homeId: api.home_url_id !== null && byId.has(api.home_url_id) ? api.home_url_id : null,
  };
}

export interface MapSummary {
  pages: number;
  links: number;
  /** The most pages that hang together by the links drawn. */
  largest: number;
  /** Pages with no drawn link in or out among the pages on the map. */
  unlinked: number;
}

export function summarise(graph: MapGraph): MapSummary {
  const next = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    next.get(edge.from)?.push(edge.to);
    next.get(edge.to)?.push(edge.from);
  }
  const seen = new Set<string>();
  let largest = 0;
  let unlinked = 0;
  for (const node of graph.nodes) {
    const around = next.get(node.id) ?? [];
    if (around.length === 0) {
      unlinked += 1;
      continue;
    }
    if (seen.has(node.id)) continue;
    let size = 0;
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      size += 1;
      for (const other of next.get(id) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return { pages: graph.nodes.length, links: graph.edges.length, largest, unlinked };
}

/** What a dot is filled with: a slot of the chart palette, the "other" grey, a named token, or hollow. */
export type MapColour =
  | { kind: 'palette'; index: number; outline?: false }
  | { kind: 'other' }
  | { kind: 'named'; name: string; outline: true }
  | { kind: 'hollow' };

export type MapColourMode = 'tier' | 'section';

export interface MapColourGroup {
  /** A tier id, `''` for untiered, a section, or `other`. */
  key: string;
  /** Tier mode: the tier, or null for untiered. Section mode: null. */
  tier: PageTier | null;
  /** Section mode: the section; tier mode: null. */
  section: string | null;
  colour: MapColour;
  count: number;
}

/** One hue per tier (W5): a dot is too small for the badge scale's shades of one blue. */
const TIER_COLOUR: readonly MapColour[] = [
  { kind: 'palette', index: 0 },
  { kind: 'palette', index: 1 },
  { kind: 'other' },
  { kind: 'named', name: 'chart-bar-neutral', outline: true },
  { kind: 'palette', index: 2 },
  { kind: 'palette', index: 3 },
  { kind: 'palette', index: 4 },
  { kind: 'palette', index: 5 },
];
const SECTION_SLOTS = 6;

export function colourGroups(
  graph: MapGraph,
  mode: MapColourMode,
  tiers: readonly PageTier[],
): { keyOf: (node: MapNode) => string; list: MapColourGroup[] } {
  if (mode === 'tier') {
    const keyOf = (node: MapNode): string => node.tierId ?? '';
    const list: MapColourGroup[] = [...tiers]
      .sort((a, b) => a.position - b.position)
      .map((tier) => ({ key: tier.tier_id, tier, section: null, colour: TIER_COLOUR[tier.position - 1] ?? { kind: 'other' }, count: 0 }));
    list.push({ key: '', tier: null, section: null, colour: { kind: 'hollow' }, count: 0 });
    const byKey = new Map(list.map((group) => [group.key, group]));
    for (const node of graph.nodes) {
      const group = byKey.get(keyOf(node));
      if (group !== undefined) group.count += 1;
    }
    return { keyOf, list: list.filter((group) => group.count > 0) };
  }
  const counts = new Map<string, number>();
  for (const node of graph.nodes) counts.set(node.section, (counts.get(node.section) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, SECTION_SLOTS);
  const named = new Set(top.map(([section]) => section));
  const keyOf = (node: MapNode): string => (named.has(node.section) ? node.section : 'other');
  const list: MapColourGroup[] = top.map(([section, count], index) => ({
    key: section,
    tier: null,
    section,
    colour: { kind: 'palette', index },
    count,
  }));
  const rest = graph.nodes.length - top.reduce((sum, [, count]) => sum + count, 0);
  if (rest > 0) list.push({ key: 'other', tier: null, section: null, colour: { kind: 'other' }, count: rest });
  return { keyOf, list };
}
```

- [ ] **Step 4: Run to see them pass**

Run: `pnpm vitest run src/lib/internal-links/map-graph.test.ts --maxWorkers=1`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/internal-links/map-graph.ts apps/web/src/lib/internal-links/map-graph.test.ts
git commit -m "Link map: the graph model, colour groups and summary"
```

- [ ] **Step 6: Independent review (Sonnet)** of tasks 1 and 2.

---

### Task 3: The layout

**Files:**
- Create: `apps/web/src/lib/internal-links/map-layout.ts`
- Test: `apps/web/src/lib/internal-links/map-layout.test.ts`

This is a port of `layoutGraph` in `apps/web/design-preview/il-map-layout.js`. The numbers below are the mock's, tuned by eye on the real Eventus crawl. Do not change them without looking at the result.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { layoutMap, roundsFor, type LayoutInput } from './map-layout';

/** A hub with `leaves` pages around it, two pages that link to each other, and `loose` pages with no link. */
function input(leaves: number, loose: number, below = false): LayoutInput {
  const nodes = [
    { id: 'hub', links: leaves, group: 1 },
    ...Array.from({ length: leaves }, (_, i) => ({ id: `leaf-${String(i).padStart(3, '0')}`, links: 1, group: 2 })),
    { id: 'pair-a', links: 1, group: 2 },
    { id: 'pair-b', links: 1, group: 2 },
    ...Array.from({ length: loose }, (_, i) => ({ id: `loose-${String(i).padStart(3, '0')}`, links: 0, group: (i % 2) + 1 })),
  ];
  const edges = [
    ...Array.from({ length: leaves }, (_, i) => ({ from: 'hub', to: `leaf-${String(i).padStart(3, '0')}` })),
    { from: 'pair-a', to: 'pair-b' },
  ];
  return { nodes, edges, below };
}

const distance = (a: readonly [string, number, number], b: readonly [string, number, number]): number =>
  Math.hypot(a[1] - b[1], a[2] - b[2]);

describe('layoutMap', () => {
  it('places every page once, at a finite spot', () => {
    const { positions } = layoutMap(input(12, 9));

    expect(positions).toHaveLength(12 + 1 + 2 + 9);
    expect(new Set(positions.map(([id]) => id)).size).toBe(positions.length);
    expect(positions.every(([, x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('is the same on every run', () => {
    expect(layoutMap(input(12, 9))).toEqual(layoutMap(input(12, 9)));
  });

  it('keeps linked pages apart', () => {
    const linked = layoutMap(input(20, 0)).positions;

    for (let a = 0; a < linked.length; a += 1) {
      for (let b = a + 1; b < linked.length; b += 1) {
        expect(distance(linked[a]!, linked[b]!)).toBeGreaterThanOrEqual(25.9);
      }
    }
  });

  it('puts the unlinked pages in a block to the right, one grid per group in order', () => {
    const { positions, groups } = layoutMap(input(12, 9));
    const linkedRight = Math.max(...positions.filter(([id]) => !id.startsWith('loose')).map(([, x]) => x));
    const loose = positions.filter(([id]) => id.startsWith('loose'));

    expect(loose.every(([, x]) => x > linkedRight + 200)).toBe(true);
    expect(groups.map((group) => [group.key, group.count])).toEqual([[1, 5], [2, 4]]);
    expect(groups[1]!.y).toBeGreaterThan(groups[0]!.y);
  });

  it('puts the block under the map on a tall canvas', () => {
    const { positions } = layoutMap(input(12, 9, true));
    const linkedBottom = Math.max(...positions.filter(([id]) => !id.startsWith('loose')).map(([, , y]) => y));

    expect(positions.filter(([id]) => id.startsWith('loose')).every(([, , y]) => y > linkedBottom)).toBe(true);
  });

  it('lays out a crawl with no links at all', () => {
    const { positions, groups } = layoutMap({ nodes: [{ id: 'a', links: 0, group: 1 }], edges: [], below: false });

    expect(positions).toEqual([['a', expect.any(Number), expect.any(Number)]]);
    expect(groups).toHaveLength(1);
  });
});

describe('roundsFor', () => {
  it('spends fewer rounds on a bigger map', () => {
    expect(roundsFor(150)).toEqual({ force: 400, separation: 80 });
    expect(roundsFor(300)).toEqual({ force: 400, separation: 80 });
    expect(roundsFor(1000)).toEqual({ force: 120, separation: 30 });
    expect(roundsFor(3000)).toEqual({ force: 120, separation: 30 });
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm vitest run src/lib/internal-links/map-layout.test.ts --maxWorkers=1`
Expected: FAIL, cannot resolve `./map-layout`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Where every page of the Link map goes (plan 11, W2 and W10). Pure, and the same on every run for the same
 * input: no random start. Linked pages are placed by their links (linked pages pull together, all pages push
 * apart, more so around a page with many links), then moved apart until no two overlap. Pages with no drawn link
 * stand in a block of their own, one grid per group: to the right, or below on a canvas taller than wide.
 *
 * It runs in a Web Worker (`map-layout.worker.ts`), so its input and output are plain data.
 */
export interface LayoutNode {
  id: string;
  /** Links in plus links out among the pages on the map. */
  links: number;
  /** The order of the group the page belongs to (its tier position, 99 for untiered). */
  group: number;
}

export interface LayoutInput {
  nodes: readonly LayoutNode[];
  edges: readonly { from: string; to: string }[];
  /** The block of unlinked pages goes under the map. */
  below: boolean;
}

export interface MapLayout {
  /** `[id, x, y]` for every node. */
  positions: [string, number, number][];
  /** The grids of the block: where each group's line of text goes and how many pages it holds. */
  groups: { key: number; count: number; x: number; y: number }[];
}

// A page pushes others away in proportion to its links, so a hub keeps room for the pages around it
const REPULSION = 6.5;
const ATTRACTION = 0.05;
// Strong enough to keep groups that do not link to each other in one picture, not far apart
const GRAVITY = 0.03;
// No two pages closer than this, plus room for the bigger dot of a page with many links
const SPACE = 26;
// A wide canvas gets a wide map: names read left to right, so the room is worth more sideways
const STRETCH = 1.45;
const CELL = 18;
const COLUMNS = 14;
const GROUP_GAP = 44;
// Beside the map the block stands clear of the names, which run to the right of their dots; below it needs less
const BLOCK_GAP_SIDE = 250;
const BLOCK_GAP_BELOW = 90;

/**
 * Rounds by size. Measured at 400 force rounds: 160 linked pages 0.3 s, 500 pages 1.7 s, 1,000 pages 3.5 s,
 * 2,000 pages 11 s. A big map is already spread by its hubs after fewer rounds, and the reader waits less.
 */
export function roundsFor(linked: number): { force: number; separation: number } {
  if (linked <= 300) return { force: 400, separation: 80 };
  return { force: Math.max(120, Math.round(120_000 / linked)), separation: 30 };
}

export function layoutMap({ nodes, edges, below }: LayoutInput): MapLayout {
  const linked = nodes.filter((node) => node.links > 0).sort((a, b) => a.id.localeCompare(b.id));
  const count = linked.length;
  const index = new Map(linked.map((node, i) => [node.id, i]));
  const weight = linked.map((node) => node.links + 1);
  // A sunflower spiral: every page starts apart from the others, in the same place on every run
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    x[i] = 30 * Math.sqrt(i + 1) * Math.cos(i * 2.399963);
    y[i] = 30 * Math.sqrt(i + 1) * Math.sin(i * 2.399963);
  }
  const pairs: [number, number][] = [];
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a !== undefined && b !== undefined && a !== b) pairs.push([a, b]);
  }
  const rounds = roundsFor(count);
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);

  for (let step = 0; step < rounds.force; step += 1) {
    dx.fill(0);
    dy.fill(0);
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        const ox = x[a]! - x[b]!;
        const oy = y[a]! - y[b]!;
        const length = Math.max(0.01, Math.hypot(ox, oy));
        const push = (REPULSION * weight[a]! * weight[b]!) / length / length;
        dx[a]! += ox * push;
        dy[a]! += oy * push;
        dx[b]! -= ox * push;
        dy[b]! -= oy * push;
      }
      dx[a]! -= x[a]! * GRAVITY * weight[a]!;
      dy[a]! -= y[a]! * GRAVITY * weight[a]!;
    }
    for (const [a, b] of pairs) {
      const ox = (x[a]! - x[b]!) * ATTRACTION;
      const oy = (y[a]! - y[b]!) * ATTRACTION;
      dx[a]! -= ox;
      dy[a]! -= oy;
      dx[b]! += ox;
      dy[b]! += oy;
    }
    // The step a page may move shrinks every round, so the picture settles
    const limit = 40 * (1 - step / rounds.force) + 0.3;
    for (let a = 0; a < count; a += 1) {
      const length = Math.max(0.01, Math.hypot(dx[a]!, dy[a]!));
      const move = Math.min(limit, length);
      x[a]! += (dx[a]! / length) * move;
      y[a]! += (dy[a]! / length) * move;
    }
  }
  if (!below) for (let i = 0; i < count; i += 1) x[i]! *= STRETCH;
  for (let round = 0; round < rounds.separation; round += 1) {
    for (let a = 0; a < count; a += 1) {
      for (let b = a + 1; b < count; b += 1) {
        const need = SPACE + 1.6 * (Math.sqrt(weight[a]!) + Math.sqrt(weight[b]!));
        let ox = x[a]! - x[b]!;
        let oy = y[a]! - y[b]!;
        let length = Math.hypot(ox, oy);
        if (length >= need) continue;
        if (length < 0.01) {
          // Two pages on one spot part in a direction their order gives, never a random one
          ox = Math.cos(a + b);
          oy = Math.sin(a + b);
          length = 1;
        }
        const shift = (need - length) / 2 / length;
        x[a]! += ox * shift;
        y[a]! += oy * shift;
        x[b]! -= ox * shift;
        y[b]! -= oy * shift;
      }
    }
  }

  const positions: [string, number, number][] = linked.map((node, i) => [node.id, x[i]!, y[i]!]);
  const edgeOf = (pick: (...values: number[]) => number, list: Float64Array): number => (count > 0 ? pick(...list) : 0);
  const left = below ? edgeOf(Math.min, x) : edgeOf(Math.max, x) + BLOCK_GAP_SIDE;
  const top = below ? edgeOf(Math.max, y) + BLOCK_GAP_BELOW : edgeOf(Math.min, y);
  const columns = below ? Math.max(COLUMNS, Math.floor((edgeOf(Math.max, x) - edgeOf(Math.min, x)) / CELL)) : COLUMNS;
  const byGroup = new Map<number, string[]>();
  for (const node of nodes.filter((candidate) => candidate.links === 0).sort((a, b) => a.id.localeCompare(b.id))) {
    const list = byGroup.get(node.group) ?? [];
    list.push(node.id);
    byGroup.set(node.group, list);
  }
  const groups: MapLayout['groups'] = [];
  let rowTop = top;
  for (const [key, ids] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
    groups.push({ key, count: ids.length, x: left, y: rowTop });
    ids.forEach((id, i) => {
      positions.push([id, left + (i % columns) * CELL, rowTop + CELL * 1.5 + Math.floor(i / columns) * CELL]);
    });
    rowTop += CELL * 1.5 + Math.ceil(ids.length / columns) * CELL + GROUP_GAP;
  }
  return { positions, groups };
}
```

The `!` after the typed array reads are what `noUncheckedIndexedAccess` asks for; if the project's config does not need them, drop them all.

- [ ] **Step 4: Run to see them pass**

Run: `pnpm vitest run src/lib/internal-links/map-layout.test.ts --maxWorkers=1`
Expected: all pass, in well under a second.

- [ ] **Step 5: Measure, once.** In a scratch test (do not commit it), build a synthetic input of 1,000 and of 3,000 linked pages (one hub per 14 pages, 2.5 links a page) and time `layoutMap`. Write both numbers under "Built, with notes". Expected with the rounds above: about 1 s and about 7 s on this Mac. If 3,000 pages takes over 12 s, lower the floor in `roundsFor` from 120 to 80 and say so in the notes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/internal-links/map-layout.ts apps/web/src/lib/internal-links/map-layout.test.ts
git commit -m "Link map: a deterministic layout, linked pages by their links and the rest in a block"
```

---

### Task 4: The layout off the main thread

**Files:**
- Create: `apps/web/src/lib/internal-links/map-layout.worker.ts`
- Create: `apps/web/src/features/internal-links/map/use-map-layout.ts`
- Test: `apps/web/src/features/internal-links/map/use-map-layout.test.tsx`

Before writing: read the Web Worker guide in `apps/web/node_modules/next/dist/docs/` for this Next.js version and use the worker form it gives. The content security policy already allows `worker-src 'self' blob:` (`src/lib/security/csp.ts`).

- [ ] **Step 1: Write the failing test**

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useMapLayout } from './use-map-layout';
import { layoutMap, type LayoutInput } from '@/lib/internal-links/map-layout';

const input: LayoutInput = {
  nodes: [
    { id: 'a', links: 1, group: 1 },
    { id: 'b', links: 1, group: 1 },
    { id: 'c', links: 0, group: 2 },
  ],
  edges: [{ from: 'a', to: 'b' }],
  below: false,
};

describe('useMapLayout', () => {
  it('has no layout for no input', () => {
    const { result } = renderHook(() => useMapLayout(null));

    expect(result.current).toEqual({ layout: null, pending: false });
  });

  it('gives the layout of its input, here without a worker (the test environment has none)', async () => {
    const { result } = renderHook(() => useMapLayout(input));

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.layout).toEqual(layoutMap(input));
  });

  it('drops the old layout while a new input is laid out', async () => {
    const { result, rerender } = renderHook(({ value }) => useMapLayout(value), { initialProps: { value: input } });
    await waitFor(() => expect(result.current.pending).toBe(false));

    rerender({ value: { ...input, below: true } });

    await waitFor(() => expect(result.current.layout).toEqual(layoutMap({ ...input, below: true })));
  });
});
```

Run: `pnpm vitest run src/features/internal-links/map/use-map-layout.test.tsx --maxWorkers=1`. Expected: FAIL, cannot resolve `./use-map-layout`.

- [ ] **Step 2: Write the worker**

```ts
import { layoutMap, type LayoutInput } from './map-layout';

/** Lays the Link map out off the main thread: one message in, one answer out. */
self.addEventListener('message', (event: MessageEvent<LayoutInput>) => {
  self.postMessage(layoutMap(event.data));
});
```

- [ ] **Step 3: Write the hook**

```ts
'use client';

import { useEffect, useState } from 'react';

import { layoutMap, type LayoutInput, type MapLayout } from '@/lib/internal-links/map-layout';

interface LayoutState {
  /** The input the layout below belongs to: a layout of another input is never shown. */
  of: LayoutInput | null;
  layout: MapLayout | null;
}

/**
 * The layout of the Link map for `input` (memoise the input: a new object is a new layout). The work runs in a
 * Web Worker, so a big map does not freeze the page; where there is no worker (a test, an old browser) it runs
 * here. `pending` is true from a new input until its layout arrives.
 */
export function useMapLayout(input: LayoutInput | null): { layout: MapLayout | null; pending: boolean } {
  const [state, setState] = useState<LayoutState>({ of: null, layout: null });

  useEffect(() => {
    if (input === null) return undefined;
    if (typeof Worker === 'undefined') {
      setState({ of: input, layout: layoutMap(input) });
      return undefined;
    }
    const worker = new Worker(new URL('../../../lib/internal-links/map-layout.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<MapLayout>) => {
      setState({ of: input, layout: event.data });
    });
    // A worker that cannot start (a blocked script) must not leave the map waiting for ever
    worker.addEventListener('error', () => setState({ of: input, layout: layoutMap(input) }));
    worker.postMessage(input);
    return () => worker.terminate();
  }, [input]);

  if (input === null) return { layout: null, pending: false };
  return state.of === input ? { layout: state.layout, pending: false } : { layout: null, pending: true };
}
```

If the project's lint rules refuse a `setState` in an effect body for the no-worker branch, compute that branch with `useMemo` instead and keep the effect for the worker only.

- [ ] **Step 4: Run to see it pass, then commit**

Run: `pnpm vitest run src/features/internal-links/map/use-map-layout.test.tsx --maxWorkers=1`
Expected: 3 passed.

```bash
git add apps/web/src/lib/internal-links/map-layout.worker.ts apps/web/src/features/internal-links/map/use-map-layout.ts apps/web/src/features/internal-links/map/use-map-layout.test.tsx
git commit -m "Link map: the layout runs in a Web Worker"
```

- [ ] **Step 5: Independent review (Sonnet)** of tasks 3 and 4, with the mock's `il-map-layout.js` beside the port.

---

### Task 5: The focus

**Files:**
- Create: `apps/web/src/lib/internal-links/map-focus.ts`
- Test: `apps/web/src/lib/internal-links/map-focus.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { focusOf, parseLens } from './map-focus';
import { toMapGraph } from './map-graph';
import type { LinkGraph } from './types';

const node = (url_id: string, path: string, links_in: number, links_out: number, sitewide_from = 0, title = '') => ({
  url_id, path, title, tier_id: null, links_in, links_out, sitewide_from,
});
const graph = toMapGraph(
  {
    run_id: 'r', include_auto: false, pages_total: 5, truncated: false, home_url_id: '1',
    nodes: [
      node('1', '/', 0, 2, 4, 'Managed SOC provider'),
      node('2', '/blog', 1, 1),
      node('3', '/blog/soc-post', 2, 0),
      node('4', '/about', 0, 0),
      node('5', '/contact', 0, 0, 4),
    ],
    edges: [{ source: '1', target: '2', links: 1 }, { source: '1', target: '3', links: 1 }, { source: '2', target: '3', links: 1 }],
  } as LinkGraph,
  [],
);
const none = { selected: null, query: '', lens: 'none' as const };

describe('focusOf', () => {
  it('lights everything when nothing narrows the map', () => {
    expect(focusOf(graph, none)).toMatchObject({ selected: null, lit: null, searching: false });
  });

  it('lights the selected page with the pages that link to it and the pages it links to', () => {
    const focus = focusOf(graph, { ...none, selected: '2', query: 'ignored while a page is selected' });

    expect(focus.selected).toBe('2');
    expect([...focus.sources]).toEqual(['1']);
    expect([...focus.targets]).toEqual(['3']);
    expect([...(focus.lit ?? [])].sort()).toEqual(['1', '2', '3']);
    expect(focus.searching).toBe(false);
  });

  it('ignores a selected page that is not on the map', () => {
    expect(focusOf(graph, { ...none, selected: '99' }).lit).toBeNull();
  });

  it('lights the pages whose address or title contains the search, whatever the case', () => {
    const focus = focusOf(graph, { ...none, query: ' SOC ' });

    expect([...(focus.lit ?? [])].sort()).toEqual(['1', '3']);
    expect(focus.searching).toBe(true);
  });

  it('lights the pages of a highlight, and both rules together', () => {
    expect([...(focusOf(graph, { ...none, lens: 'noIn' }).lit ?? [])].sort()).toEqual(['1', '4', '5']);
    expect([...(focusOf(graph, { ...none, lens: 'deadEnd' }).lit ?? [])]).toEqual(['3']);
    expect([...(focusOf(graph, { ...none, lens: 'sitewide' }).lit ?? [])].sort()).toEqual(['1', '5']);
    expect([...(focusOf(graph, { ...none, lens: 'sitewide', query: 'contact' }).lit ?? [])]).toEqual(['5']);
  });
});

describe('parseLens', () => {
  it('reads a known highlight and nothing else', () => {
    expect(parseLens('deadEnd')).toBe('deadEnd');
    expect(parseLens('other')).toBe('none');
    expect(parseLens(null)).toBe('none');
  });
});
```

Run: `pnpm vitest run src/lib/internal-links/map-focus.test.ts --maxWorkers=1`. Expected: FAIL, cannot resolve `./map-focus`.

- [ ] **Step 2: Write the implementation**

```ts
import type { MapGraph, MapNode } from './map-graph';

/** A highlight of the Link map: pages nothing links to, pages that link nowhere on, pages in the menu or footer. */
export type MapLens = 'none' | 'noIn' | 'deadEnd' | 'sitewide';

export const MAP_LENSES: readonly MapLens[] = ['none', 'noIn', 'deadEnd', 'sitewide'];

const LENS_TEST: Readonly<Record<MapLens, (node: MapNode) => boolean>> = {
  none: () => true,
  noIn: (node) => node.linksIn === 0,
  deadEnd: (node) => node.linksIn > 0 && node.linksOut === 0,
  sitewide: (node) => node.sitewideFrom > 0,
};

export const parseLens = (value: string | null | undefined): MapLens =>
  MAP_LENSES.find((lens) => lens === value) ?? 'none';

export interface MapFocus {
  /** The page clicked, when it is on the map. */
  selected: string | null;
  /** Pages that link to the selected page, and pages it links to. Empty when no page is selected. */
  sources: ReadonlySet<string>;
  targets: ReadonlySet<string>;
  /** The pages in the light; null when nothing narrows the map. */
  lit: ReadonlySet<string> | null;
  /** The light is a search: the count of its pages is shown beside the box. */
  searching: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();

/**
 * What is lit (plan 11, W6 and W7). A selected page wins: it and the pages it links with. Otherwise the pages
 * that pass the highlight and contain the search text in their address or title.
 */
export function focusOf(
  graph: MapGraph,
  { selected, query, lens }: { selected: string | null; query: string; lens: MapLens },
): MapFocus {
  if (selected !== null && graph.byId.has(selected)) {
    const sources = new Set(graph.edges.filter((edge) => edge.to === selected).map((edge) => edge.from));
    const targets = new Set(graph.edges.filter((edge) => edge.from === selected).map((edge) => edge.to));
    return { selected, sources, targets, lit: new Set([selected, ...sources, ...targets]), searching: false };
  }
  const text = query.trim().toLowerCase();
  if (text === '' && lens === 'none') return { selected: null, sources: EMPTY, targets: EMPTY, lit: null, searching: false };
  const passes = LENS_TEST[lens];
  const lit = new Set(
    graph.nodes
      .filter((node) => passes(node) && (text === '' || node.path.toLowerCase().includes(text) || node.title.toLowerCase().includes(text)))
      .map((node) => node.id),
  );
  return { selected: null, sources: EMPTY, targets: EMPTY, lit, searching: text !== '' };
}
```

- [ ] **Step 3: Run to see them pass, then commit**

Run: `pnpm vitest run src/lib/internal-links/map-focus.test.ts --maxWorkers=1`
Expected: all pass.

```bash
git add apps/web/src/lib/internal-links/map-focus.ts apps/web/src/lib/internal-links/map-focus.test.ts
git commit -m "Link map: what is lit by a selection, a search and a highlight"
```

---

### Task 6: The ECharts option

**Files:**
- Create: `apps/web/src/lib/internal-links/map-option.ts`
- Test: `apps/web/src/lib/internal-links/map-option.test.ts`

This is `option()` of the mock's `il-map.js`, as a pure function. Every number in it is the mock's.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import { focusOf } from './map-focus';
import { colourGroups, toMapGraph } from './map-graph';
import { layoutMap } from './map-layout';
import { fitBox, HEADER_PREFIX, mapOption, type MapOptionInput } from './map-option';
import type { LinkGraph, PageTier } from './types';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tiers = [{ tier_id: 't1', position: 1, code: 'T1', name: 'Money pages' }] as unknown as PageTier[];
const node = (url_id: string, path: string, tier_id: string | null, links_in: number, links_out: number) => ({
  url_id, path, title: path, tier_id, links_in, links_out, sitewide_from: 0,
});
const graph = toMapGraph(
  {
    run_id: 'r', include_auto: false, pages_total: 4, truncated: false, home_url_id: '1',
    nodes: [node('1', '/', 't1', 0, 2), node('2', '/a', null, 1, 1), node('3', '/b', null, 2, 0), node('4', '/loose', null, 0, 0)],
    edges: [{ source: '1', target: '2', links: 1 }, { source: '1', target: '3', links: 1 }, { source: '2', target: '3', links: 1 }],
  } as LinkGraph,
  tiers,
);
const layout = layoutMap({
  nodes: graph.nodes.map((item) => ({ id: item.id, links: item.linksIn + item.linksOut, group: item.tierPosition ?? 99 })),
  edges: graph.edges,
  below: false,
});
const tokens = {
  palette: ['#1', '#2', '#3', '#4', '#5', '#6'], other: '#other', border: '#border', borderStrong: '#strong',
  foreground: '#fg', foregroundSecondary: '#fg2', foregroundMuted: '#muted', surfaceElevated: '#surface',
  fontFamily: 'Geist', named: (name: string) => `#${name}`,
} as unknown as ChartTokens;

function input(more: Partial<MapOptionInput> = {}): MapOptionInput {
  return {
    graph, layout, moved: new Map(), focus: focusOf(graph, { selected: null, query: '', lens: 'none' }),
    colour: colourGroups(graph, 'tier', tiers), hidden: new Set(), tokens, width: 1200, height: 700,
    view: { zoom: 1, center: null }, minimap: true, reducedMotion: false,
    words: { home: 'Home page', blockTitle: 'No editorial link in or out', blockLine: (key, pages) => `${key}: ${pages}` },
    tooltip: () => '',
    ...more,
  };
}
type Series = { data: Record<string, any>[]; links: Record<string, any>[]; [key: string]: any };
const seriesOf = (option: Record<string, unknown>): Series => (option.series as Series[])[0]!;
const dot = (option: Record<string, unknown>, id: string): Record<string, any> =>
  seriesOf(option).data.find((item) => item.name === id)!;

describe('fitBox', () => {
  it('keeps the proportions of the map in a canvas of another shape', () => {
    const wide = fitBox({ width: 2, height: 1 }, 1272, 796);
    const tall = fitBox({ width: 2, height: 1 }, 472, 996);

    expect(wide.width / wide.height).toBeCloseTo(2);
    expect(tall.width / tall.height).toBeCloseTo(2);
    // The room is the canvas less 72 px of width and 96 px of height: 1200 by 700, then 400 by 900
    expect([wide.width, wide.height]).toEqual([1200, 600]);
    expect([tall.width, tall.height]).toEqual([400, 200]);
    // Centred in the room left by the margins
    expect(tall.left).toBe(36);
    expect(tall.top).toBeGreaterThan(28);
  });
});

describe('mapOption', () => {
  it('draws every page as a dot at its place, bigger with more links, coloured by its tier', () => {
    const option = mapOption(input());

    expect(seriesOf(option).data.filter((item) => !String(item.name).startsWith(HEADER_PREFIX))).toHaveLength(4);
    expect(dot(option, '1').itemStyle.color).toBe('#1');
    expect(dot(option, '2').itemStyle.color).toBe('#surface');
    expect(dot(option, '2').itemStyle.borderColor).toBe('#strong');
    expect(dot(option, '3').symbolSize).toBeGreaterThan(dot(option, '4').symbolSize);
    expect(dot(option, '1').label.formatter).toBe('Home page');
  });

  it('names the linked pages and leaves the block unnamed until 200 percent', () => {
    expect(dot(mapOption(input()), '2').label.show).toBe(true);
    expect(dot(mapOption(input()), '4').label.show).toBe(false);
    expect(dot(mapOption(input({ view: { zoom: 2, center: null } })), '4').label.show).toBe(true);
  });

  it('dims what is not lit and draws the links of the selected page by direction', () => {
    const option = mapOption(input({ focus: focusOf(graph, { selected: '2', query: '', lens: 'none' }) }));
    const links = seriesOf(option).links;

    expect(dot(option, '4').itemStyle.opacity).toBeLessThan(0.2);
    expect(dot(option, '2').itemStyle.borderWidth).toBeGreaterThan(2);
    // 1 to 2 comes in: dotted. 2 to 3 goes out: solid. 1 to 3 does not touch the page: faint.
    expect(links.find((link) => link.source === '1' && link.target === '2')?.lineStyle.type).toEqual([1, 6]);
    expect(links.find((link) => link.source === '2' && link.target === '3')?.lineStyle.type).toBeUndefined();
    expect(links.find((link) => link.source === '1' && link.target === '3')?.lineStyle.opacity).toBeLessThan(0.1);
    // A selection keeps its light: pointing at another page does not take it over
    expect(seriesOf(option).emphasis.focus).toBe('none');
  });

  it('takes a group off the map with its links and its line in the block', () => {
    const option = mapOption(input({ hidden: new Set(['']) }));

    expect(seriesOf(option).data.map((item) => item.name)).toEqual(['1']);
    expect(seriesOf(option).links).toEqual([]);
  });

  it('puts a dragged page where it was dropped', () => {
    const option = mapOption(input({ moved: new Map([['2', [5, 6] as const]]) }));

    expect([dot(option, '2').x, dot(option, '2').y]).toEqual([5, 6]);
  });

  it('shows the minimap only when zoomed in, and no motion when the reader asked for none', () => {
    expect((mapOption(input()).thumbnail as { show: boolean }).show).toBe(false);
    expect((mapOption(input({ view: { zoom: 2, center: null } })).thumbnail as { show: boolean }).show).toBe(true);
    expect(mapOption(input({ reducedMotion: true })).animation).toBe(false);
  });
});
```

Run: `pnpm vitest run src/lib/internal-links/map-option.test.ts --maxWorkers=1`. Expected: FAIL, cannot resolve `./map-option`.

- [ ] **Step 2: Write the implementation**

```ts
import type { MapFocus } from './map-focus';
import type { MapColour, MapColourGroup, MapGraph, MapNode } from './map-graph';
import type { MapLayout } from './map-layout';
import type { ChartTokens } from '@/lib/design/read-tokens';

/** The zoom and the centre of the map in view; a null centre is the fitted one. */
export interface MapView {
  zoom: number;
  center: readonly [number, number] | null;
}

export const MAP_ZOOM = { min: 0.4, max: 12 } as const;
/** From this zoom the minimap shows: with everything in view it would only repeat the map. */
export const MINIMAP_FROM = 1.05;
/** From this zoom the pages in the block carry names: at the fitted size they stand too close. */
export const BLOCK_NAMES_FROM = 2;
/** The zooms at which the picture changes by itself, so the canvas repaints when a zoom crosses one. */
export const MAP_REPAINT_AT: readonly number[] = [MINIMAP_FROM, BLOCK_NAMES_FROM];
/** Names of the nodes that only carry the block's lines of text. */
export const HEADER_PREFIX = 'h:';

// Pixels of canvas per unit of the layout at which a dot has its plain size
const PLAIN_SCALE = 0.8;
// Links into the selected page are green and dotted, links out blue and solid: told apart without colour too
const IN_LINE = { type: [1, 6], cap: 'round', width: 2.75 } as const;

export interface MapOptionInput {
  graph: MapGraph;
  layout: MapLayout;
  /** Pages the reader dragged, by id. */
  moved: ReadonlyMap<string, readonly [number, number]>;
  focus: MapFocus;
  colour: { keyOf: (node: MapNode) => string; list: readonly MapColourGroup[] };
  /** Legend groups switched off. */
  hidden: ReadonlySet<string>;
  tokens: ChartTokens;
  width: number;
  height: number;
  view: MapView;
  minimap: boolean;
  reducedMotion: boolean;
  words: {
    /** The name the home page carries. */
    home: string;
    blockTitle: string;
    /** A line of the block: the group's key (a tier position, 99 for untiered) and its pages on the map. */
    blockLine: (key: number, pages: number) => string;
  };
  /** The tooltip's HTML for a page id, or for an edge by its index in `graph.edges`. Text in it is already escaped. */
  tooltip: (target: { page: string } | { edge: number }) => string;
}

/** The largest box of the map's own proportions in the canvas, centred, with room below for the view controls. */
export function fitBox(
  span: { width: number; height: number },
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const shape = span.width / span.height;
  const room = { width: Math.max(1, width - 72), height: Math.max(1, height - 96) };
  const fitted =
    room.width / room.height > shape
      ? { width: room.height * shape, height: room.height }
      : { width: room.width, height: room.width / shape };
  return { left: 36 + (room.width - fitted.width) / 2, top: 28 + (room.height - fitted.height) / 2, ...fitted };
}

function fill(colour: MapColour, tokens: ChartTokens): { color: string; outline: string | null } {
  switch (colour.kind) {
    case 'palette':
      return { color: tokens.palette[colour.index] ?? tokens.other, outline: null };
    case 'other':
      return { color: tokens.other, outline: null };
    case 'named':
      return { color: tokens.named?.(colour.name) ?? tokens.other, outline: tokens.borderStrong };
    case 'hollow':
      return { color: tokens.surfaceElevated, outline: tokens.borderStrong };
  }
}

export function mapOption(input: MapOptionInput): Record<string, unknown> {
  const { graph, layout, moved, focus, colour, hidden, tokens, view, words } = input;
  const placed = new Map(layout.positions.map(([id, x, y]) => [id, [x, y] as const]));
  const spot = (id: string): readonly [number, number] => moved.get(id) ?? placed.get(id) ?? [0, 0];
  const styleOf = new Map(colour.list.map((group) => [group.key, fill(group.colour, tokens)]));
  const shown = graph.nodes.filter((node) => !hidden.has(colour.keyOf(node)));
  const shownIds = new Set(shown.map((node) => node.id));

  // A line of the block counts the pages of its group that are on the map now, and goes with them when a legend
  // group is off. The header named `room` is empty: it keeps room for the text when the block is a few pages wide.
  const inBlock = new Map<number, number>();
  for (const node of shown) {
    if (node.linksIn + node.linksOut > 0) continue;
    const key = node.tierPosition ?? 99;
    inBlock.set(key, (inBlock.get(key) ?? 0) + 1);
  }
  const lines = layout.groups.filter((group) => inBlock.has(group.key));
  const first = lines[0];
  const headers =
    first === undefined
      ? []
      : [
          { key: 'title', x: first.x, y: first.y - 30, text: words.blockTitle, strong: true },
          { key: 'room', x: first.x + 240, y: first.y, text: '', strong: false },
          ...lines.map((group) => ({
            key: String(group.key),
            x: group.x,
            y: group.y,
            text: words.blockLine(group.key, inBlock.get(group.key) ?? 0),
            strong: false,
          })),
        ];

  const points = [...shown.map((node) => spot(node.id)), ...headers.map((header) => [header.x, header.y] as const)];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const span = {
    width: Math.max(1, Math.max(...xs, 0) - Math.min(...xs, 0)),
    height: Math.max(1, Math.max(...ys, 0) - Math.min(...ys, 0)),
  };
  const box = fitBox(span, input.width, input.height);
  // On a big canvas the pages lie further apart, so the dots and the names grow with it; on a small one they shrink
  const grow = Math.min(1.7, Math.max(0.55, box.width / span.width / PLAIN_SCALE));
  const blockNamed = view.zoom >= BLOCK_NAMES_FROM;

  const data: Record<string, unknown>[] = shown.map((node) => {
    const [x, y] = spot(node.id);
    const style = styleOf.get(colour.keyOf(node)) ?? { color: tokens.other, outline: null };
    const lit = focus.lit === null || focus.lit.has(node.id);
    const selected = focus.selected === node.id;
    const links = node.linksIn + node.linksOut;
    return {
      name: node.id,
      x,
      y,
      // Bigger with more links, in or out, so the page a group gathers around stands out
      symbolSize: (7 + 2.6 * Math.sqrt(links)) * grow * (selected ? 1.3 : 1),
      z: selected ? 5 : lit && focus.lit !== null ? 4 : 2,
      itemStyle: {
        color: style.color,
        opacity: lit ? 1 : 0.13,
        borderColor: selected ? tokens.foreground : (style.outline ?? tokens.surfaceElevated),
        borderWidth: selected ? 2.5 : 1,
      },
      label: {
        // In the block the dots stand too close for names: they come with a zoom, a search or a selection
        show: lit && (links > 0 || focus.lit !== null || blockNamed),
        formatter: node.name === '' ? words.home : node.name,
        color: selected || focus.lit !== null ? tokens.foreground : tokens.foregroundSecondary,
        fontWeight: selected ? 600 : 400,
      },
    };
  });
  for (const header of headers) {
    data.push({
      name: `${HEADER_PREFIX}${header.key}`,
      x: header.x - 5,
      y: header.y,
      symbolSize: 0.01,
      draggable: false,
      cursor: 'default',
      tooltip: { show: false },
      emphasis: { disabled: true },
      label: {
        show: true,
        formatter: header.text,
        color: header.strong ? tokens.foreground : tokens.foregroundSecondary,
        fontWeight: header.strong ? 600 : 400,
      },
    });
  }

  const line = tokens.foregroundMuted;
  const faint = { color: line, opacity: 0.05, width: 1 };
  const links = graph.edges.flatMap((edge, index) => {
    if (!shownIds.has(edge.from) || !shownIds.has(edge.to)) return [];
    let lineStyle: Record<string, unknown> = { color: line, opacity: 0.32, width: 1 };
    if (focus.selected !== null) {
      if (edge.to === focus.selected) lineStyle = { color: tokens.named?.('chart-positive') ?? tokens.palette[2], opacity: 1, ...IN_LINE };
      else if (edge.from === focus.selected) lineStyle = { color: tokens.palette[0], opacity: 0.95, width: 1.75 };
      else lineStyle = faint;
    } else if (focus.lit !== null && !(focus.lit.has(edge.from) && focus.lit.has(edge.to))) lineStyle = faint;
    return [{ source: edge.from, target: edge.to, edge: index, lineStyle }];
  });
  // Pointing at a page lights its links only while nothing else narrows the map, and never hides the rest
  const adjacency = focus.lit === null;
  return {
    animation: !input.reducedMotion,
    animationDuration: 0,
    animationDurationUpdate: 0,
    stateAnimation: { duration: 140, easing: 'cubicOut' },
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      confine: true,
      showDelay: 120,
      hideDelay: 0,
      transitionDuration: 0,
      backgroundColor: 'transparent',
      borderWidth: 0,
      padding: 0,
      extraCssText: 'box-shadow: none; pointer-events: none;',
      // Above the pointer, so the pages a page links with stay in sight
      position: (point: [number, number], _params: unknown, _dom: unknown, _rect: unknown, size: { contentSize: [number, number] }) => [
        point[0] + 14,
        point[1] - size.contentSize[1] - 12,
      ],
      formatter: (params: { dataType?: string; name?: string; data?: { edge?: number } }) => {
        if (params.dataType === 'edge') return params.data?.edge === undefined ? '' : input.tooltip({ edge: params.data.edge });
        return params.name === undefined || params.name.startsWith(HEADER_PREFIX) ? '' : input.tooltip({ page: params.name });
      },
    },
    thumbnail: {
      show: input.minimap && view.zoom > MINIMAP_FROM,
      width: 176,
      height: 116,
      right: 12,
      bottom: 12,
      itemStyle: { color: tokens.surfaceElevated, borderColor: tokens.border, borderWidth: 1 },
      windowStyle: { color: tokens.palette[0], borderColor: tokens.palette[0], borderWidth: 1, opacity: 0.14 },
    },
    series: [
      {
        type: 'graph',
        layout: 'none',
        roam: true,
        draggable: true,
        zoom: view.zoom,
        ...(view.center === null ? {} : { center: view.center }),
        scaleLimit: MAP_ZOOM,
        // Dots grow slower than the map when zooming in, so a dense group opens up
        nodeScaleRatio: 0.45,
        ...box,
        edgeSymbol: ['none', 'arrow'],
        edgeSymbolSize: 6 * grow,
        // A slight curve keeps a link and its return link apart
        lineStyle: { curveness: 0.14 },
        label: {
          position: 'right',
          distance: 4,
          textBorderColor: tokens.surfaceElevated,
          textBorderWidth: 3,
          fontFamily: tokens.fontFamily,
          fontSize: grow > 1.25 ? 12 : grow < 0.8 ? 10 : 11,
        },
        // Names that would overlap give way to the bigger dot; zooming in makes room for more
        labelLayout: { hideOverlap: true },
        emphasis: {
          focus: adjacency ? 'adjacency' : 'none',
          scale: 1.2,
          label: { show: true, color: tokens.foreground },
          lineStyle: adjacency ? { width: 1.75, opacity: 0.95, color: tokens.palette[0] } : {},
        },
        blur: { itemStyle: { opacity: 0.4 }, lineStyle: { opacity: 0.1 }, label: { opacity: 0.35 } },
        data,
        links,
      },
    ],
  };
}
```

`tokens.named?.('chart-positive')` reads the green of links in; check in `src/lib/design/read-tokens.ts` that `named` resolves `chart-positive`, and if it does not, read it with `readColorToken('--chart-positive')` in the canvas component and pass it in as a field of `words`' sibling (add `inColour: string` to `MapOptionInput`). The halo behind a name (`textBorderColor`) must be the canvas background, `surface-subtle`: if `ChartTokens` has no field for it, read it the same way and pass it in.

- [ ] **Step 3: Run to see them pass, then commit**

Run: `pnpm vitest run src/lib/internal-links/map-option.test.ts --maxWorkers=1`
Expected: all pass.

```bash
git add apps/web/src/lib/internal-links/map-option.ts apps/web/src/lib/internal-links/map-option.test.ts
git commit -m "Link map: the picture as an ECharts option"
```

- [ ] **Step 4: Independent review (Sonnet)** of tasks 5 and 6, with the mock's `il-map.js` (`focusOf`, `option`) beside them.

---

### Task 7: The canvas component

**Files:**
- Create: `apps/web/src/components/app/link-map/link-map-chart.tsx`
- Test: `apps/web/src/components/app/link-map/link-map-chart.test.tsx`

The component owns the ECharts instance and three pointer rules the mock settled:

1. **A drag is not a click.** A press and a release more than 4 px apart never selects.
2. **A dragged page is saved on release anywhere on the canvas**, because a fast drag is released beside the dot.
3. **A repaint keeps the tooltip.** `setOption(option, { replaceMerge: ['series'] })`, never `notMerge`: a repaint under the pointer with `notMerge` throws in ECharts when a delayed tooltip then shows.

- [ ] **Step 1: Write the failing tests.** Mock `echarts/core`, `echarts/charts`, `echarts/components` and `echarts/renderers` the way `src/components/app/chart/echart.test.tsx` does, with a fake instance that records `setOption` calls and lets the test fire `on` and `getZr().on` handlers. Cases, each a separate `it`:

```tsx
it('paints the option the builder gives for its size and view', ...);          // build called with { tokens, width, height, view: { zoom: 1, center: null } }; setOption called with replaceMerge ['series']
it('repaints when the builder changes', ...);                                   // rerender with a new build: a second setOption
it('reports a click on a page, and nothing for a header node', ...);            // fire click { dataType: 'node', name: '7' } after a still press: onSelect('7'); name 'h:title': not called
it('does not select when the pointer moved between press and release', ...);    // zr mousedown at (10,10), click event at (30,30): onSelect not called
it('reports a click on the background as letting go', ...);                     // zr click with no target after a still press: onSelect(null)
it('saves a dragged page on release, wherever the pointer is', ...);            // chart mousedown on node '7', fake getItemLayout returns [5,6], zr mouseup: onMoved('7', [5, 6])
it('keeps the view after a roam and repaints when the zoom crosses a mark', ...); // fake getOption series zoom 2.1, fire graphroam with repaintAt [1.05, 2]: onView({ zoom: 2.1, ... }) and one more setOption
it('zooms, fits and shows a view through its handle', ...);                     // ref.current.zoomBy(1.4) then fit(): build called with zoom 1.4, then zoom 1 center null
it('disposes the chart and its observers on unmount', ...);
```

Write each with real assertions against the fake instance; the comment after each line is what it must assert. Run: `pnpm vitest run src/components/app/link-map/link-map-chart.test.tsx --maxWorkers=1`. Expected: FAIL, cannot resolve the component.

- [ ] **Step 2: Write the component**

```tsx
'use client';

import { GraphChart } from 'echarts/charts';
import { ThumbnailComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerModules, type ECharts } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useImperativeHandle, useRef, type ReactElement, type Ref } from 'react';

import { readChartTokens, type ChartTokens } from '@/lib/design/read-tokens';
import { HEADER_PREFIX, MAP_ZOOM, type MapView } from '@/lib/internal-links/map-option';

// Only what the map draws; the category charts register theirs in `chart/echart.tsx`
registerModules([GraphChart, TooltipComponent, ThumbnailComponent, CanvasRenderer]);

export interface MapFrame {
  tokens: ChartTokens;
  width: number;
  height: number;
  view: MapView;
}

export interface LinkMapChartHandle {
  zoomBy: (factor: number) => void;
  fit: () => void;
  show: (view: MapView) => void;
}

export interface LinkMapChartProps {
  /** The option for the canvas as it is now. A new function repaints. */
  build: (frame: MapFrame) => Record<string, unknown>;
  /** What the map shows, for a reader who cannot see it. */
  label: string;
  /** A page was clicked (its id), or the background (null). */
  onSelect: (id: string | null) => void;
  /** A page was dragged to a new place, in layout units. */
  onMoved: (id: string, position: readonly [number, number]) => void;
  /** The view after a zoom or a pan, and after the handle changed it. */
  onView: (view: MapView) => void;
  /** Zooms at which the picture changes by itself: a roam across one repaints. */
  repaintAt: readonly number[];
  ref?: Ref<LinkMapChartHandle>;
}

/** Farther than this between press and release is a drag, not a click. */
const CLICK_SLOP = 4;

interface PointerEvent2d {
  offsetX: number;
  offsetY: number;
  target?: unknown;
}

/**
 * The canvas of the Link map (plan 11, task 7): an ECharts graph that follows its size and the theme, keeps the
 * view the reader chose across repaints, and tells a click from a drag. It knows nothing of pages or tiers: the
 * option comes from `build`.
 */
export function LinkMapChart({ build, label, onSelect, onMoved, onView, repaintAt, ref }: LinkMapChartProps): ReactElement {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const view = useRef<MapView>({ zoom: 1, center: null });
  // The latest props, for handlers bound once
  const latest = useRef({ build, onSelect, onMoved, onView, repaintAt });
  useEffect(() => {
    latest.current = { build, onSelect, onMoved, onView, repaintAt };
  });

  const paint = (): void => {
    const instance = chart.current;
    if (instance === null) return;
    instance.setOption(
      latest.current.build({ tokens: readChartTokens(), width: instance.getWidth(), height: instance.getHeight(), view: view.current }),
      // The series is replaced whole, so a view without a centre is the fitted one; the tooltip is kept
      { replaceMerge: ['series'] },
    );
  };
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    const node = element.current;
    if (node === null) return undefined;
    const instance = init(node, null, { renderer: 'canvas' });
    chart.current = instance;
    const zr = instance.getZr();
    let pressed: readonly [number, number] | null = null;
    let held: string | null = null;
    const still = (event: PointerEvent2d): boolean =>
      pressed !== null && Math.hypot(event.offsetX - pressed[0], event.offsetY - pressed[1]) <= CLICK_SLOP;

    zr.on('mousedown', (event: PointerEvent2d) => {
      pressed = [event.offsetX, event.offsetY];
    });
    instance.on('mousedown', (params) => {
      const name = String((params as { name?: unknown }).name ?? '');
      held = (params as { dataType?: string }).dataType === 'node' && !name.startsWith(HEADER_PREFIX) ? name : null;
    });
    zr.on('mouseup', () => {
      if (held === null) return;
      const data = (instance as unknown as { getModel: () => { getSeriesByIndex: (index: number) => { getData: () => { indexOfName: (name: string) => number; getItemLayout: (index: number) => [number, number] } } } })
        .getModel()
        .getSeriesByIndex(0)
        .getData();
      const [x, y] = data.getItemLayout(data.indexOfName(held));
      latest.current.onMoved(held, [x, y]);
      held = null;
    });
    instance.on('click', (params) => {
      const { dataType, name, event } = params as { dataType?: string; name?: unknown; event?: PointerEvent2d };
      if (dataType !== 'node' || String(name).startsWith(HEADER_PREFIX) || event === undefined || !still(event)) return;
      latest.current.onSelect(String(name));
    });
    zr.on('click', (event: PointerEvent2d) => {
      if (event.target === undefined && still(event)) latest.current.onSelect(null);
    });
    instance.on('graphroam', () => {
      const series = (instance.getOption() as { series: { zoom: number; center?: [number, number] }[] }).series[0];
      if (series === undefined) return;
      const before = view.current.zoom;
      view.current = { zoom: series.zoom, center: series.center ?? null };
      latest.current.onView(view.current);
      if (latest.current.repaintAt.some((mark) => before < mark !== series.zoom < mark)) paintRef.current();
    });

    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            instance.resize();
            paintRef.current();
          });
    resize?.observe(node);
    // The colours are read from the theme: a theme switch repaints
    const theme = new MutationObserver(() => paintRef.current());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    return () => {
      resize?.disconnect();
      theme.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    paintRef.current();
  }, [build]);

  useImperativeHandle(ref, () => {
    const show = (next: MapView): void => {
      view.current = { zoom: Math.min(MAP_ZOOM.max, Math.max(MAP_ZOOM.min, next.zoom)), center: next.center };
      latest.current.onView(view.current);
      paintRef.current();
    };
    return {
      zoomBy: (factor) => show({ ...view.current, zoom: view.current.zoom * factor }),
      fit: () => show({ zoom: 1, center: null }),
      show,
    };
  }, []);

  return <div ref={element} role="img" aria-label={label} className="absolute inset-0" />;
}
```

If the lint rules refuse writing `paintRef.current` during render, move both ref writes into the no-dependency effect that already updates `latest`. The long cast in the `mouseup` handler names the one untyped ECharts call (`getModel`); keep it in one place and do not use `any`.

- [ ] **Step 3: Run to see them pass, then commit**

Run: `pnpm vitest run src/components/app/link-map/link-map-chart.test.tsx --maxWorkers=1`
Expected: 9 passed.

```bash
git add apps/web/src/components/app/link-map
git commit -m "Link map: the canvas component and its pointer rules"
```

---

### Task 8: The tab

**Files:**
- Modify: `apps/web/src/features/internal-links/url-state.ts`, `url-state.test.ts`, `tabs.ts`, `tabs.test.ts`
- Modify: `apps/web/messages/en.json`, `docs/glossary/terms.md`, `docs/glossary/final-list.md`
- Create: `apps/web/src/features/internal-links/map/map-tab.tsx`, `map-toolbar.tsx`, `map-legend.tsx`, `map-card.tsx`, `map-help.tsx`
- Test: `apps/web/src/features/internal-links/map/map-tab.test.tsx`

- [ ] **Step 1: Words first.** Add "Link map" to `docs/glossary/terms.md` and `docs/glossary/final-list.md` in the form the other tab names have ("Link map: the tab that draws every live page of a crawl and the links between them as one graph"). Then add to `messages/en.json`, under `internalLinks`:

```json
"tabs": { "map": "Link map" },
"map": {
  "label": "Link map",
  "search": "Find a page",
  "searchLabel": "Find a page on the map",
  "found": "{count, number} of {total, plural, one {# page} other {# pages}}",
  "links": "Links",
  "linksEditorial": "Editorial",
  "linksAuto": "Editorial and auto-generated",
  "colour": "Colour",
  "colourTier": "Tier",
  "colourSection": "Section",
  "highlight": "Highlight",
  "lensNone": "Nothing",
  "lensNoIn": "No links in",
  "lensDeadEnd": "Dead ends",
  "lensSitewide": "In the menu or footer",
  "fullScreen": "Full screen",
  "leaveFullScreen": "Leave full screen",
  "tiersShown": "Tiers shown",
  "sectionsShown": "Sections shown",
  "sectionHome": "Home page",
  "sectionTop": "Top level pages",
  "sectionOther": "Other sections",
  "size": "Bigger dot: more links",
  "home": "Home page",
  "kindEditorial": "editorial",
  "kindAuto": "editorial or auto-generated",
  "summary": "{pages, plural, one {# page} other {# pages}} and {links, plural, one {# {kind} link} other {# {kind} links}}.",
  "summaryLargest": "{count, number} pages hang together in the largest group.",
  "summaryUnlinked": "{count, plural, one {# page has} other {# pages have}} no {kind} link in or out: the block {side, select, below {below} other {on the right}}.",
  "canvas": "Map of internal links. {summary} The Pages tab lists every page with its links.",
  "truncated": "The map shows the {shown, number} pages with the most links, of {total, number}.",
  "blockTitle": "No {kind} link in or out",
  "blockLine": "{tier}: {count, plural, one {# page} other {# pages}}",
  "arranging": "Arranging the map",
  "tooltipPage": "{tier}, {linksIn, plural, one {# link} other {# links}} in, {linksOut, number} out",
  "tooltipEdge": "links to {path}",
  "card": "Selected page",
  "cardClose": "Close the card",
  "cardNoTitle": "No title",
  "cardIn": "{count, plural, one {page links to it} other {pages link to it}}",
  "cardOut": "{count, plural, one {page it links to} other {pages it links to}}",
  "cardSitewide": "In the menu or footer of {count, number} pages (not drawn).",
  "details": "Page details",
  "openJourney": "Open in Journey",
  "zoomOut": "Zoom out",
  "zoomIn": "Zoom in",
  "fit": "Fit everything",
  "minimap": "Minimap",
  "help": "Reading the map",
  "helpDot": "A live page. Redirects and duplicate addresses count as the page they point to. A bigger dot has more links.",
  "helpArrow": "A link in the body of one page to another, pointing at the page it opens.",
  "helpNotDrawn": "Menu and footer links. Nearly every page has the same ones, so they are a property of the page: its card says so, and Highlight shows them.",
  "helpFind": "Type part of an address or title. Matching pages stay lit; Enter zooms to them.",
  "helpClick": "Keeps the page and the pages it links with lit, and opens its card. Click the background or press Escape to let go.",
  "helpScroll": "Zooms in and out; more names appear as you zoom in. Drag the background to move the map.",
  "helpDrag": "Moves that page.",
  "empty": "This crawl found no live page, so there is nothing to map yet."
}
```

Merge `tabs.map` into the existing `tabs` object. Run `pnpm vitest run src/lib/glossary/glossary-words.test.ts --maxWorkers=1`; a banned word in the strings above is replaced by the word the final list gives, never by an exception.

- [ ] **Step 2: The tab id and its address keys.** In `url-state.ts`: add `'map'` to `LinksTabId` after `'journey'` and to `TABS` in the same place; add the keys `'mq' | 'mauto' | 'mcol' | 'mhl' | 'mpage'` to `LinksKey` and `parseAsString` entries for them in `PARSERS`; add to `LinksState` and to `parseLinksSearch`:

```ts
  /** The Link map (plan 11, W12): the search, auto-generated links drawn, colour, highlight and the selected page. */
  map: { query: string; includeAuto: boolean; colour: MapColourMode; lens: MapLens; selected: string | null };
```

```ts
    map: {
      query: text(search.mq) ?? '',
      includeAuto: search.mauto === '1',
      colour: search.mcol === 'section' ? 'section' : 'tier',
      lens: parseLens(search.mhl),
      selected: readUrlId(search.mpage).id,
    },
```

Add cases to `url-state.test.ts`: the defaults (`{ query: '', includeAuto: false, colour: 'tier', lens: 'none', selected: null }`), each key read, an unknown `mhl` and a malformed `mpage` falling back. In `tabs.ts`: `map: 3` in `ORDER` (and `flow: 4`, `changes: 5`, `opportunities: 6`), the entry after `journey` with the `Waypoints` icon from `lucide-react` and `label: (t) => t('tabs.map')`. Load the tab's code only when it opens: read the dynamic import guide in `node_modules/next/dist/docs/`, then render it with `next/dynamic` and `ssr: false`, with `SkeletonRows` from `../crawl-states` as the loading state. Update `tabs.test.ts` for seven tabs in the order pages, links, journey, map, flow, changes, opportunities. Run both test files; expected: pass.

- [ ] **Step 3: Write the failing tab tests** in `map-tab.test.tsx`. Render `MapTab` the way `flow-tab.test.tsx` renders `FlowTab` (same providers, same MSW server, the same helper for a `LinksTabContext`), and mock `@/components/app/link-map/link-map-chart` with a stand-in that renders a `div` with the label, exposes the last `build` and the `onSelect` it was given on a module variable, and gives a handle with `zoomBy`, `fit` and `show` spies. Cases:

```tsx
it('shows a skeleton, then the summary of the crawl and the legend', ...);
// "15 pages and 13 editorial links." ; a legend button per tier present with its count; the canvas label starts "Map of internal links."
it('asks the API for auto-generated links when Links is changed', ...);
// choose "Editorial and auto-generated": setSearch called with { mauto: '1' }
it('counts the pages a search lights and zooms to them on Enter', ...);
// state.map.query 'case-study': status "2 of 15 pages"; typing calls setSearch({ mq: ..., mpage: null }); Enter calls handle.show
it('opens the card of a clicked page with its links by direction', ...);
// state.map.selected '8': card shows "/india/bfsi/case-study/digital-bank", "0" "pages link to it", "3" "pages it links to"
it('opens the inspector and the Journey from the card', ...);
// "Page details" calls context.inspect.open('8'); "Open in Journey" calls context.openJourney('8')
it('lets go of the selected page on Escape and on a click on the background', ...);
// keydown Escape: setSearch({ mpage: null }); stand-in onSelect(null): setSearch({ mpage: null })
it('takes a tier off the map when its legend button is switched off', ...);
// click the T3 button: aria-pressed false; the last build's option has no node of that tier
it('says when the map is cut to the most linked pages', ...);
// handler answers truncated: true, pages_total: 4200: the banner text
it('shows the links dropped state for a crawl without links', ...);
// context.crawl.linksAvailable false: the LinksDropped state, no request to /graph
it('shows an error with a retry when the read fails', ...);
it('says there is nothing to map for a crawl with no live page', ...);
```

Write each with real queries and assertions (`screen.getByRole`, `userEvent`); the comment under each line is what it must assert. Run: `pnpm vitest run src/features/internal-links/map/map-tab.test.tsx --maxWorkers=1`. Expected: FAIL, cannot resolve `./map-tab`.

- [ ] **Step 4: Write the tab.** `map-tab.tsx` holds the state and the wiring; the four other files are presentational and take plain props. The structure, with the parts that carry logic written out:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { SkeletonRows } from '../crawl-states';
import { LinksDropped } from '../links-dropped';
import type { LinksTabContext } from '../tabs';
import { MapCard } from './map-card';
import { MapHelp } from './map-help';
import { MapLegend } from './map-legend';
import { MapToolbar } from './map-toolbar';
import { useMapLayout } from './use-map-layout';
import { LinkMapChart, type LinkMapChartHandle, type MapFrame } from '@/components/app/link-map/link-map-chart';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { escapeHtml } from '@/lib/charts/category-chart';
import { csvBlob, downloadBlob, safeText } from '@/lib/csv/csv-write';
import { focusOf } from '@/lib/internal-links/map-focus';
import { colourGroups, summarise, toMapGraph } from '@/lib/internal-links/map-graph';
import type { LayoutInput } from '@/lib/internal-links/map-layout';
import { MAP_REPAINT_AT, mapOption, type MapView } from '@/lib/internal-links/map-option';
import { linkGraphQuery } from '@/lib/internal-links/queries';
import { tierLabel } from '@/lib/internal-links/tiers';
import { cn } from '@/lib/utils';

/** The Link map tab (plan 11, mock `il-map.js`): every live page of the crawl in one graph. */
export function MapTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.map');
  const untiered = useTranslations('internalLinks.filters')('untiered');
  const { scope, state, setSearch, tiers, crawl, registerExport } = context;
  const { query, includeAuto, colour: colourMode, lens, selected } = state.map;

  const read = useQuery({ ...linkGraphQuery(scope, includeAuto, crawl.run), enabled: crawl.linksAvailable });
  const answer = read.data?.data;
  const graph = useMemo(() => (answer === undefined ? null : toMapGraph(answer, tiers)), [answer, tiers]);

  // The canvas: its size decides which side the block of unlinked pages stands on
  const stage = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const node = stage.current;
    if (node === null || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setBelow(node.clientWidth < node.clientHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, [graph]);

  const layoutInput = useMemo<LayoutInput | null>(
    () =>
      graph === null
        ? null
        : {
            nodes: graph.nodes.map((node) => ({ id: node.id, links: node.linksIn + node.linksOut, group: node.tierPosition ?? 99 })),
            edges: graph.edges,
            below,
          },
    [graph, below],
  );
  const { layout } = useMapLayout(layoutInput);

  // What the address does not keep: dragged pages, legend switches, the minimap, the help, full screen
  const moved = useRef(new Map<string, readonly [number, number]>());
  useEffect(() => {
    moved.current = new Map();
  }, [layoutInput]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setHidden(new Set()), [colourMode]);
  const [minimap, setMinimap] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [maximised, setMaximised] = useState(false);
  const [zoom, setZoom] = useState(1);
  const chart = useRef<LinkMapChartHandle>(null);

  const colour = useMemo(() => (graph === null ? null : colourGroups(graph, colourMode, tiers)), [graph, colourMode, tiers]);
  const focus = useMemo(() => (graph === null ? null : focusOf(graph, { selected, query, lens })), [graph, selected, query, lens]);
  const summary = useMemo(() => (graph === null ? null : summarise(graph)), [graph]);
  const tierName = useCallback(
    (position: number | null): string => tierLabel(tiers.find((tier) => tier.position === position) ?? null, untiered),
    [tiers, untiered],
  );

  const build = useMemo(() => {
    if (graph === null || layout === null || colour === null || focus === null) return null;
    return (frame: MapFrame): Record<string, unknown> =>
      mapOption({
        graph, layout, moved: moved.current, focus, colour, hidden, minimap,
        tokens: frame.tokens, width: frame.width, height: frame.height, view: frame.view,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        words: {
          home: t('home'),
          blockTitle: t('blockTitle', { kind: t(includeAuto ? 'kindAuto' : 'kindEditorial') }),
          blockLine: (key, count) => t('blockLine', { tier: tierName(key === 99 ? null : key), count }),
        },
        tooltip: (target) => {
          if ('edge' in target) {
            const edge = graph.edges[target.edge];
            const from = edge === undefined ? undefined : graph.byId.get(edge.from);
            const to = edge === undefined ? undefined : graph.byId.get(edge.to);
            if (from === undefined || to === undefined) return '';
            return tooltipBox(escapeHtml(from.path), escapeHtml(t('tooltipEdge', { path: to.path })));
          }
          const node = graph.byId.get(target.page);
          if (node === undefined) return '';
          return tooltipBox(
            escapeHtml(node.path),
            escapeHtml(t('tooltipPage', { tier: tierName(node.tierPosition), linksIn: node.linksIn, linksOut: node.linksOut })),
          );
        },
      });
  }, [graph, layout, colour, focus, hidden, minimap, includeAuto, t, tierName]);
  // The handlers (step 5) and the JSX (step 6) follow here, inside this function
}

/** The tooltip: the address, then one line. Both arguments are already escaped. */
const tooltipBox = (first: string, second: string): string =>
  `<div class="max-w-72 rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 shadow-popover whitespace-normal">` +
  `<div class="type-table text-foreground [overflow-wrap:anywhere]">${first}</div>` +
  `<div class="type-meta text-foreground-secondary">${second}</div></div>`;
```

`tierLabel`'s signature takes a `TierRef | null`; pass what `flow-tab.tsx` passes it, built from the `PageTier` found. Check how the other charts give their tooltip its box (`src/lib/charts/`) and use that helper instead of `tooltipBox` if one exists.

- [ ] **Step 5: The handlers**, inside `MapTab` after `build`:

```tsx
  const select = useCallback((id: string | null) => setSearch({ mpage: id }), [setSearch]);
  const onSelect = useCallback(
    // A second click on the selected page lets it go
    (id: string | null) => select(id !== null && id === selected ? null : id),
    [select, selected],
  );
  const onMoved = useCallback((id: string, position: readonly [number, number]) => {
    moved.current.set(id, position);
  }, []);
  const onView = useCallback((view: MapView) => setZoom(view.zoom), []);

  /** Brings the lit pages into view: one page is selected, several are framed together. */
  const zoomToLit = useCallback(() => {
    if (focus === null || layout === null || focus.lit === null || focus.lit.size === 0) return;
    const placed = new Map(layout.positions.map(([id, x, y]) => [id, [x, y] as const]));
    const spots = [...focus.lit].flatMap((id) => {
      const spot = moved.current.get(id) ?? placed.get(id);
      return spot === undefined ? [] : [spot];
    });
    if (spots.length === 0) return;
    const span = (list: readonly (readonly [number, number])[], axis: 0 | 1): number =>
      Math.max(...list.map((point) => point[axis])) - Math.min(...list.map((point) => point[axis]));
    const middle = (axis: 0 | 1): number =>
      (Math.max(...spots.map((point) => point[axis])) + Math.min(...spots.map((point) => point[axis]))) / 2;
    const all = [...placed.values()];
    const next = Math.min(span(all, 0) / (span(spots, 0) + 160), span(all, 1) / (span(spots, 1) + 160), 4);
    chart.current?.show({ zoom: Math.max(1, next), center: [middle(0), middle(1)] });
    if (focus.lit.size === 1) select([...focus.lit][0] ?? null);
  }, [focus, layout, select]);

  const toggleFull = useCallback(() => {
    setMaximised((on) => {
      // The browser's own full screen comes on top where it is allowed; the map fills the window either way
      if (!on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement !== null) void document.exitFullscreen();
      return !on;
    });
  }, []);
  useEffect(() => {
    const left = (): void => {
      if (document.fullscreenElement === null) setMaximised(false);
    };
    document.addEventListener('fullscreenchange', left);
    return () => {
      document.removeEventListener('fullscreenchange', left);
      // Leaving the tab ends full screen
      if (document.fullscreenElement !== null) void document.exitFullscreen();
    };
  }, []);
  // Escape closes the help first, then lets the selected page go, then leaves full screen; the inspector and any
  // open menu take it before the map does
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || context.inspect.urlId !== null) return;
      if (helpOpen) setHelpOpen(false);
      else if (selected !== null) select(null);
      else if (maximised && document.fullscreenElement === null) setMaximised(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [context.inspect.urlId, helpOpen, maximised, select, selected]);

  // The page's Export downloads the pages of the map
  useEffect(() => {
    if (graph === null) {
      registerExport(null);
      return undefined;
    }
    registerExport(async () => {
      const rows = [
        ['Page', 'Title', 'Tier', 'Links in', 'Links out', 'On the map', 'Menu or footer links from (pages)'],
        ...graph.nodes.map((node) => [
          safeText(node.path), safeText(node.title), tierName(node.tierPosition), node.linksIn, node.linksOut,
          node.linksIn + node.linksOut > 0 ? 'Linked' : 'No link in or out', node.sitewideFrom,
        ]),
      ];
      downloadBlob(csvBlob(rows), 'internal-links-map.csv');
    });
    return () => registerExport(null);
  }, [graph, registerExport, tierName]);
```

Match `csvBlob`, `downloadBlob` and the header wording to how `flow-tab.tsx` exports (its CSV headers may come from messages; if they do, add keys under `internalLinks.map` and use them). How a popover or menu marks an Escape it handled (`defaultPrevented` or another flag) is in the menu component `ScopeMenu` is built on: follow it.

- [ ] **Step 6: The JSX.** States first, in this order: `!crawl.linksAvailable` returns `<LinksDropped />` as `flow-tab.tsx` does; `read.isError` returns `InlineError` with a retry (`read.refetch`); `graph === null` returns `SkeletonRows`; `graph.nodes.length === 0` returns `EmptyState` with `t('empty')`. All of these returns come after every hook of steps 4 and 5. `summary`, `colour` and `focus` are non-null whenever `graph` is, but TypeScript does not know it: add `if (summary === null || colour === null || focus === null) return <SkeletonRows />;` after the returns above. Then:

```tsx
  const kind = t(includeAuto ? 'kindAuto' : 'kindEditorial');
  const sentence = [
    t('summary', { pages: summary.pages, links: summary.links, kind }),
    summary.largest > 1 ? t('summaryLargest', { count: summary.largest }) : '',
    summary.unlinked > 0 ? t('summaryUnlinked', { count: summary.unlinked, kind, side: below ? 'below' : 'right' }) : '',
  ].filter(Boolean).join(' ');
  const node = selected === null ? undefined : graph.byId.get(selected);

  return (
    <section
      aria-label={t('label')}
      className={cn('flex flex-col overflow-hidden border-border bg-surface', maximised ? 'fixed inset-0 z-(--z-inspector)' : 'rounded-lg border')}
    >
      <MapToolbar
        query={query}
        found={focus.searching ? t('found', { count: focus.lit?.size ?? 0, total: graph.nodes.length }) : ''}
        includeAuto={includeAuto}
        colour={colourMode}
        lens={lens}
        maximised={maximised}
        onQuery={(value) => setSearch({ mq: value === '' ? null : value, mpage: null })}
        onEnter={zoomToLit}
        onIncludeAuto={(on) => setSearch({ mauto: on ? '1' : null })}
        onColour={(mode) => setSearch({ mcol: mode === 'section' ? 'section' : null })}
        onLens={(next) => setSearch({ mhl: next === 'none' ? null : next })}
        onToggleFull={toggleFull}
      />
      <MapLegend
        mode={colourMode}
        groups={colour.list}
        hidden={hidden}
        tierName={(group) => tierName(group.tier?.position ?? null)}
        onToggle={(key) =>
          setHidden((before) => {
            const next = new Set(before);
            if (!next.delete(key)) next.add(key);
            return next;
          })
        }
      />
      {graph.truncated ? <Banner tone="info">{t('truncated', { shown: graph.nodes.length, total: graph.pagesTotal })}</Banner> : null}
      <p className="border-b border-border-subtle px-3 py-2 type-meta text-foreground-secondary">{sentence}</p>
      <div ref={stage} className={cn('relative isolate min-h-0 bg-surface-subtle', maximised ? 'flex-1' : 'h-[max(32rem,calc(100dvh-19rem))]')}>
        {build === null ? (
          <p role="status" className="absolute inset-0 grid place-items-center type-body text-foreground-secondary">{t('arranging')}</p>
        ) : (
          <LinkMapChart
            ref={chart}
            build={build}
            label={t('canvas', { summary: sentence })}
            onSelect={onSelect}
            onMoved={onMoved}
            onView={onView}
            repaintAt={MAP_REPAINT_AT}
          />
        )}
        {node === undefined ? null : (
          <MapCard
            node={node}
            tier={tierName(node.tierPosition)}
            colour={colour.list.find((group) => group.key === colour.keyOf(node))?.colour ?? { kind: 'other' }}
            onClose={() => select(null)}
            onDetails={() => context.inspect.open(node.id)}
            onJourney={() => context.openJourney(node.id)}
          />
        )}
        {helpOpen ? <MapHelp id="link-map-help" /> : null}
        {/* The view controls: the group of buttons at the bottom left, as ViewControls of the Journey canvas */}
      </div>
    </section>
  );
```

The view controls are a group like `src/components/app/link-canvas/view-controls.tsx` with five things: zoom out (`chart.current?.zoomBy(1 / 1.4)`, disabled at `MAP_ZOOM.min`), the percent as a button that fits (`Math.round(zoom * 100)`), zoom in (`zoomBy(1.4)`, disabled at `MAP_ZOOM.max`), fit, the minimap toggle (`aria-pressed`), and help (`aria-expanded`, `aria-controls="link-map-help"`). `ViewControls` itself has two buttons the map does not have (centre on the focus page, reset card positions): do not bend it with flags. Write `map-view-controls.tsx` beside the tab with the same markup and classes, and reuse the `linkCanvas.controls` messages where the words are the same.

The four presentational parts, each a plain component with the props used above:

- `map-toolbar.tsx`: the search field (the search field component the Pages tab toolbar uses, with `type="search"`, the `searchLabel` as its accessible name and Enter calling `onEnter`), a `role="status"` span for `found`, then three menus built with the menu component `ScopeMenu` uses (Links: two options; Colour: two; Highlight: four, labels from `lensNone` to `lensSitewide`), then a `Button` with the `Maximize` or `Minimize` icon and `fullScreen` or `leaveFullScreen`. The search field keeps its own text in state and calls `onQuery` on every change; it takes `query` only as its first value, so typing never loses the caret.
- `map-legend.tsx`: a `role="group"` (label `tiersShown` or `sectionsShown`) of buttons with `aria-pressed`, each a swatch, the group's name (`tierName(group)` in tier mode; in section mode `sectionHome`, `sectionTop`, `sectionOther` for the keys `home`, `top`, `other`, else the section itself) and its count; then the `size` note at the right. The swatch is a 10 px round span filled from the group's colour through CSS variables: `palette` index n is `var(--chart-${n + 1})`, `other` is `var(--chart-other)`, `named` is `var(--${name})` with a `var(--border-strong)` border, `hollow` is `var(--surface)` with a `var(--border-strong)` border. Switched off, the swatch is hollow and the text is `text-foreground-tertiary`.
- `map-card.tsx`: an `aside` with `aria-label={t('card')}` at `absolute left-3 top-3 w-72 max-w-[calc(100%-1.5rem)]` on `bg-surface-elevated` with `shadow-popover`: the address (`[overflow-wrap:anywhere]`), the title or `cardNoTitle`, a close `IconButton` (`cardClose`), the swatch and tier, two rows that show the line as drawn (a 20 px span with a 3 px top border: dotted in `var(--chart-positive)` for links in, solid in `var(--chart-1)` for links out) with the count and `cardIn` or `cardOut`, the `cardSitewide` line when `sitewideFrom > 0`, and two `Button`s: `details`, and `openJourney` with the `Workflow` icon.
- `map-help.tsx`: a `role="region"` with `aria-label={t('help')}` at `absolute bottom-14 left-3 w-[26rem] max-w-[calc(100%-1.5rem)] max-h-[calc(100%-5rem)] overflow-auto` on `bg-surface-elevated`: a heading and a `dl` of the seven help lines. It sits in the canvas above the view controls on purpose: a popover from a button at the foot of the page falls off the screen.

- [ ] **Step 7: Run the tab tests to see them pass**

Run: `pnpm vitest run src/features/internal-links/map src/features/internal-links/tabs.test.ts src/features/internal-links/url-state.test.ts --maxWorkers=1`
Expected: all pass.

- [ ] **Step 8: Lint, types, commit**

Run: `pnpm eslint src/features/internal-links src/components/app/link-map src/lib/internal-links --max-warnings 0 && pnpm typecheck && pnpm vitest run src/test/source-text.test.ts src/lib/glossary/glossary-words.test.ts --maxWorkers=1`
Expected: clean, both tests pass.

```bash
git add apps/web/src/features/internal-links apps/web/messages/en.json docs/glossary
git commit -m "Link map: the tab, with search, legend, card, view controls and full screen"
```

- [ ] **Step 9: Independent review (Sonnet)** of tasks 7 and 8 against decisions W4 to W13 and the mock, including a keyboard pass (every control reachable, Escape order, focus returns to the search field after Enter) and both themes.

---

### Task 9: Design system and spec

**Files:**
- Modify: `docs/design-system/15-data-visualization.md`, `docs/design-system/25-component-inventory.md`
- Modify: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md`
- Modify: `docs/superpowers/plans/2026-11-16-internal-links-00-roadmap.md`

- [ ] **Step 1: Design system.** In `15-data-visualization.md`, after the paragraph on the journey canvas, add a section "Link map" that states, in the document's own style: the map is a graph drawn with the ECharts graph series; a dot is a page, an arrow a link; tiers are one hue each on the map (the table of W5) and why that differs from the tier badge; links in are `chart-positive` and dotted, links out `chart-1` and solid; pointing dims the rest to 40 percent with a 140 ms fade and none under reduced motion; the tooltip is two lines above the pointer; names give way by `hideOverlap`; the Pages tab is the accessible version. In `25-component-inventory.md`, add `LinkMapChart` (`src/components/app/link-map/link-map-chart.tsx`) with its props.

- [ ] **Step 2: Spec.** Add section 7.11 "Link map" to the spec, from the decisions of this plan and plan 10 (what a node and an edge are, the block of unlinked pages, search, selection, highlight, the cap), and add the tab to the list of tabs wherever the spec lists them.

- [ ] **Step 3: Roadmap.** Add plans 10 and 11 to the roadmap's plan list and worktree table, and these owner decisions to its decision table, each marked as taken on 2026-11-26: menu and footer links are a page property; a tab of its own named "Link map"; the ECharts renderer with the 3,000 page cap; one hue per tier on the map.

- [ ] **Step 4: Commit**

```bash
git add docs/design-system docs/superpowers
git commit -m "Link map: design system entry, spec section 7.11 and roadmap"
```

---

### Task 10: One flow in the browser, and the release checks

**Files:**
- Create: `apps/web/e2e/flows/internal-links-map.spec.ts`

- [ ] **Step 1: Write the flow.** Model the setup on `e2e/flows/internal-links.spec.ts` (how it signs in and opens the project with the mocked API). One test:

```ts
test('the Link map finds a page, selects it and opens its details', async ({ page }) => {
  // open Internal links the way internal-links.spec.ts does, then:
  await page.getByRole('link', { name: 'Link map' }).click();
  await expect(page.getByRole('img', { name: /^Map of internal links\. 15 pages and 13 editorial links\./ })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Find a page on the map' }).fill('digital-bank');
  await expect(page.getByRole('status')).toHaveText('1 of 15 pages');
  await page.getByRole('searchbox', { name: 'Find a page on the map' }).press('Enter');

  const card = page.getByRole('complementary', { name: 'Selected page' });
  await expect(card).toContainText('/india/bfsi/case-study/digital-bank');
  await expect(card).toContainText('pages it links to');

  await card.getByRole('button', { name: 'Page details' }).click();
  await expect(page).toHaveURL(/inspect=page%3A8|inspect=page:8/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page).not.toHaveURL(/mpage=/);
});
```

- [ ] **Step 2: Run it alone**

Run: `pnpm playwright test e2e/flows/internal-links-map.spec.ts --project=e2e --workers=1`
Expected: 1 passed. Stop any server the run started.

- [ ] **Step 3: Look at it.** Start the app with the mocked API (`web-mock` preview entry), open the Link map in light and dark, at 1440 px and at 390 px wide, and compare with the mock at `http://localhost:4190/#/internal-links/map`: the layout, names, colours, hover, selection, the block, the help panel inside the canvas, full screen. Fix what differs. Then, with the local API on the seeded Eventus crawl (`web-real` and `api-real`), check the real numbers: 389 pages, 385 editorial links, 133 pages in the largest group, 232 with no link. Stop every server you started.

- [ ] **Step 4: The checks of the parts touched, serially**

```bash
cd apps/web
pnpm eslint src/features/internal-links src/components/app/link-map src/lib/internal-links src/mocks --max-warnings 0
pnpm typecheck
pnpm vitest run src/lib/internal-links src/features/internal-links/map src/components/app/link-map src/features/internal-links/tabs.test.ts src/features/internal-links/url-state.test.ts src/mocks/handlers/internal-links.test.ts src/test/source-text.test.ts src/lib/glossary/glossary-words.test.ts --maxWorkers=1
pnpm format:check
pnpm build
```

Expected: all clean. `pnpm build` runs once, here.

- [ ] **Step 5: Commit, merge, clean up**

```bash
git add apps/web/e2e/flows/internal-links-map.spec.ts
git commit -m "Link map: one browser flow"
```

Merge `feat/link-map-web` into `develop`, push `origin/develop` (never `main`), remove the worktree with `git worktree remove .claude/worktrees/link-map-web` (keep the branch) and delete its `node_modules` and `.next` first if the removal asks. The full checks and the release run in the main checkout when the owner says to release.

---

## Open points

- **P1 Tier colours.** W5 departs from the tier badge's scale. If the owner wants the badge colours on the map after all, it is one table in `map-graph.ts` (`TIER_COLOUR`) and the paragraph of task 9.
- **P2 A click selects, it does not open the inspector.** The mock does the same. If the owner wants one click to open the inspector, `onSelect` calls `context.inspect.open` as well and the card stays.
- **P3 Layout time on large maps.** Task 3 step 5 measures it. If 3,000 pages takes over 12 s after lowering the floor, the next step is a Barnes-Hut approximation (`d3-force`, a small standard library) in the same worker, behind the same `layoutMap` signature; do not start it without the owner's word.
- **P4 Over 3,000 pages** the map shows the most linked pages. A map of sections (one dot per folder, opened on click) is the later answer, with sigma.js if the canvas needs it.
- **P5 Saved positions.** Dragged pages last until the tab reloads. Saving them per crawl needs a table and is not in this plan.

## Done means

- Every test named in task 10 step 4 passes, run serially, and `pnpm build` succeeds.
- The tab matches the mock in both themes at 1440 px and 390 px, and shows the real Eventus numbers.
- No console error on the tab; no server left running; both worktrees removed.
- `develop` has the work and is pushed. Nothing is released until the owner says so.

## Built, with notes

Built on 2026-11-26 by one Sonnet session, one task at a time. Reviews were by Sonnet subagents, after tasks 1 and 2, 3 and 4, 5 and 6, and 7 and 8 (the plan's own pairs), and over tasks 9 and 10 at the end. All ten tasks are done on `feat/link-map-web`.

**Layout timings (task 3, step 5)**, `layoutMap` on this Mac, a hub per 14 pages and 2 links a page: 160 pages 0.08 s, 500 pages 0.34 s, 1,000 pages 0.74 s, 3,000 pages 6.70 s. 3,000 is under the 12 s line, so the floor in `roundsFor` stays at 120. The port gives the same positions to the last bit as `layoutGraph` of the mock (245 nodes, block to the right and below).

**Where the plan and the code differed**

- **Lint forbids `!`** (`no-non-null-assertion`), and `noUncheckedIndexedAccess` is on. `layoutMap` reads through a small `at()` helper and adds the push of page `a` in locals (same order of sums as the mock). Ids sort by code unit, not `localeCompare`, so the picture is the same in every locale. A page whose link count is not a positive number goes to the block, never nowhere.
- **`useMapLayout`**: the no-worker path is a `useMemo` (the react-hooks rule refuses a `setState` in an effect body). A `current` flag in the effect stops an answer from an ended worker. Three tests with a fake `Worker` were added. The Next.js docs have no Web Worker guide; `new Worker(new URL(...), { type: 'module' })` is the form its Turbopack page names, and it builds (`pnpm build` and the test build both passed) and runs in the browser.
- **Real helpers**: `csvBlob` takes `{ header, rows }`; `Banner` takes `message` and `placement`; `InlineError` takes `title`, `reason`, `errorId`, `onRetry`, `retrying`, `retryLabel`; the tabs have role `tab`, not `link`. `escapeHtml` and `prefersReducedMotion` are the repository's.
- **`map-option.ts`**: the span of the points does not include the origin (the plan's `, 0` was not in the mock and shrank the dots of a map with only a block). The minimap window has a full strength frame and a faint fill (the plan's single `opacity` faded the frame). Colours come through `tokens.named` as the mock's `token()` does: `surface`, `foreground-tertiary` (links), `primary`, `chart-positive`, `surface-subtle` (the halo behind names).
- **`MapNode.degree`**: the links drawn at a page. The layout, the block and the export use it, because the API's `links_in` and `links_out` also count links to pages the cap cut, which made the summary and the picture disagree on a cut crawl. The card, the tooltip and the Highlight choices keep the API counts.
- **`LinkMapChart`**: refs are written in effects (the lint rule refuses it in render). A dragged page is reported only when it moved.
- **The tab**: `LINK_LEVEL_TABS` now holds `map` (a crawl whose links were dropped cannot be chosen for it, as for Journey). The canvas is measured before the layout starts (`tall` is null until then), so the layout runs once. Legend switches belong to a colouring and are cleared when it changes; a switch that hides the selected page lets it go. The search box uses `useSearchDraft` (delay 0). The map in view stays on screen while the other links are read (`keepPreviousData`). The zoom shown belongs to the canvas it came from. The dragged pages are one object per layout. Menus and legend are chips as in the mock (label in the muted colour; a legend group on is a plain chip, off is the subtle one). The help panel scrolls through `ScrollArea`, so the keyboard reaches it (axe `scrollable-region-focusable`). `map-swatch.tsx` (the colour mark of the legend and the card) and `map-view-controls.tsx` are files of their own; its minimap button is named "Minimap".
- **Messages and glossary**: `internalLinks.map` has the plan's keys plus `chipLabel`, `menuName`, `loadFailed`, `loadFailedReason`, `emptyTitle`, `viewLabel`, the seven help titles and the `export` block. `A11 Link map` is in `terms.md` (and its change log) and in `final-list.md`.
- **Task 9**: the spec section is 7.11, plus a row in the API table and the scope table; the roadmap has a "Link map (plans 10 and 11)" section with decisions D17 to D20 (D8 to D16 were taken). The design system entry is section 13.1 of doc 15 and 14.19 of doc 25.
- **Task 10**: the browser flow has three tests: the plan's flow, and axe on the tab (card and help open) in both themes. It scans the tab only: a probe that ran axe on the whole Pages tab failed the same way when this was built (`aria-allowed-attr` on the notification bell in the top bar, a `span` with `aria-haspopup` and `aria-expanded`), which is not part of this plan. The Playwright `webServer` makes its own test build; `pnpm build` ran once more as the release check.
- **`tabs.ts`** loads `MapTab` with `next/dynamic` and `ssr: false` (the plan's step 2), and the tab places are now pages 0, links 1, journey 2, map 3, flow 4, changes 5, opportunities 6.
- **`next dev` writes `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`** (with dashes), which fails `source-text.test.ts`. They were deleted and are not committed.

**Not done, on purpose**

- No `/design-system` preview entry (UI rule 19): the canvas needs ECharts and a graph, and the plan names none. A follow-up if the owner wants one.
- The mock graph (`mocks/fixtures/link-graph.ts`) has ids 1 to 15 and its own paths, not the pages of the mock crawl, so "Page details" in the mock API opens a not found inspector. The browser flow only checks the address.
- Full screen does not hold the keyboard inside the panel; Enter on a search frames pages a legend switch has hidden; a stale `mpage` from another crawl has no card and the first Escape clears it.
- The real Eventus numbers (389 pages, 385 editorial links, 133 in the largest group, 232 with no link) were not checked: there was no local API with that crawl and none was seeded. The real tab shows the mock numbers (15 pages, 13 editorial links, 11 in the largest group, 4 with no link), and the design preview mock shows the Eventus numbers from its own data.
