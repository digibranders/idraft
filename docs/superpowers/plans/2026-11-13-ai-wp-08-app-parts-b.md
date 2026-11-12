# WP-08 detailed task plan: App components B (DomainCell, DomainChip, URLCell, count popover, ChangeFeed with CountTabs, inspector stepping)

Brief: [docs/ai-visibility/work-packages/WP-08-app-parts-b.md](../../ai-visibility/work-packages/WP-08-app-parts-b.md).
Branch `ai/wp-08-app-parts-b`, worktree `.claude/worktrees/ai-wp-02-web-scaffold-ca73e6` (the brief names
`.claude/worktrees/wp-08`; this session works in the worktree it was given and stays in it), cut from
`origin/develop` at `7af51a1e`. Rows: SC-07, SC-09, SC-16, SC-22 (4). Steps: T0 to T5 (6). Kind: web, components
only. Contract: none (no route, no MSW handler, no `pnpm gen:api`).

## 1. Header

### 1.1 Goal

Shared parts that the Citations (WP-21, WP-22), fan-out (WP-24), inspector (WP-25), evidence (WP-26), Overview
cards (WP-37) and Alerts (WP-48) packages compose: `DomainCell`, `DomainRoleBadge`, `DomainChip` and
`DomainChipList`, `URLCell`, `CountPopover`, `FeedRow`, `ChangeFeed`, `CountTabs`, and `useInspectorStepping`
(generic J and K with "N of M"). Each has tests beside it, an entry in the `/design-system` gallery, and an e2e
flow.

### 1.2 Scope

| Part | File (all new) | Row |
|---|---|---|
| `DomainCell`, `DomainRoleBadge`, `Favicon`, `splitHost`, type `DomainRole`, `FaviconMode` | `apps/web/src/components/app/cells/domain-cell.tsx` | SC-07 |
| `DomainChip`, `DomainChipList` | `apps/web/src/components/app/cells/domain-chip.tsx` | SC-07 |
| `URLCell`, `visibleUrlText` | `apps/web/src/components/app/cells/url-cell.tsx` | SC-07 |
| Hostile input fixtures shared by every test and the gallery | `apps/web/src/components/app/cells/xss-fixtures.ts` | SC-07 |
| `CountPopover`, `COUNT_POPOVER_MAX` | `apps/web/src/components/app/cells/count-popover.tsx` | SC-09 |
| `groupChangeFeed`, `countNewItems`, `CHANGE_FEED_MAX` (pure) | `apps/web/src/components/app/feed/feed-model.ts` | SC-16 |
| `FeedRow`, types `FeedItem`, `FeedChange` | `apps/web/src/components/app/feed/feed-row.tsx` | SC-16 |
| `ChangeFeed` | `apps/web/src/components/app/feed/change-feed.tsx` | SC-16 |
| `CountTabs`, `toggleCountTab` | `apps/web/src/components/app/feed/count-tabs.tsx` | SC-16 |
| `useInspectorStepping` | `apps/web/src/lib/inspector/use-inspector-stepping.ts` | SC-22 |
| Gallery section | `apps/web/src/components/design-system/domains-feeds-section.tsx` | all |
| e2e flow | `apps/web/e2e/flows/ai-app-parts-b.spec.ts` | all |

Each `.ts`/`.tsx` above gets a `<name>.test.ts(x)` beside it, except `xss-fixtures.ts` (data) and the gallery
section (covered by `registry.test.tsx` and the e2e flow).

### 1.3 Not touched

- `components/ui/*` (the Popover, Badge, Button, Tooltip, Truncate primitives are used as they are).
- `components/app/inspector/*` (`Inspector` already binds J and K through `useShortcut`; `useInspector` already has
  `position` and `step`); `components/app/status/event-timeline.tsx` (its filter stays plain toggle buttons);
  `components/app/chart/*` (types `ChartNotice` and `ChartError` are imported, nothing is edited).
- Features: `features/prompts`, `features/rankings`, `features/operations` keep their own stepping code, and
  `features/rankings/rank-cells.tsx` keeps `PathText` and `RankingUrlView`. Moving them onto the new parts is a
  follow-up under a lease (section 6, R7), never part of this package.
- `lib/routes/paths.ts`, `lib/favicon.ts`, `lib/format/*`, `lib/domains/*`, `lib/a11y/*`, `lib/preferences/*`.
- `messages/en.json` outside the seven new `common` sub-objects of T0.
- Backend, OpenAPI, `schema.ts`, mocks, navigation registry, `e2e/support.ts`, tracker files.

### 1.4 Contradictions and decisions

| # | Contradiction (source) | Decision |
|---|---|---|
| C1 | DS25 puts `DomainChip` in `app/ai/domain-chip.tsx` (15.27), `CountTabs` in `ui/count-tabs.tsx` (3.45) and `ChangeFeed` in `features/overview/components/change-feed.tsx` (12.2); the brief owns `cells/` and a new `feed/` | The brief wins. `DomainChip` in `cells/domain-chip.tsx` (a new file in `cells/`, which nobody else is building in; it is not a table cell, but it shares `DomainRole` and the link rules with `DomainCell`). `CountTabs` in `feed/` (it is an app part with counts and messages, not a primitive, and `ui/` is not ours). `ChangeFeed` in `feed/`: WP-37 (Overview card) and WP-48 (Alerts) both need it, and features never import each other. T5 records each departure |
| C2 | Brief: `lib/inspector/use-inspector-stepping.ts`. The boundary rule (`eslint.config.mjs` POLICIES) lets `lib` import only `lib`; `useInspector` and `InspectorNavigation` live in `components/app/inspector/` | Keep the brief's path. The hook takes a structural `SteppableInspector` (`target`, `step`), which `UseInspectorResult` satisfies, and returns a `StepNavigation` with the same shape as `InspectorNavigation`. No import from components |
| C3 | "J and K" for the hook (brief, coordinator) vs the code: `Inspector` already calls `useShortcut('j' / 'k', { kind: 'single-key' })` when `onStep` is passed, only while focus is in the grid or the inspector; `useShortcut` already ignores fields, comboboxes, open popups and IME composition | The hook never binds keys (a second listener would step twice). It produces `onStep`, `positionText` and `navigation` for `Inspector`; the hook's test drives it through a real `Inspector` and `useShortcut` to prove J, K, the ends and typing in a field |
| C4 | DS07 section 5: favicons only through `DomainCell`, placeholder square on error or when "Show favicons" is off. Brief and coordinator: favicon on `URLCell` too, "text fallback". No "Show favicons" setting exists: not in `lib/api/schema.ts`, not in `lib/preferences/preferences.ts` (the preview only draws the switch) | `favicon?: 'show' \| 'hide'` is a prop on `DomainCell` and `URLCell` (default: no icon slot, as DS07 wants for keyword and prompt tables); the caller passes the setting once it exists (settings package, follow-up F1). The fallback is DS07's neutral placeholder square; the text fallback the coordinator asks for is that the host text is always beside it and never hidden. `URLCell` uses it only where the caller says the table is domain-first (Citations Pages tab) |
| C5 | Role badge tone: DS14 rule 2 makes "Owned" positive; the preview's prompt inspector draws "Own" positive; DS24 9.7 says Own, Competitor, Third party are neutral; acceptance: "colour only for a detectable change" | Neutral for all three, the word carries the role. The own domain is marked as 23 section 4.4 says: registrable text in `primary-text` at weight 500. DS25 8.8 shows a badge for own and competitor only, so `DomainCell` does that; `DomainRoleBadge` (all three words) is exported for Role columns |
| C6 | ChangeFeed group header 48 px (25 12.2) vs 36 px (23 9.2, preview `h-9` with `bg-surface-subtle`) | 36 px, as 23 9.2 and the approved preview (25 deviation 70 already makes 23 9.2 the content rule) |
| C7 | Feed row content: 23 9.3 and 25 12.2 full rows (time, glyph, sentence, type badge, source, View link) vs the approved Overview preview (glyph, sentence, change, relative time; the whole row is the link) | `FeedRow` has `form: 'compact' \| 'full'`. `ChangeFeed` (Overview) uses `compact` as the preview; `full` is for the Alerts events view (WP-48) and any event list. Day panels (23 9.3) are a plain `section` the consumer draws around `full` rows; not a component here (skipped, see 1.5) |
| C8 | `CountTabs` pressed look: 23 9.3 and 25 3.45 say solid `primary` fill, `primary-foreground` label, count badge on `primary-hover`; the `Button` toggle style (`aria-pressed`: primary outline, selected fill), which `EventTimeline` uses, differs | `CountTabs` follows 3.45 and 9.3 with its own classes (tokens only). `EventTimeline` is unchanged (not ours; follow-up F3 to adopt `CountTabs`) |
| C9 | DS25 8.9 `URLCell` takes `url: DisplayUrl \| null` and `maxChars`; the API gives a URL string; the rankings lesson ("nothing here counts characters of the column", `rank-cells.tsx` `PathText`) | `url: string \| null`, parsed inside with `displayUrl` and `webHref`; truncation is CSS that keeps the end of the path in view, no `maxChars`. Recorded in T5 |
| C10 | DS25 8.9 has no title; WB-CIT-10 and 23 4.2 (Page, Source objects) need "URL with host, escaped title" | Optional `title` on a second line, isolated with `<bdi>` |
| C11 | Coordinator: "live region if rows arrive"; `lib/a11y/announcer.ts`: components never create live regions, they call `announce` | `ChangeFeed` calls `announce` (polite, key `change-feed`) when a refetch brings items it did not have; never on the first load |
| C12 | No message namespace was pre-created for WP-08; `common.<part>` is the convention for shared app parts (WP-07 added `common.delta`, `common.sampleCount`, ...); the "N of M" string exists only inside feature namespaces (`prompts...position`, `runs...position`); `inspector` belongs to the shared inspector | Seven new sub-objects under `common`, all added in T0: `domainCell`, `domainChip`, `urlCell`, `countPopover`, `changeFeed`, `countTabs`, `inspectorStepping` (section 2.8). The ends reuse the existing `inspector.firstInList` and `inspector.lastInList` (read, not edited) |
| C13 | DS25 12.2 item has a preformatted `timeText`; a `<time>` needs the instant | `at: string` (ISO) plus `timeZone` on the feed; the row formats with `formatRelative` (compact) or `formatTime` (full) and sets `<time dateTime>` |
| C14 | `infra/dev/wp-status` prints `tasks n/t`; the coordinator's line says `steps n/6` | Pass `--tasks n/6`; the SendMessage line says `steps n/6` as asked |
| C15 | Brief step 0: "Opus writes the plan and commits it"; the planning agent writes the file only | The session commits the plan as its own commit (`WP-08: detailed task plan`) together with T0 in the first push |
| C16 | Brief contract text: "write the MSW handler to the generated types" | Generic text: these parts have no route; no handler module, no `gen:api` |

### 1.5 Deliberately skipped (one line each)

- Day panel component (23 9.3): a `section` around `FeedRow form="full"`, written by WP-48 where it needs it.
- Reading the "Show favicons" setting: no field exists; prop only (F1).
- Refactoring the three feature screens and the gallery's `inspector-section.tsx` onto `useInspectorStepping` (F2).
- `CountTabs` in `EventTimeline` (F3). `URLCell` in rankings (F4). Visual snapshots (none are committed in git).

## 2. Interfaces

All strict TypeScript: no `any`, no casts in source (`as Route` only in tests), explicit return types, `readonly`
arrays, `| undefined` on optional props (the repo's `exactOptionalPropertyTypes` style, as `PopoverProps`). Every
visible string comes from a prop or from `common.*` (T0); numbers and dates only through `@/lib/format`; tones only
from `formatMetricDelta` and `formatRankChange`.

### 2.1 `cells/domain-cell.tsx`

```ts
import type { Route } from 'next';
import type { components } from '@/lib/api/schema';

/** The API's role of a cited domain; follows the schema when it changes. */
export type DomainRole = components['schemas']['CitationRow']['domain_role']; // 'own' | 'competitor' | 'third_party'

/**
 * `show`: the site's icon from the allowlisted endpoint (`faviconUrl`), the placeholder square until it loads and
 * when the service has none (`naturalWidth < FAVICON_MIN_WIDTH`) or it fails. `hide`: the placeholder square only
 * (the setting is off). Left out: no icon slot at all (not a domain-first table, 07 section 5).
 */
export type FaviconMode = 'show' | 'hide';

export interface FaviconProps {
  host: string;
  mode: FaviconMode;
}
/** 16 x 16 fixed box, `alt=""`, `loading="lazy"`, `referrerPolicy="no-referrer"`, `decoding="async"`. No request
 * for a host `normalizeDomain` refuses (not a public host): placeholder only. Exported for URLCell. */
export function Favicon({ host, mode }: FaviconProps): ReactElement;

/** "docs.hubspot.com" + "hubspot.com" -> { prefix: "docs.", registrable: "hubspot.com" }. A host that does not end
 * in its registrable domain (bad data) is all registrable: nothing is hidden. Both through `displayDomain`. */
export function splitHost(host: string, registrable: string): { prefix: string; registrable: string };

/** Neutral badge with the word: Own, Competitor, Third party (`common.domainCell.roles`). For Role columns. */
export function DomainRoleBadge({ role }: { role: DomainRole }): ReactElement;

export interface DomainCellProps {
  /** As the API sent it. Untrusted: text only. */
  host: string;
  /** The API's `registrable_domain`. Always visible: the subdomain prefix gives way first. */
  registrable: string;
  /** Own and competitor get `DomainRoleBadge`; a third party none (12 section 6). Own also sets `primary-text`. */
  role?: DomainRole | undefined;
  favicon?: FaviconMode | undefined;
  /** The domain inspector, built by the caller. Without it the domain is text. */
  href?: Route | undefined;
  /** `TriangleAlert` (14 px, `warning-text`) with "Redirect not resolved" in its tooltip and accessible name. */
  unresolvedRedirect?: boolean | undefined;
  /** Added to the tooltip after the full host: "Review site". */
  category?: string | undefined;
  /** `grid` (default): the link carries `CELL_CONTROL` (F2 reaches it) and stops click propagation so the row does
   * not open. `list`: an ordinary tab stop (popover rows, inspector lists). */
  context?: 'grid' | 'list' | undefined;
}
export function DomainCell(props: DomainCellProps): ReactElement;
```

Render: `span[data-slot="domain-cell"]` flex row, `min-w-0`. Order: favicon slot (when `favicon` given), the host
inside a `Tooltip` (`purpose="label"`, content full host plus category) as `font-mono` at the table size:
prefix in `foreground-tertiary` (`min-w-0 truncate`, shrinks first: `shrink-100`), registrable in `foreground` (or
`primary-text font-medium` when own; `min-w-0 truncate`, shrink 1), then the role badge (`shrink-0`), then the
redirect icon. The full host is also in an `sr-only` span when the visible text is split, so a screen reader reads
one word. Links: `TextLink render={<Link href={href} />}` with `tone="inherit"` (the mono colours stay).

### 2.2 `cells/domain-chip.tsx`

```ts
export interface DomainChipProps {
  /** `displayDomain` output. Untrusted: text only. */
  domain: string;
  /** The domain inspector. */
  href?: Route | undefined;
}
export function DomainChip(props: DomainChipProps): ReactElement;

export interface DomainChipListProps {
  /** Names the `ul`: "Cited sources". Also the overflow popover's title. */
  label: string;
  domains: readonly DomainChipProps[];
  /** Visible chips; the rest collapse into "+N". Default 3 (23 section 4.4). */
  max?: number | undefined;
}
export function DomainChipList(props: DomainChipListProps): ReactElement | null; // null when domains is empty
```

Chip look (15.27): `h-badge rounded-sm px-2 type-micro`, `border-neutral-border bg-neutral-subtle text-neutral-text`,
`gap-2` between chips, `truncate` with a max width token (`max-w-popover-min` is too wide; use `max-w-48`, a plain
size utility, allowed). The overflow chip is a `button` in the same look, named
`common.domainChip.more` ("{count} more cited domains", count through `formatInteger`), visible text `+{n}`
(`formatInteger`), opening `Popover` (`title` = `label`) that lists the rest as chips.

### 2.3 `cells/url-cell.tsx`

```ts
export interface URLCellProps {
  /** As the API sent it, or null. Parsed with `displayUrl`; only an address `webHref` accepts is ever an href. */
  url: string | null;
  /** `hide` in single-domain tables (8.9). */
  hostDisplay: 'show' | 'hide';
  /** What the URL is, for the names of Copy and Open: "cited page", "ranking URL". */
  label: string;
  /** A title an answer gave the page. Untrusted: text only, second line, in `<bdi>`. */
  title?: string | null | undefined;
  /** Shown for `url === null`: "Not cited". Default `common.urlCell.none`. */
  emptyText?: string | undefined;
  favicon?: FaviconMode | undefined;
  /** The source inspector. With it the path opens the inspector and a 24 px Open button goes out in a new tab;
   * without it the path itself is the outbound link (as rankings' `RankingUrlView`). */
  inspectorHref?: Route | undefined;
  context?: 'grid' | 'list' | undefined;
}
/** Bidi controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) percent-encoded, so a decoded path
 * cannot reorder what it shows ("gnp.exe" read as "exe.png"). Pure, tested. */
export function visibleUrlText(text: string): string;
export function URLCell(props: URLCellProps): ReactElement;
```

Render: `span[data-slot="url-cell"]`, `font-mono` at the table size, `dir="ltr"` on the URL line (an address reads
left to right in every locale). Host (`foreground-tertiary`, `shrink-0` until the path is gone, then truncates)
plus path (`foreground`): start of the path truncates, its last 16 characters keep their room (the `PathText`
technique, written again here: components never import a feature). The visible URL is `visibleUrlText(display)`;
the tooltip (`Truncate`-style, `purpose="label"`) and the `sr-only` text carry the full display URL. Copy
(`CopyButton`, copies `original`) and Open (24 px `IconButton`, `ExternalLink`, `target="_blank"`,
`rel="noopener noreferrer nofollow"`) appear on row hover and focus, as in rankings. Invalid URL (`valid: false`
or `webHref` null: `javascript:`, `data:`, `vbscript:`, credentials, relative): the raw string as text in
`foreground-secondary` with a `TriangleAlert` (`warning-text`) and the tooltip `common.urlCell.invalid`; no link,
no Open, Copy still copies the raw text. The host is always rendered when `hostDisplay="show"`, including beside an
inspector link, so a misleading title or path cannot hide the destination (doc 20 section 7).

### 2.4 `cells/count-popover.tsx`

```ts
export const COUNT_POPOVER_MAX = 5;

export interface CountPopoverDomain {
  id: string;
  host: string;
  registrable: string;
  role?: DomainRole | undefined;
  /** Preformatted ("12"). Required: a share is never shown without its count. */
  countText: string;
  /** "8.1%", shown after the count, never alone. */
  shareText?: string | undefined;
  href?: Route | undefined;
}
export interface CountPopoverProps {
  /** What the cell shows: "5". Preformatted. */
  countText: string;
  /** The trigger's accessible name, with the count and the noun: "5 domains cited instead, show them". */
  label: string;
  /** The popover's visible heading, which names it: "Cited instead". */
  title: string;
  /** Most first; the first `COUNT_POPOVER_MAX` are listed, each a `DomainCell` (`context="list"`) and its count. */
  domains: readonly CountPopoverDomain[];
  /** Every domain behind the count; `null` when unknown. Unknown or 0: the count is plain text, no popover. */
  total: number | null;
  /** The full list: "and 7 more" becomes a link to it. Without it, plain text. */
  moreHref?: Route | undefined;
  favicon?: FaviconMode | undefined;
  context?: 'grid' | 'list' | undefined;
}
export function CountPopover(props: CountPopoverProps): ReactElement;
```

Trigger: a `button` styled as the count (`num`, `text-link`, underline on hover and focus, `focus-visible:focus-ring`),
`CELL_CONTROL` in a grid, click propagation stopped. Base UI sets `aria-expanded` and `aria-haspopup`. Open with
Enter or Space (native button) or a click; focus moves into the popup (Base UI default), Escape and a click outside
close it and focus returns to the trigger. Body: `ul` of at most 5 `li` (DomainCell, then `countText` and, when
given, `shareText` in `type-meta num`), then `common.countPopover.more` ("and {count} more", count through
`formatInteger`) when `total > shown`. `width="content"` (280 to 360 px) and Popover's `collisionPadding` keep it in
the viewport at 390 px; checked in the browser and in e2e.

### 2.5 `feed/feed-row.tsx`, `feed/feed-model.ts`, `feed/change-feed.tsx`

```ts
// feed-row.tsx
export type FeedChange =
  | { kind: 'metric'; input: MetricDeltaInput }
  | { kind: 'rank'; change: RankChange };

export interface FeedItem {
  id: string;
  /** 16 px Lucide glyph (18 section 7). */
  glyph: LucideIcon;
  /** The finished sentence; the component words nothing. Untrusted parts in it render as text. */
  text: string;
  /** The instant, ISO 8601. */
  at: string;
  /** The evidence: a filtered table or the record's inspector. */
  href: Route;
  /** One value that changed: `Delta` for a metric, the `formatRankChange` text for a rank. Its tone, which is
   * positive or negative only for a detectable change, also colours the glyph; otherwise the glyph is tertiary. */
  change?: FeedChange | undefined;
  /** `full` only: neutral `Badge` "Rank move" and the source "SERP check". */
  typeLabel?: string | undefined;
  sourceLabel?: string | undefined;
}
export interface FeedRowProps {
  item: FeedItem;
  /** `compact`: the Overview row of the preview, all one link: glyph, sentence, change, relative time.
   * `full` (23 9.3): time, glyph, sentence, type badge, source, "View" link named "View: <sentence>". */
  form: 'compact' | 'full';
  timeZone: string;
  now?: Date | undefined;
}
export function FeedRow(props: FeedRowProps): ReactElement; // renders an <li>

// feed-model.ts
export const CHANGE_FEED_MAX = 8;
export type ChangeFeedGroup = 'needs_attention' | 'changes' | 'notices';
export interface ChangeFeedItem extends FeedItem { group: ChangeFeedGroup }
export interface ChangeFeedSection { group: ChangeFeedGroup; items: readonly ChangeFeedItem[] }
/** Needs attention, Changes, Notices; newest first inside a group (ties by id); at most `max` items in all, taken
 * in that order; empty groups left out. */
export function groupChangeFeed(items: readonly ChangeFeedItem[], max?: number): readonly ChangeFeedSection[];
/** How many of `items` were not in `previousIds`. */
export function countNewItems(previousIds: ReadonlySet<string>, items: readonly { id: string }[]): number;

// change-feed.tsx
export type ChangeFeedState =
  | { status: 'loading' }
  | { status: 'error'; error: ChartError } // InlineError props without `live`, as ChartFrame
  | { status: 'ready' | 'refetching'; items: readonly ChangeFeedItem[]; total: number };
export interface ChangeFeedProps {
  /** "Key changes": the panel's heading. */
  title: string;
  headingLevel?: 2 | 3 | undefined; // default 2; group headings one level lower
  state: ChangeFeedState;
  /** "the last 28 days": the empty state names the window. */
  windowText: string;
  /** "View all 23 changes" in the title row when `total` exceeds what is shown. */
  viewAllHref?: Route | undefined;
  /** Stale or partial data, as ChartFrame's meta notice (Clock or CircleDashed, `warning-text`). */
  notice?: ChartNotice | undefined;
  /** Held days: one neutral `Banner` (placement `region`) above the groups, not one line per event. */
  holdText?: string | undefined;
  /** The empty state's one action (for example "Open alert rules"). */
  emptyAction?: ReactNode;
  /** A `CountTabs` above the groups on a full list. */
  filter?: ReactNode;
  timeZone: string;
  now?: Date | undefined;
  max?: number | undefined; // default CHANGE_FEED_MAX
}
export function ChangeFeed(props: ChangeFeedProps): ReactElement;
```

Frame: `section` (`surface`, 1 px `border`, `rounded-lg`, `overflow-hidden`), title row `min-h-12 px-4 py-3`
(`type-section-title`, View all link at the end). Groups: one `section` each, header row `h-9 px-4
bg-surface-subtle border-t border-border-subtle` with the name (`type-subsection-title`, an `h3`) and the shown count
(`type-meta num`); then a `ul` of compact `FeedRow`s (`min-h-9 px-4 py-2`, `border-t border-border-subtle`,
`hover:bg-surface-hover`). Fixed slots so rows line up: glyph `size-icon`, change `shrink-0`, time `w-12 shrink-0
text-right type-meta num`.

States: loading: `role="status"` with `common.changeFeed.loading` and 5 `Skeleton shape="text-14"` rows inside the
frame, no spinner. Error: `InlineError` in the frame with `common.retry`. Empty (`items` empty): `EmptyState
variant="inline"`, title `common.changeFeed.empty` with the window, reason `common.changeFeed.emptyReason`, the
action. Partial and stale: the notice in the title row's meta line, data still shown. Refetching: previous items
stay, `aria-busy`, a 2 px `bg-primary` bar at the top (`data-slot="feed-refetch-bar"`, as ChartFrame's). New items
after a refetch: `announce(t('arrived', { count }), { key: 'change-feed' })`.

### 2.6 `feed/count-tabs.tsx`

```ts
export interface CountTabsItem<TValue extends string> {
  value: TValue;
  label: string;
  /** Preformatted by the caller (`formatCompact`); `EMPTY_VALUE` when unknown, never "0" for unknown. */
  countText: string;
  disabledReason?: string | undefined;
}
export interface CountTabsProps<TValue extends string> {
  /** The toolbar's name: "Event types". */
  label: string;
  allLabel: string;
  allCountText: string;
  /** Only the types present. */
  items: readonly CountTabsItem<TValue>[];
  /** Empty: "All" is pressed. */
  value: readonly TValue[];
  onValueChange: (value: readonly TValue[]) => void;
  /** 32 or 36 px: `md` on pages, `sm` in the inspector. Default `md`. */
  size?: 'sm' | 'md' | undefined;
}
/** Pressing a type adds or removes it; removing the last one gives [] (All). Pure. */
export function toggleCountTab<TValue extends string>(value: readonly TValue[], item: TValue): readonly TValue[];
export function CountTabs<TValue extends string>(props: CountTabsProps<TValue>): ReactElement;
```

`div role="toolbar" aria-label={label}`, `flex flex-wrap gap-2`; items are `button`s with `aria-pressed`, roving
`tabIndex` (one Tab stop on the pressed item, else the first), Left and Right move with wrap, Home and End; Space and
Enter toggle (native). Accessible name `common.countTabs.item` ("{label}, {count}"); the visible count is a
`Badge` (neutral; when pressed `className` gives `bg-primary-hover text-primary-foreground border-transparent`).
Pressed item `bg-primary text-primary-foreground font-medium border-primary`; unpressed `border-border bg-surface
hover:bg-surface-hover`; `rounded-md`; height `h-control` (md) or `h-control-sm` (sm); padding `px-3`. Disabled with
reason: focusable (`aria-disabled`), `Tooltip` with the reason, no toggle.

### 2.7 `lib/inspector/use-inspector-stepping.ts`

```ts
import type { InspectorTarget, InspectorType } from './placement';

export type StepDirection = 'next' | 'previous';

/** What the hook needs of `useInspector()`; `UseInspectorResult` satisfies it (lib may not import components). */
export interface SteppableInspector {
  target: InspectorTarget | null;
  step: (direction: StepDirection, orderedIds: readonly string[]) => void;
}
/** The same shape as `InspectorNavigation` of `inspector-header.tsx`. */
export interface StepNavigation {
  onPrevious: () => void;
  onNext: () => void;
  atFirst: boolean;
  atLast: boolean;
}
export interface UseInspectorSteppingOptions {
  inspector: SteppableInspector;
  /** Only an open record of this type is stepped (an id of another type never matches by accident). */
  type: InspectorType;
  /** The table's current row order: `DataTable onRowOrderChange`, or a narrower list (a topic's prompts). */
  order: readonly string[];
  /** "Domain": spoken first after a step. */
  typeLabel: string;
  /** "domain": for "Last domain in this list" (existing `inspector.lastInList`). */
  typeNoun: string;
  /** Runs the step, or asks first (unsaved changes, as rankings' `guarded`). Default: runs it. */
  guard?: ((run: () => void) => void) | undefined;
}
export interface InspectorStepping {
  /** "3 of 13" (`common.inspectorStepping.position`, `formatInteger`); null when the record is not in `order`. */
  positionText: string | null;
  navigation: StepNavigation | null;
  /** For `Inspector onStep`; undefined with `navigation` null, so J and K are off. */
  onStep: ((direction: StepDirection) => void) | undefined;
}
export function useInspectorStepping(options: UseInspectorSteppingOptions): InspectorStepping;
```

Behaviour: a step inside the list calls `guard(() => inspector.step(direction, order))` and announces
`common.inspectorStepping.announce` ("{type}, {index} of {count}", the new position) politely with key
`inspector-step`; a step past either end does nothing to the URL and announces `inspector.firstInList` or
`inspector.lastInList`. Use in a screen:

```tsx
const stepping = useInspectorStepping({ inspector, type: 'domain', order, typeLabel, typeNoun });
<DataTable onRowOrderChange={setOrder} ... />
<Inspector type="domain" onStep={stepping.onStep}
  header={{ ...header, positionText: stepping.positionText, navigation: stepping.navigation }} ... />
```

### 2.8 Messages (T0, `apps/web/messages/en.json`, additive, inside `common` only)

```json
"domainCell": {
  "roles": { "own": "Own", "competitor": "Competitor", "thirdParty": "Third party" },
  "redirect": "Redirect not resolved"
},
"domainChip": {
  "more": "{count} more cited domains"
},
"urlCell": {
  "none": "No URL",
  "invalid": "Invalid URL",
  "copy": "Copy {label}",
  "copied": "{label} copied",
  "open": "Open {path} in a new tab"
},
"countPopover": {
  "more": "and {count} more"
},
"changeFeed": {
  "groups": { "needsAttention": "Needs attention", "changes": "Changes", "notices": "Notices" },
  "groupCount": "{count, plural, one {# change} other {# changes}}",
  "viewAll": "View all {count} changes",
  "view": "View",
  "viewItem": "View: {text}",
  "loading": "Loading changes",
  "empty": "No detectable changes in {window}",
  "emptyReason": "Changes within normal variation are left out.",
  "errorTitle": "Changes did not load",
  "errorReason": "The request failed. Try again.",
  "arrived": "{count, plural, one {# new change} other {# new changes}}"
},
"countTabs": {
  "item": "{label}, {count}"
},
"inspectorStepping": {
  "position": "{index} of {count}",
  "announce": "{type}, {index} of {count}"
}
```

`{count}` arguments that are not plurals receive preformatted strings (`formatInteger`). The messages test
(`src/i18n/messages.test.ts`) passes on these: no straight double quotes, no dashes, no contraction of "not",
camelCase keys. `count` in `groupCount` and `arrived` is a number (ICU plural).

### 2.9 Hostile input fixtures (`cells/xss-fixtures.ts`, used by T1 to T4 tests and the gallery)

```ts
export interface HostileUrl { name: string; url: string; linkable: boolean }
export const HOSTILE_TITLES: readonly string[];   // markup that must stay text
export const HOSTILE_URLS: readonly HostileUrl[]; // schemes that must never become an href
export const HOSTILE_HOSTS: readonly { host: string; registrable: string }[];
export const MARKER = '__wp08_xss';               // set on window by any payload that runs
```

Contents, written with `\u` escapes so the source stays ASCII:

- Titles: `<img src=x onerror="window.__wp08_xss=1">`, `"><script>window.__wp08_xss=1</script>`,
  `<a href="javascript:window.__wp08_xss=1">click</a>`, `{{constructor.constructor('window.__wp08_xss=1')()}}`, a
  right-to-left override title `\u202Egnp.exe`, an Arabic title, a Hebrew title, a title of 400 characters.
- URLs (not linkable): `javascript:window.__wp08_xss=1`, `JaVaScRiPt:alert(1)`, `\u0001javascript:alert(1)`,
  ` javascript:alert(1)` (leading space), `java\tscript:alert(1)`, `data:text/html;base64,PHNjcmlwdD4=`,
  `vbscript:msgbox(1)`, `https://user:pass@evil.example/`, `//evil.example/x`, `/relative/path`, `not a url`.
- URLs (linkable, shown safely): `https://example.com/files/%E2%80%AEgnp.exe` (decoded RLO in the path),
  `https://xn--80ak6aa92e.com/` (Cyrillic homograph, shown as punycode, which `displayUrl` keeps),
  `https://example.com/a/very/long/path/segment/that/goes/on/and/on/how-to-choose-a-crm-for-startups`.
- Hosts: `a-very-long-subdomain-label-that-goes-on.another-long-label.example-registrable.co.uk` with registrable
  `example-registrable.co.uk`; `evil.com"><img src=x onerror=alert(1)>` with registrable `evil.com` (refused by
  `normalizeDomain`, so no favicon request); `localhost` (private, no request); a host whose registrable does not
  match (`docs.a.com`, `b.com`).

Assertions every consumer test makes on its rendered container: no `script` element; no element with an `on*`
attribute; every `img` is the favicon (`src` starts with `FAVICON_ENDPOINT`, `alt=""`) or absent; every `a[href]`
passes `webHref` or starts with `/`, `?` or `#`; `window.__wp08_xss` is undefined after render and after hovering
and clicking every link-like element (`preventDefault` on navigation in jsdom); each hostile string appears as text
(`toHaveTextContent` or `getByText`); the URL line has `dir="ltr"` and the title sits in a `bdi`; the registrable part
of the long host is visible text and the tooltip (hover) shows the full host; `visibleUrlText` turns U+202E into
`%E2%80%AE`.

## 3. Tasks

Rules for every task:

- Tests first: write the test file, run it, watch it fail for the reason the task names (module not found counts
  only for a new file; then the first assertion), then implement.
- File tools only (Write, Edit). No shell heredocs, `sed`, `python` or replace scripts. Edit only the task's files.
- Tokens and the 15 type utilities only; no hex, no palette classes, no arbitrary values (`[...]`), spacing steps
  0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12 only (`eslint.config.mjs` ALLOWED_STEPS), named sizes only for height,
  width and size. `num` on every number. ASCII copy, no em or en dashes in strings or comments
  (`src/test/source-text.test.ts` reads comments). No `dangerouslySetInnerHTML`, no `innerHTML`.
- Hrefs are typed `Route` from `next`; tests may write `'/x?inspect=domain:hubspot.com' as Route`; source never
  casts (the gallery uses `#anchor` literals, which are `Route` without a cast, as `chart-parts-section.tsx` does).
- Tests: `renderWithProviders` from `@/test/render`, `axe` from `@/test/axe`, `user` from the render result; each
  component test runs axe once (`expect(await axe(container)).toHaveNoViolations()`).
- Commands from the worktree root. One file, light, no lock:
  `pnpm --dir apps/web exec vitest run <path from apps/web>`. A folder: medium lane (below). Never plain
  `pnpm test`, `pnpm build`, `pnpm lint`, `pnpm typecheck` or `pnpm e2e`.
- The session commits after the reviewer's PASS: `git add <the task's paths>` then
  `git commit -m "WP-08: <title>"`. No attribution lines, no dashes. Never stage another session's files.
- Reviewer (fresh Sonnet per task): reads this plan, the task and `git diff`, runs the task's test command, runs the
  medium lint and typecheck, greps the diff for `as ` (casts), `any`, `dangerouslySetInnerHTML`, `#[0-9a-f]{3}`,
  `-\[`, `\[.*px\]`, U+2013 and U+2014, and returns PASS or a numbered fix list; the implementer (the same
  subagent, resumed with SendMessage) fixes, the reviewer re-checks.

Medium lane commands (used below as LINT, TYPES, FORMAT, FOLDER):

```bash
infra/dev/heavy --lane medium --label wp08-lint -- bash -c 'cd apps/web && pnpm lint'
infra/dev/heavy --lane medium --label wp08-types -- bash -c 'cd apps/web && pnpm typecheck'
infra/dev/heavy --lane medium --label wp08-format -- bash -c 'cd apps/web && pnpm format:check'
infra/dev/heavy --lane medium --label wp08-<folder> -- bash -c 'cd apps/web && pnpm exec vitest run <folder> --maxWorkers=2'
```

Order and parallelism (at most 2 subagents at once, disjoint files):

| Wave | Subagents | Files |
|---|---|---|
| 0 | none (the session) | T0 |
| A | T1 implementer and T3 implementer, then T1 reviewer and T3 reviewer | `cells/` (T1) and `feed/` (T3) |
| B | T2 implementer and T4a implementer (hook), then their reviewers | `cells/count-popover*` (T2) and `lib/inspector/use-inspector-stepping*` (T4a) |
| C | T4b implementer (gallery section and e2e), then its reviewer | `design-system/domains-feeds-section.tsx`, `e2e/flows/ai-app-parts-b.spec.ts` |
| D | the session (T5), then the final whole-package reviewer | docs, rebase, checks |

T2 needs `DomainCell` from T1; T4b needs everything. T3 needs nothing from T1 (it imports no cell).

### T0: early registry line and message keys (the session)

Goal: everything later tasks share is on develop first, so parallel tasks never touch `en.json` or the registry.

Files:
- `apps/web/messages/en.json`: the `common` sub-objects of section 2.8 (append after `common.roles`; additive).
- `apps/web/src/components/design-system/registry.ts`: import `DomainsFeedsSection` and append
  `{ slug: 'domains-feeds', title: 'Domains, feeds and stepping', render: DomainsFeedsSection }` after
  `chart-grids`.
- `apps/web/src/components/design-system/section-slugs.ts`: append `'domains-feeds'`.
- `apps/web/src/components/design-system/registry.test.tsx`: append `'domains-feeds'` to the expected list.
- `apps/web/src/components/design-system/domains-feeds-section.tsx` (stub): `'use client'`, exports
  `DomainsFeedsSection(): ReactNode` returning one `SpecimenGroup title="Domains, feeds and stepping"
  note="Filled by WP-08."` with one line of `type-body` text (the registry test needs a `section` with an `h2`).
- `docs/superpowers/plans/2026-11-13-ai-wp-08-app-parts-b.md` (this plan), as its own commit first.

Tests: `registry.test.tsx` (the list now has 18 slugs and the stub renders axe clean in both themes),
`messages.test.ts`. Before the edit the registry test fails on the slug list once the test line is in.

Commands: `pnpm --dir apps/web exec vitest run src/components/design-system/registry.test.tsx src/i18n/messages.test.ts`,
then LINT, TYPES, FORMAT. Rows: none (process). Commits: `WP-08: detailed task plan`, then
`WP-08: gallery slot and message keys`. Then `git fetch origin && git rebase origin/develop`, rerun the two tests,
`git push origin HEAD:develop`, report `building` (section 5). Model: the Opus session itself. The registry lease
stays with WP-08 until its last push (coordinator's rule).

### T1: DomainCell, DomainChip, URLCell with XSS fixtures (SC-07)

Goal: the three identity parts, safe against hostile data, with the favicon rule of 07 section 5.

Files: `apps/web/src/components/app/cells/xss-fixtures.ts`, `domain-cell.tsx`, `domain-cell.test.tsx`,
`domain-chip.tsx`, `domain-chip.test.tsx`, `url-cell.tsx`, `url-cell.test.tsx` (all under
`apps/web/src/components/app/cells/`).

Tests first:
- `domain-cell.test.tsx`: `splitHost` cases (subdomain, equal, `www.` dropped by `displayDomain`, mismatch keeps all
  text); registrable always rendered as text; prefix carries `text-foreground-tertiary`; own sets `text-primary-text`
  and a neutral "Own" badge; competitor badge "Competitor"; third party no badge; `DomainRoleBadge` renders all three
  words with the neutral classes (no `positive` class anywhere); `favicon="show"` renders an `img` with `alt=""`,
  `loading="lazy"`, `referrerpolicy="no-referrer"`, `src === faviconUrl(host)`, and the placeholder square until load;
  firing `load` with `naturalWidth` 64 (defined on the element) shows the icon, with 16 shows the placeholder, `error`
  shows the placeholder; `favicon="hide"` renders the placeholder and no `img`; no `favicon` prop renders no slot; a
  host `normalizeDomain` refuses never requests (`img` absent); `href` renders one link to it with `data-cell-control`
  and `tabindex="-1"` in `grid`, a normal link in `list`; clicking the link does not call a row `onClick` around it;
  `unresolvedRedirect` names the icon "Redirect not resolved"; hovering shows the full host and the category in the
  tooltip; every `HOSTILE_HOSTS` entry passes the fixture assertions of 2.9; axe clean.
- `domain-chip.test.tsx`: `ul` named by `label`; 3 chips then `+2` for 5 domains; the overflow button named
  "2 more cited domains" opens a popover titled by `label` listing the other 2 as links; Escape returns focus to it;
  no overflow button for 3 or fewer; empty list renders nothing; hostile domains render as text; axe clean.
- `url-cell.test.tsx`: `visibleUrlText` encodes each bidi control and leaves other text alone; a valid URL shows host
  and path, the host hidden with `hostDisplay="hide"`; `dir="ltr"` on the URL line; the last part of a long path is in
  a `shrink-0` span and the full display URL is in `sr-only` text; outbound link `target="_blank"` and
  `rel="noopener noreferrer nofollow"`, named "Open <path> in a new tab"; with `inspectorHref`, the path links to it
  and the Open button goes out; Copy copies `original` (mock `@/lib/dom/clipboard`); `title` renders in a `bdi`;
  `url=null` shows `emptyText` or "No URL"; every `HOSTILE_URLS` entry with `linkable: false` renders the raw text, the
  "Invalid URL" tooltip and no `a[href]` at all; `linkable: true` entries link only to `webHref(url)`; every
  `HOSTILE_TITLES` entry passes 2.9; axe clean.

They fail before because the modules do not exist, then on the first missing behaviour.

Implementation notes: reuse `faviconUrl`, `FAVICON_MIN_WIDTH`, the `ProjectMark` load logic (ref check for a cached
`complete` image, `onLoad`, `onError`), `normalizeDomain`, `displayDomain`, `displayUrl`, `webHref`, `CopyButton`,
`CELL_CONTROL`, `Badge`, `Tooltip`, `TextLink` with `render={<Link />}`, `IconButton`, `Icon`. Placeholder square:
`size-icon rounded-xs bg-neutral-subtle ring-1 ring-border` (tokens; check the exact ring token in `globals.css`).
The favicon box is `size-icon shrink-0` with explicit `width={16} height={16}` on the `img`, light tile in dark
theme as `ProjectMark` (`dark:bg-foreground`) only if the icon disappears on the dark surface in the browser check.

Commands: `infra/dev/heavy --lane medium --label wp08-cells -- bash -c 'cd apps/web && pnpm exec vitest run src/components/app/cells --maxWorkers=2'`,
LINT, TYPES, FORMAT.

Row closed: SC-07 (the gallery entry follows in T4b). Reviewer checklist: no `positive`/`negative` tone on roles;
favicon never requested for a refused host; `img` has `alt=""` and fixed size; no href that `webHref` did not
return; host always visible text; `bdi` and `dir="ltr"` present; `CELL_CONTROL` on in-grid controls and click
propagation stopped; no import from `features/`; fixture file used by both tests.

Commit: `WP-08: DomainCell, DomainChip and URLCell with hostile input fixtures`. Model: Sonnet. Parallel with T3.

### T2: count popover (SC-09)

Goal: a count cell that opens a popover of up to 5 domains with counts.

Files: `apps/web/src/components/app/cells/count-popover.tsx`, `count-popover.test.tsx`.

Tests first (`count-popover.test.tsx`): trigger shows `countText` and has the accessible name `label`; Enter opens,
Space opens, a click opens; focus is inside the popup after opening; the popup is named by `title`; it lists exactly
5 `DomainCell`s for 7 domains with each `countText` beside its domain, `shareText` only after a count; "and 2 more"
for `total` 7, a link when `moreHref` is given, text otherwise; `total` 5 with 5 domains has no "more" line; Escape
closes and focus returns to the trigger; `total` 0 or `null` renders the count as plain text with no button; in
`grid` the trigger has `data-cell-control` and its click does not reach a row handler; hostile hosts pass 2.9; axe
clean with the popup open.

They fail before because the module does not exist.

Implementation notes: `Popover` with `trigger={<button ... />}`, `title`, `padding="list"`, `width="content"`,
`align="start"`; rows `flex items-center gap-3` with the count `ml-auto shrink-0 type-meta num` (a fixed `w-16`
slot so the counts line up). `COUNT_POPOVER_MAX` slices; `formatInteger(total - shown)` for "more".

Commands: `pnpm --dir apps/web exec vitest run src/components/app/cells/count-popover.test.tsx`, then the cells
FOLDER, LINT, TYPES, FORMAT.

Row closed: SC-09. Reviewer checklist: never more than 5 rows; no share without count; unknown not shown as 0 and
not openable; focus in and back; trigger name includes the count. Commit: `WP-08: count popover`. Model: Sonnet.
Parallel with T4a.

### T3: ChangeFeed and CountTabs (SC-16)

Goal: the Key changes feed with its states, the feed row in both forms, and the event-type filter.

Files (under `apps/web/src/components/app/feed/`): `feed-model.ts`, `feed-model.test.ts`, `feed-row.tsx`,
`feed-row.test.tsx`, `change-feed.tsx`, `change-feed.test.tsx`, `count-tabs.tsx`, `count-tabs.test.tsx`.

Tests first:
- `feed-model.test.ts`: group order; newest first with id tie break; the cap of 8 taken across groups in order;
  empty groups dropped; a custom `max`; `countNewItems`.
- `feed-row.test.tsx`: compact is one `li` holding one link to `href` with glyph (`aria-hidden`), sentence, change and
  `<time dateTime={at}>` with `formatRelative`; full has `formatTime`, the type `Badge`, the source and a "View" link
  named "View: <sentence>"; a detectable metric change colours the glyph and the value `text-positive-text` or
  `text-negative-text`, an undetectable one leaves both neutral (`text-foreground-tertiary` glyph); a rank change uses
  `formatRankChange` tone the same way; a hostile `text` renders as text (2.9).
- `change-feed.test.tsx`: loading has `role="status"` named "Loading changes" and skeletons, no spinner; error shows
  the InlineError with a working Retry; empty shows "No detectable changes in the last 28 days" and the action;
  ready shows group `h3`s with counts in Needs attention, Changes, Notices order, at most 8 rows, and "View all 23
  changes" when `total` 23 > 8; partial and stale notices show their text with the rows still there; `holdText`
  renders one neutral Banner; refetching keeps the rows, sets `aria-busy` and shows the bar; a rerender from 5 to 7
  items after a refetch calls `announce` once with "2 new changes" (mock `@/lib/a11y/announcer`), the first load
  does not; axe clean in every state.
- `count-tabs.test.tsx`: `toggleCountTab` cases; toolbar named by `label`; All pressed for `[]`; pressing a type
  calls `onValueChange` with it and All shows unpressed after rerender; unpressing the last returns `[]`; pressing All
  clears; one Tab stop; Left, Right (wrapping), Home, End move focus; names "Rank moves, 12"; a disabled item is
  focusable, shows its reason, and does not toggle; pressed classes `bg-primary text-primary-foreground`; axe clean.

They fail before because the modules do not exist.

Implementation notes: reuse `Delta` (`size="sm"`, `tip={false}` in a compact row), `formatMetricDelta`,
`formatRankChange`, `formatRelative`, `formatTime`, `formatInteger`, `Badge`, `TextLink` with `Link`, `Icon`,
`Skeleton`, `InlineError`, `EmptyState`, `Banner` (`tone="neutral" placement="region"`), `Tooltip`, `announce`;
types `ChartNotice`, `ChartError` from `@/components/app/chart/chart-frame` (type-only import). The previous ids for
`countNewItems` are kept in a ref updated after each ready render.

Commands: `infra/dev/heavy --lane medium --label wp08-feed -- bash -c 'cd apps/web && pnpm exec vitest run src/components/app/feed --maxWorkers=2'`,
LINT, TYPES, FORMAT.

Row closed: SC-16. Reviewer checklist: colour only from the formatters' tone; every state present; no live region
element created; group header 36 px; fixed slots for change and time; CountTabs keyboard and names with counts;
unknown counts never "0". Commit: `WP-08: ChangeFeed, feed rows and CountTabs`. Model: Sonnet. Parallel with T1.

### T4: generic inspector stepping (SC-22), the gallery section and the e2e flow

T4a and T4b are two subagent runs and two commits; the row closes with T4b.

#### T4a: `useInspectorStepping`

Files: `apps/web/src/lib/inspector/use-inspector-stepping.ts`, `use-inspector-stepping.test.tsx`.

Tests first (`use-inspector-stepping.test.tsx`): a harness renders `InspectorLayout`, a `div role="grid"` with a
focusable cell, and `Inspector type="domain"` fed by the hook and by `useInspector()` (the nuqs testing adapter of
`renderWithProviders`, URL `?inspect=domain:b`, order `['a','b','c']`). It asserts: `positionText` "2 of 3";
`navigation` atFirst and atLast false; pressing `j` with focus in the grid moves to `c` (URL `inspect=domain:c`),
shows "3 of 3" and announces "Domain, 3 of 3"; `j` again does not change the URL and announces "Last domain in this
list"; `k` from `a` announces "First domain in this list"; typing `j` in an `input` in the page does nothing; a
`topic` target with the same id gives `positionText` null and `onStep` undefined; a target not in `order` gives
null; `guard` receives the step and nothing moves until it runs it; Previous and Next buttons call the same path.

They fail before because the module does not exist.

Implementation notes: `useTranslations('common.inspectorStepping')` and `useTranslations('inspector')` (lib hooks
already use next-intl: `lib/runs/use-run-reason.ts`); `announce` from `@/lib/a11y/announcer`; `formatInteger`.
No `useShortcut` here (C3).

Commands: `pnpm --dir apps/web exec vitest run src/lib/inspector/use-inspector-stepping.test.tsx`, then
`infra/dev/heavy --lane medium --label wp08-inspector -- bash -c 'cd apps/web && pnpm exec vitest run src/lib/inspector src/components/app/inspector --maxWorkers=2'`,
LINT (the boundary rule must pass: no import from `components`), TYPES, FORMAT.

Reviewer checklist: no key listener in the hook; type check of the target; ends announced and inert; guard honoured;
no import outside `lib` and packages. Commit: `WP-08: generic inspector stepping`. Model: Sonnet. Parallel with T2.

#### T4b: gallery section and e2e flow

Files: `apps/web/src/components/design-system/domains-feeds-section.tsx` (replaces the stub),
`apps/web/e2e/flows/ai-app-parts-b.spec.ts` (new).

Section content: section 4.

Tests first: write `ai-app-parts-b.spec.ts` (it fails against the stub: headings missing). Unit coverage of the
section is `registry.test.tsx` (axe in both themes, every group titled).

The spec (model: `e2e/flows/ai-app-parts-a.spec.ts`, same `open`, `group`, `tabTo` helpers written locally;
`expectAccessible` from `../support`; `page.route('**/s2/favicons**', (route) => route.abort())` in `beforeEach` so no
request leaves the machine and the placeholder path is deterministic):
1. For light and dark, at 390, 768, 1024, 1280: axe clean (no serious or critical), and
   `document.documentElement.scrollWidth <= clientWidth`.
2. At 390 light: open the count popover with Enter; its bounding box is inside the viewport (left >= 0, right <=
   innerWidth, bottom <= innerHeight); Escape returns focus to the trigger.
3. Keyboard: Tab reaches the CountTabs toolbar once; Right then Space presses "Rank moves" (`aria-pressed=true`),
   All is unpressed; Home, Space presses All again.
4. Stepping: click the second row of the stepping table; the inspector shows "2 of 6"; press `j`: "3 of 6"; `k`: "2 of
   6"; focus the search input, type `j`: still "2 of 6" and the input holds "j"; step to the last row and press `j`:
   still "6 of 6".
5. Hostile group: no `script` element in the page, `window.__wp08_xss` undefined, no `a[href^="javascript:"]` or
   `a[href^="data:"]`, the long host's registrable part is visible.
6. Truncation: in the three container widths of the identity group, every `[data-slot="domain-cell"]` has
   `scrollWidth <= clientWidth` of its column box and the registrable text is visible.

Commands: TYPES and LINT (the spec is type checked), the registry test (light), then the e2e through the heavy lane:

```bash
E2E_PORT=3114 infra/dev/heavy --label wp08-e2e --wait 30 --max 40 -- \
  bash -c 'cd apps/web && pnpm exec playwright test --project=e2e e2e/flows/ai-app-parts-b.spec.ts e2e/flows/design-system.spec.ts'
```

(`lsof -nP -iTCP:3114 -sTCP:LISTEN` must print nothing first: `reuseExistingServer` is on outside CI; pick another
free port, never 3000, 3002, 3004 or 3100, if it is taken.) Then the browser check of section 4.

Row closed: SC-22 (and the gallery entries for SC-07, SC-09, SC-16). Reviewer checklist: every part shown in both
densities where it sits in a table; hostile group present; no cast in the section; e2e green; browser check notes
attached. Commit: `WP-08: gallery section and e2e flow for the app parts`. Model: Sonnet.

### T5: As built note, rebase, final checks, push (the session)

1. `docs/20-frontend-specification.md`: one blockquote "As built (AI visibility app parts B, WP-08, 2026-11-13, plan
   `docs/superpowers/plans/2026-11-13-ai-wp-08-app-parts-b.md`)" at the end of section 4.8 Table conventions (the cells
   and stepping live with the table rules; the WP-04 and WP-05 notes sit at the end of 4.6 the same way). It lists the
   files, the props of 2.1 to 2.7 in one line each, and decisions C1 to C13 that depart from DS25 (paths, `url: string`,
   no `maxChars`, neutral role badges, 36 px group header, compact and full rows, no favicon setting yet, J and K
   bound by `Inspector`), and the follow-ups F1 to F4.
2. Ask the coordinator for a lease on `docs/design-system/25-component-inventory.md` to add one "As built (WP-08)"
   line under 3.45, 8.8, 8.9, 12.2 and 15.27 (as WP-07 did). Without it, the doc 20 note is the record.
3. `git fetch origin && git rebase origin/develop`. `en.json` conflicts: keep both sides, then
   `pnpm --dir apps/web exec vitest run src/i18n/messages.test.ts`. Registry conflicts: keep every slug in order.
4. Final checks: LINT, TYPES, FORMAT (medium), then through the heavy lane, one at a time:

```bash
infra/dev/heavy --label wp08-test --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm exec vitest run --maxWorkers=3'
infra/dev/heavy --label wp08-build --wait 30 --max 30 -- bash -c 'cd apps/web && pnpm build'
```

   and the e2e command of T4b again if anything changed after it. The build's First Load JS of the product routes
   must not change (only the gallery imports the parts).
5. Final reviewer (fresh Sonnet): the whole diff `origin/develop...HEAD` against the brief's acceptance criteria, the
   four rows and this plan; opens `/design-system/domains-feeds` at 390, 768, 1024, 1280 in both themes.
6. Commit `WP-08: As built note`, `git push origin HEAD:develop` (fast-forward only; rejected means back to step 3),
   report `merged` (section 5). Model: the session; the reviewer Sonnet.

## 4. The design-system section

Slug `domains-feeds`, title "Domains, feeds and stepping", file
`apps/web/src/components/design-system/domains-feeds-section.tsx`, export `DomainsFeedsSection(): ReactNode`.
Gallery copy is exempt from the message rule (team only) but stays ASCII. Fixtures are module constants; hrefs are
`#anchor` literals (`Route` without a cast). Light and dark come from the gallery's theme control; every group is
checked in both by `registry.test.tsx` (structure) and the e2e (contrast).

| Group (`SpecimenGroup` title) | What it shows |
|---|---|
| DomainCell | Rows: own (`northwind.com`), competitor (`hubspot.com`), third party (`g2.com`), subdomain (`docs.hubspot.com`), redirect flag, no link; each with `favicon="show"`, `"hide"` and none. Three fixed-width frames (`w-40`, `w-60`, `w-80`, 160, 240 and 320 px) holding the long host, so truncation is seen at three container widths in one viewport |
| DomainRoleBadge | Own, Competitor, Third party |
| DomainChip | A list of 2, of 3, and of 5 (with "+2" and its popover) |
| URLCell | Host shown and hidden, with title, without title, long path, `inspectorHref`, invalid (`javascript:`), null with "Not cited", favicon shown; the three fixed widths again |
| In a table, Default and Compact | One `DataTable` of 6 domains (columns: Domain with `DomainCell`, Role with `DomainRoleBadge`, Top page with `URLCell`, Cited instead with `CountPopover`, Units as a number) with the table's own density control (40 and 32 px), plus a search `Input` "Filter domains"; a row opens an `Inspector type="domain"` (inside `InspectorLayout`, as `inspector-section.tsx`) whose header uses `useInspectorStepping` with the table's `onRowOrderChange` order: this is the stepping demo the e2e drives |
| CountPopover | 7 domains (5 listed, "and 2 more" as a link), 5 domains, 0 (plain text), unknown (`n/a`, plain text), with share |
| ChangeFeed | Ready (8 of 23, all three groups, a detectable decline, a detectable rise, an undetectable change, a rank entry), partial notice, stale notice, hold banner, refetching (a button toggles it, then adds 2 items: the announcement), loading, empty, error with Retry |
| FeedRow full | 4 full rows inside a day-style `section` ("Today, 4 events" in the gallery copy) |
| CountTabs | md and sm, none pressed, two pressed, one disabled with its reason, an unknown count (`n/a`) |
| Hostile input | Every `HOSTILE_HOSTS`, `HOSTILE_URLS` and `HOSTILE_TITLES` entry through `DomainCell`, `URLCell`, `DomainChipList`, `CountPopover` and one compact `FeedRow`, so the page itself is the XSS fixture for the e2e |

Browser check (T4b, the session or the T4b subagent with the Browser tools):

1. `lsof -nP -iTCP -sTCP:LISTEN | grep -E 'node|next'`: reuse a server of this worktree on 3004 if one runs (match
   the process cwd). Never kill another process.
2. Otherwise start it in the background from the worktree:
   `cd apps/web && NEXT_PUBLIC_API_MOCKING=all pnpm dev --port 3004`; take the URL from its output.
3. Open `http://localhost:3004/design-system/domains-feeds`. For 390, 768, 1024, 1280 (`resize_window`), light and
   dark (`colorScheme`, and the gallery theme control), Default and Compact (the table's density control), run in the
   page:

```js
({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  cells: [...document.querySelectorAll('[data-slot="domain-cell"],[data-slot="url-cell"]')]
    .filter((n) => n.scrollWidth > n.clientWidth + 1).length,
  rowHeights: [...new Set([...document.querySelectorAll('[role="row"]')].map((r) => Math.round(r.getBoundingClientRect().height)))],
});
```

   Expect `overflow` 0, `cells` 0 (truncation is by ellipsis inside, never spilling), row heights 40 and 32 for the
   two densities. Open the count popover at 390 and run
   `(() => { const r = document.querySelector('[data-slot="popover"]').getBoundingClientRect(); return [r.left, r.right, innerWidth, r.bottom, innerHeight]; })()`:
   inside the viewport. Hover the long host: the tooltip shows the full host. Take one screenshot per width and theme
   and look at it (alignment of the count and time slots, the placeholder square, the pressed CountTabs).
4. Stop the server (`preview_stop` or the background shell), then remove the files the dev server writes:
   `git status --porcelain apps/web/AGENTS.md apps/web/CLAUDE.md` must show `??` (untracked) before
   `rm apps/web/AGENTS.md apps/web/CLAUDE.md`; never commit them.
5. Reset the Browser pane viewport to `desktop`.

## 5. Status line

Format, at start (`planning`), plan committed (`building`), every push to develop, review start (`review`), blocked
(`blocked`), done (`merged`):

```text
WP-08 <status> | branch ai/wp-08-app-parts-b @ <short sha> | rows done n/4 | steps n/6 | blockers: <none or list> | next: <one line>
```

Write it with `infra/dev/wp-status WP-08 <status> "<note>" --rows n/4 --tasks n/6 --blockers "<...>" --next "<...>"`
(the script names the field `tasks`) and send the same line, with `steps`, to the coordinator with SendMessage to
`local_9ebe99ff-3b99-4536-b3f5-3b1701a264ad`. Rows count when their task is pushed: SC-07 after T1, SC-09 after T2,
SC-16 after T3, SC-22 after T4b. Steps count T0 to T5.

## 6. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Layout bugs (truncation, slot alignment, popover placement) show only in a real browser; jsdom has no layout (WP-04 and WP-05 lesson) | Fixed-width slots (favicon 16 px, count `w-16`, time `w-12`); three container widths in the gallery; the browser check measures with JS; the e2e measures overflow and the popover box |
| R2 | The subdomain prefix and the registrable part compete for width; a long registrable alone can still overflow a 160 px column | Prefix shrinks first (`shrink-100`), registrable truncates last, the tooltip and `sr-only` text carry the full host; checked at 160 px |
| R3 | Favicons: an outbound request per domain, a privacy leak, slow e2e, a 16 px placeholder globe read as an icon | Only with `favicon="show"` (the caller's setting, domain-first tables); `loading="lazy"`, `no-referrer`, no request for refused hosts, `FAVICON_MIN_WIDTH` rule; e2e aborts the endpoint |
| R4 | Hostile data: markup in titles, script schemes in URLs, bidi overrides, homographs | React text only; `webHref` gate on every href; `visibleUrlText`; `dir="ltr"` and `bdi`; punycode shown; one fixture file used by every test and by the gallery the e2e reads |
| R5 | J and K firing twice, or while typing | The hook binds no keys; `Inspector`'s `useShortcut` already scopes and filters; the hook test proves single steps and the input case |
| R6 | Shared files: `en.json`, `registry.ts`, `section-slugs.ts`, `registry.test.tsx` collide with other sessions | All edits in the early T0 push; the registry lease stays with WP-08; on conflict keep both sides and rerun `messages.test.ts` and `registry.test.tsx` |
| R7 | Three screens keep their own stepping and rankings keeps `PathText`: two ways to do the same thing | Recorded as follow-ups F2 and F4 in the As built note; the coordinator schedules them under leases; nothing here edits a feature |
| R8 | Base UI Popover focus behaviour inside a DataTable cell (F2 navigation mode) | Trigger carries `CELL_CONTROL`; tests check focus moves in and back; the e2e opens it from the keyboard |
| R9 | `CountTabs` styling diverges from the `Button` toggle style that `EventTimeline` uses | Deliberate (C8, DS 3.45); follow-up F3 |
| R10 | Heavy lane queueing delays the final checks | Run only targeted tests during tasks; the full suite and build once, in T5, through `infra/dev/heavy` with `--wait 30` |
| R11 | `exactOptionalPropertyTypes` style errors in tests and the gallery | `| undefined` on every optional prop, as `PopoverProps`; TYPES after every task |
| R12 | The dev server writes `apps/web/AGENTS.md` and `CLAUDE.md` | Removed after stopping the server, checked untracked first, never staged |

Follow-ups for the coordinator: F1 "Show favicons" project setting (API field, settings switch, then callers pass
it). F2 move `features/prompts`, `features/rankings`, `features/operations` and `design-system/inspector-section.tsx`
stepping onto `useInspectorStepping`. F3 `EventTimeline` filter onto `CountTabs`. F4 rankings' Ranking URL cell onto
`URLCell`.
