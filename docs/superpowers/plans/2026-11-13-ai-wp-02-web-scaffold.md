# WP-02 web scaffolding: task plan

Brief: [docs/ai-visibility/work-packages/WP-02-web-scaffold.md](../../ai-visibility/work-packages/WP-02-web-scaffold.md).
Master plan: [docs/ai-visibility/MASTER-PLAN.md](../../ai-visibility/MASTER-PLAN.md) sections 2 (D-16), 3.4, 3.6, 3.7.
Worktree: `.claude/worktrees/ai-wp-02-web-scaffold-ca73e6`, branch `claude/ai-wp-02-web-scaffold-ca73e6`, based on
`origin/develop` at `5f4d0dbc`. Every fact below was read from the code at that commit.

## 1. Header

### Goal

Touch every web hot spot of the AI visibility programme once, so later packages add files instead of editing shared
ones: route files for every planned page (each the 404 page until its package flips it live), the navigation registry
pinned in its test, five extension seams in `features/prompts/seams/`, the shared code moved out of feature folders
(rate and strip models, `InsufficientPill`, the XLSX writer, `FileDropzone`), one message namespace and one mock
handler module per package, and the dnd-kit dependencies, so `pnpm-lock.yaml` changes once.

### Scope

| Area | Files |
|---|---|
| Routes | 10 new `page.tsx` files under `apps/web/src/app/[workspace]/[project]/` (T1) |
| Navigation | `apps/web/src/lib/navigation/registry.test.ts` only; `registry.ts` already holds all 16 entries, the 10 unbuilt ones `planned` (T1) |
| Seams | `apps/web/src/features/prompts/seams/` (new) and seam wiring in `prompts-screen.tsx`, `prompt-inspector.tsx`, `topic-inspector.tsx` (T2) |
| Moves | `apps/web/src/lib/rates/`, `apps/web/src/lib/export/`, `apps/web/src/components/app/metric/insufficient-pill.tsx`, `apps/web/src/components/app/forms/file-dropzone.tsx` (T3) |
| Catalog and mocks | namespaces in `apps/web/messages/en.json`; `apps/web/src/mocks/handlers/<slug>.ts` and `index.ts` (T4) |
| Dependencies | `apps/web/package.json`, `pnpm-lock.yaml` (T5) |
| Mock wording | `apps/web/src/mocks/handlers/schedules.ts`, `schedules.test.ts` (T6) |
| Docs | `docs/20-frontend-specification.md` As built notes (T7) |

Files outside the brief's owned list that the moves and the seam wiring must edit (import lines, or the one call that
routes built-in items through a seam). Wave 0 runs before their owners start, so no lease is needed; the coordinator
should record them as touched by WP-02:

- `features/prompts/use-prompt-actions.tsx` (row menu and bulk bar through the actions seam), `prompt-columns.tsx`
  (columns seam), `prompt-model.ts` and `prompt-model.test.ts` (tab constants and moved helpers leave), `topics-table.tsx`,
  `rate-columns.tsx`, `rate-view.tsx`, `rate-view.test.tsx`, `inspector-strip.tsx`, `prompts-strip.tsx`, `export-rows.ts`,
  `trend-model.ts` (import lines only)
- `features/rankings/rankings-screen.tsx`, `features/rankings/export/export-model.ts`,
  `features/rankings/import/upload-step.tsx` (import lines only)

### Not touched (the brief's must-not-touch list, checked)

- Any file another package owns; `backend/` entirely; `backend/openapi/v1.json`; `apps/web/src/lib/api/schema.ts`
- `apps/web/e2e/support.ts` (section 6 below); `apps/web/e2e/flows/ai-prompts.spec.ts`
- `apps/web/src/lib/layouts/` (owned by WP-15; see decision 8)
- `apps/web/src/features/settings/settings-frame.tsx` (decision 9)
- `docs/ai-visibility/tracker.json`, `TRACKER.md`; the main checkout, `.claude/worktrees/release`, Colima, `idraft-dev-*`

### Contradictions and open points, each with the decision taken

| # | Found | Decision and why |
|---|---|---|
| 1 | Brief step 1 lists 9 routes; MASTER-PLAN 3.4 lists 10 with `/matrix` (WP-65). The brief's owned list says "every new route file of MASTER-PLAN 3.4", and WP-65 owns `app/[workspace]/[project]/matrix/`. | Create all 10, `/matrix` included. The registry already has `matrix` planned, so the route file is the only missing piece. |
| 2 | "Cadence wording fix in the mocks (twice a week, RM risk 1)". The mocks already model the owner's decision: two `ai_prompt` schedules, `cadence: 'weekly'` on Monday (1) and Thursday (4) (`handlers/prompts.ts` `AI_SCHEDULE_RUNS`, `ai-runs.ts`), exactly as the backend does (`backend/src/idraft/ai/schedule.py`: "twice a week is two weekly schedules"). `en.json` already says "twice a week" everywhere. `'weekly'` is the API's `cadence` enum value and must stay. What still reads as a weekly promise: the comment at `handlers/schedules.ts` lines 89 and 90 ("on the standard queue, weekly, and as many schedules as the base plan has runs a week"), the `describe` title at `handlers/schedules.test.ts` line 307 ("the base plan: weekly, two a project") and the `it` title at line 316 ("runs weekly only, on a create and on a change"). | T6 rewrites those three texts to say twice a week as two weekly schedules. No value, no enum, no copy in `en.json` changes. |
| 3 | The brief moves "the CSV writer" to `lib/export`; it already lives in `lib/csv/csv-write.ts` and is shared by Rankings and Prompts (SC-17's own "Exists today" column says so). | Leave `lib/csv` where it is. `lib/export` receives only the XLSX writer (`export-file.ts`), its colors (`export-colors.ts`) and the four generic export types; it imports `csvBlob` from `lib/csv`. |
| 4 | Namespace list: `prompts.add` and `prompts.topicDrawer` already exist with copy (used by `add-prompts-dialog.tsx` and `topic-inspector.tsx`). A top-level `evidence` namespace exists too (`components/app/evidence`); the new `prompts.evidence` is a different object. | Do not recreate `prompts.add` or `prompts.topicDrawer`: they stay as they are and belong to WP-27 and WP-20. Create the other 12 under `prompts` and the 14 top-level ones. |
| 5 | The brief names branch `ai/wp-02-web-scaffold` in `.claude/worktrees/wp-02` made by `infra/dev/wp-start`. This session runs in `.claude/worktrees/ai-wp-02-web-scaffold-ca73e6` on `claude/ai-wp-02-web-scaffold-ca73e6`. `infra/dev/wp-start`, `infra/dev/wp-status` and `infra/dev/heavy` are not on `origin/develop` (only `infra/dev/health-watch.sh`). | Work in this worktree and branch; the status line names this branch. Run `infra/dev/wp-status` only once it exists; until then send the status line to the coordinator only. Heavy checks per section 7. |
| 6 | WB-NAV-01 ("AI Visibility" with four children) cannot reach BUILT in WP-02: three of the four children stay `planned` until WP-33, WP-21 and WP-61 flip them. | WP-02 delivers the scaffold (route files exist, flipping is one line in `registry.ts` and one in its test). Report the row as "scaffolded, closes at the last flip" and let the coordinator decide whether the tracker counts it. Status line counts rows done as 3/4 plus that note. |
| 7 | SC-12 is "Shared FileDropzone and CSV parse with preview". The parse is already shared (`lib/csv/csv.ts` `parseCsv`, `lib/csv/csv-head.ts` `readCsvHead`); the preview table is a surface of the prompt import (WB-TPH-10, WB-TPH-11, WP-28). | WP-02 moves `FileDropzone` and closes SC-12 for the shared parts; the preview is WP-28's. Say so in the report. |
| 8 | D-16 (screen key `inspector.topic`, default Yes) lists WP-02 and WP-20. `ScreenKey` is `'overview' \| 'inspector.keyword'` (`lib/layouts/types.ts` line 13) and `SCREENS` is a `Record<ScreenKey, ScreenDefinition>` (`lib/layouts/catalog.ts` line 328), so a new key needs its built-in card list, which is WP-20's card types. `lib/layouts` belongs to WP-15, and WB-LAY-02 says screen keys are added "with each screen". | WP-02 does not pre-register `inspector.topic`. WP-20 adds the key, its built-in cards and the card types together; it holds the `topic-inspector.tsx` lease in wave 2, so it can turn the built-in Overview tab into a layout grid there. The topic tab seam (T2) keeps the built-in tabs inside `topic-inspector.tsx` for exactly that reason. |
| 9 | `/settings/alert-rules` (WP-48) and `/settings/retention` (WP-31) are not navigation destinations: Settings lists its sections in `features/settings/settings-frame.tsx` (`PROJECT` constant, line 26), which no package owns. | WP-02 creates the two route files and leaves `settings-frame.tsx` alone (an unbuilt section is absent, as its comment says). WP-48 and WP-31 each need a lease on `settings-frame.tsx` and its test to add their section when it goes live. Raise with the coordinator. |
| 10 | `handlersFor('pending')` returns only `pendingHandlers` (`mocks/handlers/index.ts`). | New package modules are registered in `handlers` (mode `all`) only, which is the mode the acceptance criteria name (`NEXT_PUBLIC_API_MOCKING=all`). A package that wants its mock in `pending` mode raises it; not needed now. |
| 11 | The worktree has no `apps/web/node_modules` yet. | T1 starts with `pnpm install --frozen-lockfile` from the repository root. |

## 2. Seam interfaces

### Design in one paragraph

Every seam is a `.ts` file with a type, an entries array that later packages fill, and one pure function that merges
the screen's built-in items with the entries. The built-in tabs, actions and columns stay produced where they are
today (their bodies close over hook state, local JSX and dialogs that a static registry cannot own), but the screen
renders the merged list only, through the seam's function. So built-ins and later entries share one type, one order
rule and one availability rule, the screens render nothing outside the seam, and nothing visible changes while every
entries array is empty. Consumers pass the entries constant explicitly (no default parameter): a default would read
the module's own binding, which `vi.mock` in a test cannot replace, and the wiring test needs to.

The `?itab=` value is resolved by the inspector from the tabs it shows (`chosenTab`), not parsed against a fixed list.
That is what lets a later tab work from a link, and it makes `PROMPT_TABS`, `PromptTab`, `parsePromptTab`,
`TOPIC_TABS` and `parseTopicTab` in `prompt-model.ts` unnecessary: they are deleted. `TopicTab` stays as
`export type TopicTab = string;` with a comment, so `topics-table.tsx` and `TopicOrigin` keep their imports.

### The pre-created import line convention

Each seam file has, right after its real imports, one commented block per later package, and one commented slot per
package in its entries array. The `// WP-NN slug` line is never edited, so two packages filling neighbouring slots
never change neighbouring lines (git merges changes separated by one unchanged line):

```ts
// Entries of later packages (MASTER-PLAN 3.4). A package uncomments its own import line and its own slot line and
// edits nothing else in this file; the "WP-NN" line above each stays as it is.

// WP-21 citations-core
// import { citationsTab } from '../inspector/citations/citations-tab';

// WP-24 fanout-views
// import { fanoutTab } from '../inspector/fanout/fanout-tab';

export const PROMPT_TAB_ENTRIES: readonly PromptInspectorTab[] = [
  // WP-21 citations-core (after: 'history')
  // citationsTab,
  // WP-24 fanout-views (after: 'competitors', available while an enabled engine exposes fan-out)
  // fanoutTab,
];
```

The entry itself lives in the package's own folder and is exported from there. The slots WP-02 pre-creates:

| Seam | Slots (package, entry name, where it goes) |
|---|---|
| `inspector-tabs.ts` | WP-21 `citationsTab` after `history`; WP-24 `fanoutTab` after `competitors`, with `available` |
| `topic-tabs.ts` | WP-20 `topicCompetitorsTab` and `topicRelatedTab` (end); WP-23 fills the competitors content inside WP-20's tab from `features/prompts/inspector/competitors/` |
| `actions.ts` | WP-17 `copyLinkAction` (WB-MNU-08); WP-27 `addPromptForTopicsAction` (WB-BLK-09); WP-29 `editDetailsAction`, `bulkEditAction`, `restoreAction` (WB-MNU-05, WB-BLK-11, WB-BLK-12); WP-41 `editTextAction` (WB-MNU-06); WP-43 `addToPanelAction` (WB-BLK-10); WP-52 `openPageAction` (WB-MNU-07) |
| `columns.ts` | WP-19 `compareColumns` (WB-PRM-12); WP-23 `topCompetitorColumn` (WB-PRM-13); WP-24 `fanoutColumn` (WB-PRM-18); WP-41 `versionColumns` (WB-PRM-21, WB-PRM-34); WP-43 `panelColumns` (WB-PRM-04, WB-PRM-22); WP-44 `linkColumns` (WB-PRM-20); WP-55 `recommendationColumns` (WB-PRM-10); WP-59 `volatilityColumn` (WB-PRM-19); WP-65 `aiOverviewColumn` (WB-PRM-24) |
| `toolbar.ts` | WP-27 `limitsMeter` (WB-TPH-14, WB-TPH-18); WP-28 `importEntry` (WB-TPH-10, WB-TPH-11); WP-43 `panelsEntry` (WB-TPH-05, WB-TPH-16); WP-44 `generateEntry` (WB-TPH-12); WP-49 `savedViewsEntry` (WB-TPH-06) |

A package missing from this table that needs a slot asks the coordinator for a lease on the seam file and adds its
own slot in the same form. Packages that hold a consumer file's lease in wave 2 (WP-17 `prompts-screen.tsx`, WP-25
`prompt-inspector.tsx`, WP-20 `topic-inspector.tsx`) may still use a slot instead of editing the screen.

### `seams/shared.ts`

```ts
import type { useTranslations } from 'next-intl';

/** The catalog's translator at its root: an entry of any package names its own keys in full ("prompts.fanout.tab"). */
export type Translate = ReturnType<typeof useTranslations<never>>;

/** Throws when two ids repeat: a menu, a tab row or a column chooser keys its items by id. */
export function assertUniqueIds(ids: readonly string[], what: string): void;

/**
 * `base` with the items of each insertion after the item `after` names (an item an earlier insertion placed
 * included), or at the end without `after`. Two insertions after the same id keep their order. Throws when `after`
 * names no item, or when the result repeats an id, so a bad entry fails its own package's test instead of hiding a
 * tab or a column.
 */
export function placeAfter<T>(
  base: readonly T[],
  insertions: readonly { after?: string | undefined; items: readonly T[] }[],
  idOf: (item: T) => string,
): T[];

/** The tab the address asks for when it is one of `tabs`, else the first one (Latest, Overview). */
export function chosenTab(tabs: readonly { id: string }[], requested: string): string;
```

`useTranslations<never>` is the root translator (its type parameter defaults to `never` in use-intl 4.14.8,
`useTranslations.d.ts` line 12). Verify with `pnpm typecheck`; there is no `any` and no cast anywhere in the seams.

### `seams/inspector-tabs.ts`

```ts
import type { ReactNode } from 'react';

import type { PromptAnswers, PromptCounts } from '../inspector-reads';
import type { DateRange } from '../prompt-model';
import type { PromptScope } from '../prompt-queries';
import { placeAfter, type Translate } from './shared';
import type { ProjectEngine, Prompt } from '@/lib/api/types';

/** What the inspector lends a tab: the prompt, its window, its engines and the reads the built-in tabs share. */
export interface PromptTabContext {
  scope: PromptScope;
  promptId: string;
  /** `null` while it loads, and for an id that is no prompt's. */
  prompt: Prompt | null;
  /** The id is a prompt's (well formed and not refused): a tab may read by it. */
  exists: boolean;
  range: DateRange;
  timeZone: string;
  /** The enabled engines, in order. */
  engines: readonly ProjectEngine[];
  /** An engine's label by its code, an engine turned off included. */
  labelOf: (engineCode: string) => string;
  counts: PromptCounts;
  /** The window's answers: read only while History or Competitors is shown. A tab that needs them reads its own. */
  answers: PromptAnswers;
  noCountsReason: string;
  onOpenAnswer: ((observationId: string, observedAt: string) => void) | undefined;
}

export interface PromptInspectorTab {
  /** The `?itab=` value. */
  id: string;
  label: (t: Translate) => string;
  /** Placed after this tab; last without one. */
  after?: string | undefined;
  /** Offered only while this holds (Fan-out); always without one. */
  available?: ((context: PromptTabContext) => boolean) | undefined;
  /** The panel's content: an element whose hooks run inside it. It calls no hook itself. */
  render: (context: PromptTabContext) => ReactNode;
}

export const PROMPT_TAB_ENTRIES: readonly PromptInspectorTab[] = [/* slots, see the convention */];

/** The tabs to show, in order: `builtIns` with `entries` placed, those not available to `context` left out. */
export function promptTabs(
  builtIns: readonly PromptInspectorTab[],
  entries: readonly PromptInspectorTab[],
  context: PromptTabContext,
): PromptInspectorTab[];
```

`promptTabs` places first, then filters by `available`, so an entry placed after an unavailable entry still finds its
anchor.

How `prompt-inspector.tsx` consumes it (seam wiring only):

- Delete `TAB_LABEL` (lines 58 to 64) and the `PROMPT_TABS`, `PromptTab` imports from `./prompt-model`.
- `PromptInspectorProps.tab` becomes `string` (the raw `?itab=`), `onTabChange: (tab: string) => void`.
- Add `const root = useTranslations();` and build `context: PromptTabContext` from the values the component already
  has (`promptAnswers`, `countsReason`, `labelOf`, `isPromptId(promptId) && !notFound`).
- The four built-ins become a `PromptInspectorTab[]` inside the component, in today's order, each `render` returning
  today's JSX unchanged (Latest keeps the Facts `InspectorSection` as its child):
  `{ id: 'latest', label: (t) => t('prompts.inspector.tabLatest'), render: () => <InspectorLatest ...>...</InspectorLatest> }`, and so on for `history`, `competitors`, `stats`.
- `const tabs = promptTabs(builtIns, PROMPT_TAB_ENTRIES, context); const current = chosenTab(tabs, tab);`
- The answers query keeps its rule but on `current`: `enabled: ... && (current === 'history' || current === 'competitors')`.
- `<InspectorTabs<string> value={current} items={tabs.map((entry) => ({ value: entry.id, label: entry.label(root) }))}>`
  with `tabs.map((entry) => <InspectorPanel<string> key={entry.id} value={entry.id}>{entry.render(context)}</InspectorPanel>)`.
- `moreActions`: see the actions seam below.

`prompts-screen.tsx` passes `tab={inspector.tab}` instead of `parsePromptTab(inspector.tab)` (line 1014) and keeps its
`onTabChange` (Latest is still written as the default tab). Behaviour is unchanged: `'overview'` and `'prompts'`
resolve to Latest exactly as `parsePromptTab` did (asserted in `prompt-model.test.ts` lines 670 to 677, which move to
the seam test).

### `seams/topic-tabs.ts`

```ts
import type { ReactNode } from 'react';

import type { TopicDescendants } from '../prompt-model';
import type { TopicCounts } from '../topic-inspector';
import { placeAfter, type Translate } from './shared';
import type { ProjectEngine, PromptsSummary } from '@/lib/api/types';

/** What the topic drawer lends a tab. */
export interface TopicTabContext {
  /** The term id, or `NO_TOPIC` for the prompts without one. */
  topicKey: string;
  summary: PromptsSummary | undefined;
  counts: TopicCounts;
  /** The engines the page shows, in order. */
  engines: readonly ProjectEngine[];
  descendants: TopicDescendants;
  onOpenPrompt: (promptId: string) => void;
}

export interface TopicInspectorTab {
  id: string;
  label: (t: Translate) => string;
  after?: string | undefined;
  available?: ((context: TopicTabContext) => boolean) | undefined;
  render: (context: TopicTabContext) => ReactNode;
}

export const TOPIC_TAB_ENTRIES: readonly TopicInspectorTab[] = [/* WP-20 slots */];

export function topicTabs(
  builtIns: readonly TopicInspectorTab[],
  entries: readonly TopicInspectorTab[],
  context: TopicTabContext,
): TopicInspectorTab[];
```

`TopicDescendants` stays in `prompt-model.ts` (T3 keeps it there). The type-only imports of `TopicDescendants` and
`TopicCounts` are erased at build (`verbatimModuleSyntax`), so they make no runtime cycle.

How `topic-inspector.tsx` consumes it: `TopicInspectorProps.tab` becomes `string`; the two built-ins become
`[{ id: 'overview', label: (t) => t('prompts.topicDrawer.tabOverview'), render: () => overview }, { id: 'prompts', label: (t) => t('prompts.topicDrawer.tabPrompts'), render: () => promptsPanel }]`
where `overview` and `promptsPanel` are today's panel children unchanged; then `topicTabs(...)`, `chosenTab(...)` and
the same `InspectorTabs` mapping as the prompt inspector. The `TOPIC_TABS` import goes. The "missing topic" branch
(no tabs) stays as it is.

`prompts-screen.tsx`: `const topicTab = inspector.tab;` replaces `parseTopicTab(inspector.tab)` (line 441); the rest
of its uses (`setPromptFrom`, `openTopicDrawer`, the topic badge) already take a string.

### `seams/actions.ts`

```ts
import type { PromptAction } from '../prompt-action';
import type { PromptScope } from '../prompt-queries';
import { assertUniqueIds, type Translate } from './shared';
import type { MenuItemDef } from '@/components/ui/menu';
import type { Prompt } from '@/lib/api/types';
import { can, type Permission } from '@/lib/permissions/permissions';

/** Where an action is offered: a prompt's row menu, a topic's row menu, the bulk bar, the prompt inspector's More. */
export type PromptActionSurface = 'promptRow' | 'topicRow' | 'bulk' | 'inspectorMore';

/** What an entry acts on, and what the screen lends it. */
export interface PromptActionContext {
  surface: PromptActionSurface;
  scope: PromptScope;
  /** One for a prompt row and the inspector, a topic's prompts, or the chosen prompts, in the table's order. */
  promptIds: readonly string[];
  /** Those of `promptIds` the screen has read (a topic's may be missing while the list loads). */
  prompts: readonly Prompt[];
  /** The topic of a topic row; `null` on the other surfaces. */
  topicKey: string | null;
  /** Why the built-in Run now and Archive wait (`bulk.busy`); `null` when nothing runs, and in the inspector. */
  busyReason: string | null;
  t: Translate;
}

export interface PromptActionEntry {
  /** Unique, and none of the built-in ids of `BUILT_IN_ACTION_IDS`. */
  id: string;
  surfaces: readonly PromptActionSurface[];
  /** What the role needs; `null` for every member. Without it the entry is absent, not disabled (20 section 3.9). */
  permission: Permission | null;
  /** The action bound to the context, or `null` where it does not apply (an archived prompt, nothing read yet). */
  build: (context: PromptActionContext) => PromptAction | null;
}

/** The ids the screens use for their own items today. */
export const BUILT_IN_ACTION_IDS = ['open', 'show-in-prompts', 'run-now', 'add-prompt', 'copy', 'export', 'archive'] as const;

export const PROMPT_ACTION_ENTRIES: readonly PromptActionEntry[] = [/* slots */];

/**
 * `builtIns`, then the entries offered on `context.surface` that the role may use, built for the context. The
 * tables sort by group (`GROUP_ORDER` in data-table.tsx, `ORDER` in bulk-action-bar.tsx, both stable), so an entry
 * lands after the built-ins of its group. Throws on a repeated id.
 */
export function withActionEntries(
  builtIns: readonly PromptAction[],
  entries: readonly PromptActionEntry[],
  context: PromptActionContext,
  permissions: readonly string[],
): PromptAction[];

/**
 * Actions as items of a `Menu` (the inspector's More): no `group`, which a `Menu` turns into a section of its own,
 * the destructive tone kept, a `null` reason dropped.
 */
export function asMenuItems(actions: readonly PromptAction[]): MenuItemDef[];
```

Consumers:

- `use-prompt-actions.tsx`: `bar(ids)` returns `withActionEntries(builtIns, PROMPT_ACTION_ENTRIES, { surface: 'bulk', ... }, permissions)`
  and `forPrompt(promptId, open)` the same with `surface: 'promptRow'`, where `builtIns` is today's array unchanged,
  `permissions` is `useMembership().permissions` and `t` is `useTranslations()` (root). `prompts` comes from
  `rowsOf(ids)` mapped to `row.prompt`.
- `prompts-screen.tsx` `topicMenu` (lines 516 to 582): the topic branch returns
  `withActionEntries([...today's items], PROMPT_ACTION_ENTRIES, { surface: 'topicRow', topicKey: target.key, promptIds: target.promptIds, ... }, permissions)`;
  the prompt branch already goes through `actions.forPrompt`.
- `prompt-inspector.tsx`: `moreActions: [...builtInMore, ...asMenuItems(withActionEntries([], PROMPT_ACTION_ENTRIES, { surface: 'inspectorMore', promptIds: [promptId], prompts: prompt === null ? [] : [prompt], topicKey: null, busyReason: null, ... }, permissions))]`,
  where `builtInMore` is today's `canWrite && prompt?.is_active === true ? [archiveAction] : []`. The built-in Archive
  stays a `MenuItemDef` with no group, so the menu draws exactly as today.

### `seams/columns.ts`

```ts
import type { PromptRow } from '../prompt-columns';
import type { RateMetric } from '../prompt-model';
import { placeAfter, type Translate } from './shared';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { ProjectEngine } from '@/lib/api/types';

export interface PromptColumnContext {
  /** The engines shown, in order. */
  engines: readonly ProjectEngine[];
  /** The metric of the engine columns (`?metric=`). */
  metric: RateMetric;
  t: Translate;
  locale: string;
}

export interface PromptColumnEntry {
  /** The entry's own id; its columns carry their own ids, unique in the table. */
  id: string;
  /** The column its columns follow (a built-in id of `SORT_ID` or an engine column id); last without one. */
  after?: string | undefined;
  /** The columns, `defaultVisible: false` for the chooser. Pure: no hook, called inside `usePromptColumns`' memo. */
  build: (context: PromptColumnContext) => readonly DataTableColumn<PromptRow>[];
}

export const PROMPT_COLUMN_ENTRIES: readonly PromptColumnEntry[] = [/* slots */];

export function withColumnEntries(
  builtIns: readonly DataTableColumn<PromptRow>[],
  entries: readonly PromptColumnEntry[],
  context: PromptColumnContext,
): DataTableColumn<PromptRow>[];
```

Consumer `prompt-columns.tsx` `usePromptColumns`: add `const root = useTranslations();`, and inside the existing
`useMemo` replace `columns` with `withColumnEntries(builtIn, PROMPT_COLUMN_ENTRIES, { engines, metric, t: root, locale })`
before `sortFields` is computed, so an entry's sortable column is a valid `?sort=` id. Add `engines`, `metric` and
`root` to the memo's dependencies. The Topics table is not a seam: its columns stay with WP-18 (`topics-table.tsx`).

### `seams/toolbar.ts`

```ts
import type { ReactNode } from 'react';

import type { PromptScope } from '../prompt-queries';
import type { PromptsProject } from '../prompts-screen';
import { assertUniqueIds, type Translate } from './shared';
import type { MenuItemDef } from '@/components/ui/menu';
import { can, type Permission } from '@/lib/permissions/permissions';

export interface PromptsToolbarContext {
  scope: PromptScope;
  project: PromptsProject;
  t: Translate;
}

/** `more`: an item of the header's More actions menu, after Copy link. `actions`: a control before More actions. */
export type PromptsToolbarEntry =
  | { id: string; slot: 'more'; permission: Permission | null; item: (context: PromptsToolbarContext) => MenuItemDef | null }
  | { id: string; slot: 'actions'; permission: Permission | null; render: (context: PromptsToolbarContext) => ReactNode };

/** The ids the header uses itself. */
export const BUILT_IN_TOOLBAR_IDS = ['copy-link', 'add-prompts'] as const;

export const PROMPTS_TOOLBAR_ENTRIES: readonly PromptsToolbarEntry[] = [/* slots */];

export interface PromptsToolbarItems {
  more: MenuItemDef[];
  actions: { id: string; node: ReactNode }[];
}

/** The entries the role may use, by slot, in order. Throws on a repeated id or a built-in one. */
export function promptsToolbarItems(
  entries: readonly PromptsToolbarEntry[],
  context: PromptsToolbarContext,
  permissions: readonly string[],
): PromptsToolbarItems;
```

Consumer `prompts-screen.tsx`: `const extras = promptsToolbarItems(PROMPTS_TOOLBAR_ENTRIES, { scope, project, t: root }, permissions);`
`moreMenu` items become `[{ id: COPY_LINK, ... }, ...extras.more]`; in the toolbar's right cluster (line 794) render
`extras.actions.map(({ id, node }) => <Fragment key={id}>{node}</Fragment>)` before `{moreMenu}`. In the empty states
(line 1079) `actions` gets the extras before `headerAdd`, and stays `undefined` when both are empty, so no wrapper is
drawn that is not drawn today. Add prompts stays where it is: it is the page's primary action and needs the screen's
dialog state.

## 3. Tasks

Every implementer is a fresh subagent for one task, writes the tests first, edits files only with the file tools
(moves with `git mv`, then Edit; never heredocs, `sed` or replace scripts), and stages only its own files. After each
task a fresh Sonnet reviewer reads this plan, the task and the diff, runs the task's commands and returns PASS or a
numbered fix list. Commands run from `apps/web` unless a line says otherwise. House rules for every reviewer: tokens
and `type-*` utilities only, numbers through `@/lib/format`, ASCII copy with no em-dash or en-dash anywhere (comments
included: `src/test/source-text.test.ts` reads every file), strict types, no `any`, no cast, explicit return types.

### Schedule (at most two subagents at once)

| Wave | Runs | Why they can pair |
|---|---|---|
| A | T1 and T2 | T1 touches `src/app/**` and `lib/navigation/registry.test.ts`; T2 touches `features/prompts/**` only |
| B | T3 and T6 | T3 touches `lib/rates`, `lib/export`, `components/app`, `features/prompts`, `features/rankings`, `messages/en.json`; T6 touches `mocks/handlers/schedules.ts` and its test |
| C | T4 | T4 edits `messages/en.json`, which T3 also edits |
| D | T5 alone | `pnpm add` rewrites `node_modules` under any test or type check running beside it |
| E | T7 | the session itself, with the end reviewer |

In a paired wave each implementer runs only its own vitest paths, eslint and prettier on its own files; the session
runs `pnpm typecheck` once both are done, before either commits (a half done neighbour would fail the other's type
check). Until `infra/dev/heavy` exists, run commands directly and keep vitest to the task's paths with
`--maxWorkers=2`; once it exists, `pnpm typecheck` and `pnpm lint` go through `infra/dev/heavy --lane medium --`.

### T1: route files for the planned pages (brief step 1)

- Model: Sonnet implementer. Wave A, beside T2.
- Goal: each planned page has its route file, which is the 404 page inside the shell until its package flips its
  navigation entry; the registry test pins which entries are planned.
- First, from the repository root: `pnpm install --frozen-lockfile`.
- Files created (each a re-export of the project's catch-all, the behaviour these paths have today):

| Route | File (under `apps/web/src/app/[workspace]/[project]/`) | Re-export path | Owner |
|---|---|---|---|
| `/ai` | `ai/page.tsx` | `'../[...rest]/page'` | WP-33 |
| `/ai/citations` | `ai/citations/page.tsx` | `'../../[...rest]/page'` | WP-21 |
| `/ai/sources` | `ai/sources/page.tsx` | `'../../[...rest]/page'` | WP-61 |
| `/ai/prompts/[promptId]` | `ai/prompts/[promptId]/page.tsx` | `'../../../[...rest]/page'` | WP-52 |
| `/competitors` | `competitors/page.tsx` | `'../[...rest]/page'` | WP-39 |
| `/discover/[tab]` | `discover/[tab]/page.tsx` | `'../../[...rest]/page'` | WP-46 |
| `/reports` | `reports/page.tsx` | `'../[...rest]/page'` | WP-51 |
| `/settings/alert-rules` | `settings/alert-rules/page.tsx` | `'../../[...rest]/page'` | WP-48 |
| `/settings/retention` | `settings/retention/page.tsx` | `'../../[...rest]/page'` | WP-31 |
| `/matrix` | `matrix/page.tsx` | `'../[...rest]/page'` | WP-65 |

  Each file is two lines: a comment naming the page, its owner and that the owner replaces the file when it flips
  `<key>` to `live` in `lib/navigation/registry.ts`, then `export { default, generateMetadata } from '<path>';`.
  If `next typegen` or `next build` refuses a re-exported page, fall back to the catch-all's own body (the
  `generateMetadata` reading `errors.notFound` and a default export `(): never` calling `notFound()`), one copy per file.
- Files modified: `apps/web/src/lib/navigation/registry.test.ts`. `registry.ts` is not changed: all 16 entries exist,
  and `aiOverview`, `citations`, `sources`, `competitors`, `discover`, `reports`, `matrix` are already `planned`.
- Tests first:
  - `apps/web/src/app/[workspace]/[project]/planned-routes.test.ts` (new): for each of the 10 modules (dynamic
    `import('./ai/citations/page')` and so on), the default export throws the mocked `notFound` error and
    `generateMetadata()` resolves to `{ title: 'title' }`. Mock `next/navigation` and `next-intl/server` exactly as
    `ai/prompts/page.test.tsx` does. Fails before implementation: the modules do not exist.
  - `registry.test.ts`, two cases: the planned keys are exactly `['overview', 'matrix', 'rankings', 'pages', 'aiOverview', 'citations', 'sources', 'competitors', 'discover', 'reports']`
    (so a flip is a deliberate one line change of this test); `destinationOf(NAVIGATION, ...)` finds `citations` for
    `/ai/citations`, `sources` for `/ai/sources`, `competitors` for `/competitors`, `discover` for `/discover/prompts`,
    `reports` for `/reports`, `matrix` for `/matrix`. These pass at once: they pin the current registry and guard the
    flips; say so in the commit.
- Commands:
  - `pnpm exec vitest run 'src/app/[workspace]/[project]/planned-routes.test.ts' src/lib/navigation/registry.test.ts`
  - `pnpm exec eslint 'src/app/[workspace]/[project]/' src/lib/navigation/registry.test.ts`
  - `pnpm exec prettier --check 'src/app/[workspace]/[project]/' src/lib/navigation/registry.test.ts`
  - `pnpm typecheck` (runs `next typegen`, which must accept the new routes)
- Rows: WB-NAV-01 (scaffold; decision 6).
- Reviewer checks: 10 files, the owner named in each; no change to `registry.ts`; the catch-all is untouched; the
  typed route union (`.next/types`) builds; `/discover` without a tab still reaches the catch-all.
- Commit: `WP-02: route files for the planned pages render the 404 page`

### T2: extension seams (brief step 2)

- Model: Sonnet implementer. Wave A, beside T1.
- Goal: section 2, with every entries array holding only its commented slots, and no visible change.
- Files created: `apps/web/src/features/prompts/seams/shared.ts`, `inspector-tabs.ts`, `topic-tabs.ts`, `actions.ts`,
  `columns.ts`, `toolbar.ts`, their tests (below).
- Files modified: `features/prompts/prompt-inspector.tsx`, `topic-inspector.tsx`, `prompts-screen.tsx` (seam wiring as
  section 2 says), `use-prompt-actions.tsx` (`bar` and `forPrompt` through `withActionEntries`), `prompt-columns.tsx`
  (`withColumnEntries`), `prompt-model.ts` (delete `TOPIC_TABS`, `parseTopicTab`, `PROMPT_TABS`, `PromptTab`,
  `parsePromptTab`; `export type TopicTab = string;` with the comment "The `itab` of the topic drawer: a built-in tab
  or one of `TOPIC_TAB_ENTRIES`"), `prompt-model.test.ts` (delete the cases of those constants: lines 614 to 616 and
  the block at lines 668 to 680; they move to the seam tests).
- Tests first (each fails before implementation because its module does not exist):
  - `seams/shared.test.ts`: `placeAfter` puts items after their anchor, at the end without one, keeps two insertions
    after one anchor in order, can anchor on an item an earlier insertion placed, throws on an unknown anchor and on a
    repeated id; `assertUniqueIds` throws naming the id; `chosenTab` returns the requested id when shown, else the
    first.
  - `seams/inspector-tabs.test.ts`: `promptTabs` with the four built-in ids and a fake entry `after: 'history'` gives
    latest, history, fake, competitors, stats; an entry whose `available` is false is left out and one placed after it
    still lands; `chosenTab` over the built-ins maps `'overview'`, `'prompts'` and `''` to `latest` and keeps
    `history`, `competitors`, `stats` (the cases moved from `prompt-model.test.ts`).
  - `seams/topic-tabs.test.ts`: the same for `topicTabs`, and `chosenTab` maps `'answers'` to `overview` and keeps
    `prompts` (moved cases).
  - `seams/actions.test.ts`: `withActionEntries` appends only entries of the surface, hides an entry whose permission
    the role lacks and shows it for a role that has it (permissions from `permissionsFor` of
    `@/mocks/factories/permissions`), drops a `null` build, throws on an id of `BUILT_IN_ACTION_IDS`; `asMenuItems`
    drops `group`, keeps a destructive tone, turns a `null` reason into no reason.
  - `seams/columns.test.ts`: `withColumnEntries` places an entry's two columns after `SORT_ID.citation`, appends
    without `after`, throws on a repeated column id.
  - `seams/toolbar.test.ts`: `promptsToolbarItems` splits by slot in order, hides by permission, drops a `null`
    item, throws on `copy-link`.
  - `seams/wiring.test.tsx`: proves each consumer reads its seam. Copy the `promptsAs` harness of `row-menu.test.tsx`
    (PermissionProvider, the Fynix fixture, `stubWideScreen`, the fixed clock) and replace each entries constant with
    `vi.mock('./inspector-tabs', async (importOriginal) => ({ ...(await importOriginal<typeof import('./inspector-tabs')>()), PROMPT_TAB_ENTRIES: [FAKE_TAB] }))`,
    and the same for the other four. Assert: the fake tab is listed between History and Competitors in a prompt's
    inspector and shows its panel when chosen and when the address names it (`?inspect=prompt:<id>&itab=fake`); the
    fake topic tab follows Prompts in a topic drawer; the fake action is in a prompt row's menu, a topic row's menu,
    the bulk bar and the inspector's More; the fake column is in the column chooser; the fake More item follows Copy
    link. Fails before implementation: the seam modules do not exist.
  - Existing tests that must stay green unchanged: `inspector-tabs.test.tsx`, `prompt-inspector.test.tsx`,
    `topic-drawer.test.tsx`, `row-menu.test.tsx`, `bulk-actions.test.tsx`, `selection.test.tsx`,
    `topic-menu-list.test.tsx`, `prompts.test.tsx`, `answer.test.tsx`, `trend.test.tsx`, `add-prompts.test.tsx`.
- Implementation notes: section 2 is the contract. The built-ins keep their order, labels, icons, groups, tones,
  disabled reasons and handlers byte for byte. Every import between `seams/` and the screen files is `import type`
  in the direction seam to screen, so no runtime cycle exists (risk 1).
- Commands:
  - `pnpm exec vitest run --maxWorkers=2 src/features/prompts`
  - `pnpm exec eslint src/features/prompts`
  - `pnpm exec prettier --check src/features/prompts`
  - `pnpm typecheck` (by the session, after T1 is done too)
- Rows: process (MASTER-PLAN 3.4 seams).
- Reviewer checks: every slot of the section 2 table is present in its seam with its `// WP-NN slug` line; no default
  parameter reads an entries constant; no `any`, no cast; the screens render tabs, menu items, columns and toolbar
  extras only through the seam functions; `git diff --stat` touches only the files listed; open the page against
  the mock (`NEXT_PUBLIC_API_MOCKING=all`, dev server per the dev server policy) at 390, 768, 1024 and 1280 px and see
  no change.
- Commit: `WP-02: extension seams for the Topics & Prompts tabs, actions, columns and toolbar`

### T3: shared code moves (brief step 3)

- Model: Sonnet implementer. Wave B, beside T6. Runs after T2 (both edit `prompts-screen.tsx`, `prompt-columns.tsx`,
  `topic-inspector.tsx`, `prompt-model.ts`).
- Goal: the rate and strip models, `InsufficientPill`, the XLSX writer and `FileDropzone` are usable by any feature;
  `lib` imports only `lib`, `components/app` imports only `components`, `lib` and packages (the boundaries rules of
  `eslint.config.mjs`).
- Moves (`git mv`, then Edit):

| From | To | What else |
|---|---|---|
| `features/prompts/rate-model.ts`, `rate-model.test.ts` | `lib/rates/rate-model.ts`, `.test.ts` | Receives `validAnswers`, `hasRate`, `acrossEngines` from `prompt-model.ts` (lines 274 to 289, they use only `MetricCell` and `rateState`) and their test cases from `prompt-model.test.ts` lines 617 to 631; its `./prompt-model` import goes |
| `features/prompts/strip-model.ts`, `strip-model.test.ts` | `lib/rates/strip-model.ts`, `.test.ts` | `topicsSpanned` (lines 110 to 130) stays in the feature: it moves into `prompt-model.ts` beside `topicMembers`, with its test block (strip-model.test.ts line 157 on) into `prompt-model.test.ts`; the moved file then imports only `lib` |
| `features/prompts/rate-view.tsx` `InsufficientPill` (lines 11 to 30) | `components/app/metric/insufficient-pill.tsx` | Reads the new `common.insufficient.answers` and `common.insufficient.tip` (copies of `prompts.rate.insufficient` and `insufficientTip`, which stay for `useRateWords` and `rate-columns.tsx`); `useRateWords` and `RateWords` stay in `rate-view.tsx`; the pill's test block (`rate-view.test.tsx` lines 20 to 64) moves to `insufficient-pill.test.tsx` |
| `features/rankings/export/export-file.ts`, `export-file.test.ts`, `export-colors.ts`, `export-colors.test.ts` | `lib/export/` | The four types `export-file.ts` reads from `export-model.ts` (`ExportCell`, `ExportKpi`, `ExportColumnKind`, `KeywordExport`) move into `lib/export/export-file.ts`; `export-model.ts` imports them from there and keeps `ExportLabels`, `rankCell`, `buildExport` |
| `features/rankings/import/file-dropzone.tsx` | `components/app/forms/file-dropzone.tsx` | Its six keys move from `rankings.import` (`dropzone`, `dropzoneActive`, `chooseFile`, `fileRow`, `removeFile`, `uploading`) to `common.fileDropzone`; nothing else reads them (checked); it reads `useTranslations('common.fileDropzone')` |

- Import lines to update (every importer, found with grep):
  - `rate-model`: `features/prompts/rate-columns.tsx`, `inspector-strip.tsx`, `export-rows.ts`, `topics-table.tsx`,
    `prompt-columns.tsx`
  - `validAnswers`, `hasRate`, `acrossEngines`: `export-rows.ts`, `trend-model.ts`, `prompt-columns.tsx`,
    `rate-columns.tsx`, `topic-inspector.tsx`, `prompt-model.test.ts`; `prompt-model.ts` drops its now unused
    `rateState` import
  - `strip-model`: `prompts-screen.tsx` (`StripPrompt` from `@/lib/rates/strip-model`, `topicsSpanned` from
    `./prompt-model`), `prompts-strip.tsx`, `rate-view.tsx`, `rate-columns.tsx`, `rate-view.test.tsx`
    (`features/rankings/keyword-detail/strip-model.ts` is a different file and is not touched)
  - `InsufficientPill`: `rate-columns.tsx` (the only importer)
  - `export-file`, `export-colors`: `features/rankings/rankings-screen.tsx` lines 76 and 77, `export-model.ts`,
    `export-file.test.ts`
  - `file-dropzone`: `features/rankings/import/upload-step.tsx` line 6
- Tests first: the moved test files at their new paths, importing from the new paths, plus
  `components/app/forms/file-dropzone.test.tsx` (new, small: the drop prompt and Choose file render from
  `common.fileDropzone`, a chosen file shows its row with Remove, which calls `onRemove`). They fail before the move:
  the modules are not at the new paths.
- Commands:
  - `pnpm exec vitest run --maxWorkers=2 src/lib/rates src/lib/export src/components/app/metric src/components/app/forms src/features/prompts src/features/rankings src/i18n`
  - `pnpm exec eslint src/lib/rates src/lib/export src/components/app/metric src/components/app/forms src/features/prompts src/features/rankings`
  - `pnpm exec prettier --check src/lib/rates src/lib/export src/components/app src/features/prompts src/features/rankings messages/en.json`
  - `pnpm typecheck` (by the session, after T6 is done too). A leftover `t('dropzone')` under `rankings.import` is now
    a type error, which is the check that no reader was missed.
- Rows: SC-12 (shared dropzone; parse already shared; decision 7), SC-17 (XLSX writer in `lib/export`, CSV in
  `lib/csv`; decision 3), SC-18 (rate and strip models in `lib/rates`, the pill in `components/app/metric`).
- Reviewer checks: `git log --follow` shows each moved file's history; no file in `lib/` imports `@/features` or
  `@/components`; the pill and the dropzone render the same text as before (Topics & Prompts insufficient cells,
  Keywords import dialog); `rg "features/prompts/(rate|strip)-model|rankings/export/export-(file|colors)|import/file-dropzone" apps/web` is empty.
- Commit: `WP-02: rate and strip models, InsufficientPill, the XLSX writer and FileDropzone move to shared code`

### T4: message namespaces and empty mock handler modules (brief step 4)

- Model: Haiku implementer. Wave C, alone (it edits `messages/en.json` after T3).
- Goal: each later package edits only its own namespace object and its own handler module.
- Namespaces: add each as `{}` (section 4 explains why an empty object is enough), in the order below, top-level ones
  after `prompts`, the `prompts` ones after `answer` (the last key of `prompts` today).
- Mock modules: create each file of the section 4 table as
  `import type { HttpHandler } from 'msw';`, one JSDoc line naming the package and the routes it will answer, and
  `export const <name>Handlers: HttpHandler[] = [];`. Register each in `mocks/handlers/index.ts`: one import per
  module after the existing imports, and the spreads after `...integrationHandlers` and before `...pendingHandlers`,
  each spread on its own line under a `// WP-NN slug` comment line, so packages never edit neighbouring lines.
- Tests first: `src/mocks/handlers/registered.test.ts` (new): for each slug of the section 4 table, the module
  `./<slug>` exports an empty array under the table's name and that same array is spread into `handlers` of
  `./index` (`expect(handlers).toEqual(expect.arrayContaining([...]))` cannot see empty arrays, so read `index.ts`
  with `node:fs` and assert one `import { <name> } from './<slug>';` line and one `...<name>,` line per slug). Fails
  before implementation: the modules do not exist. The messages test (`src/i18n/messages.test.ts`) needs no change;
  it must stay green.
- Commands:
  - `pnpm exec vitest run src/i18n/messages.test.ts src/mocks/handlers/handlers.test.ts src/mocks/handlers/registered.test.ts src/test/source-text.test.ts`
  - `pnpm exec eslint src/mocks/handlers`
  - `pnpm exec prettier --check messages/en.json src/mocks/handlers`
  - `pnpm typecheck`
- Rows: process.
- Reviewer checks: no existing key moved or changed; `prompts.add` and `prompts.topicDrawer` untouched; each module is
  empty and typed; the spreads are between `integrationHandlers` and `pendingHandlers`.
- Commit: `WP-02: message namespaces and empty mock handler modules per package`

### T5: the dnd-kit dependencies (brief step 5, first half)

- Model: Sonnet implementer. Wave D, alone.
- Goal: `pnpm-lock.yaml` changes once for the layout grid (WP-15, SC-25).
- From the repository root:
  `pnpm --filter @app/web add @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0 @dnd-kit/utilities@^3.2.2`
  (take the latest published versions at run time if newer; all three take React 19 as a peer). They land in
  `dependencies` of `apps/web/package.json`.
- No code imports them yet. That fails no check: the repository has no knip, depcheck or ts-prune, and ESLint has no
  `import/no-extraneous-dependencies` or unused dependency rule (checked in `eslint.config.mjs` and
  `infra/ship.sh`). `infra/ship.sh` runs `pnpm install --frozen-lockfile`, which only needs the lockfile in step
  with `package.json`.
- Tests: none (no logic). Checks: `pnpm install --frozen-lockfile` from the root passes; then from `apps/web`
  `pnpm typecheck` and `pnpm lint`.
- Rows: process.
- Reviewer checks: the diff is `apps/web/package.json` (three lines) and `pnpm-lock.yaml` only; no other package moved
  version in the lockfile (`git diff pnpm-lock.yaml` shows only `@dnd-kit/*` and their own dependencies, such as
  `tslib`).
- Commit: `WP-02: dnd-kit dependencies`

### T6: the AI schedule mocks say twice a week (brief step 5, second half)

- Model: Sonnet implementer. Wave B, beside T3.
- Goal: no mock text promises a weekly collection (decision 2).
- Files modified: `apps/web/src/mocks/handlers/schedules.ts` lines 89 and 90, the comment above `ai_prompt` in
  `WORKLOAD_RULES`, to say: AI answers, every active prompt on the standard queue, twice a week as two weekly
  schedules (Monday and Thursday), and at most two schedules a project (the backend's `ai_prompt` rules);
  `apps/web/src/mocks/handlers/schedules.test.ts` line 307 `describe` title to "the AI prompt workload (the base plan:
  twice a week, as two weekly schedules a project)" and line 316 `it` title to "takes only weekly schedules, on a
  create and on a change". `cadence: 'weekly'`, `cadences: ['weekly']` and `maxPerProject: 2` stay.
- Tests first: none new (wording); the existing schedule tests are the check.
- Commands: `pnpm exec vitest run src/mocks/handlers/schedules.test.ts src/mocks/ai-runs.test.ts`;
  `pnpm exec eslint src/mocks/handlers/schedules.ts src/mocks/handlers/schedules.test.ts`;
  `pnpm exec prettier --check src/mocks/handlers/schedules.ts src/mocks/handlers/schedules.test.ts`.
- Rows: process (roadmap risk "Cadence copy drift").
- Reviewer checks: only text changed; `rg -i "weekly" apps/web/src/mocks` left with API values, keyword workload
  text and test names that are true.
- Commit: `WP-02: the AI schedule mocks say twice a week`

### T7: As built notes, rebase, checks, push (brief step 6)

- Model: the WP-02 session itself, then a fresh Sonnet end reviewer.
- As built notes, appended (one block each, in the style of the notes already there):
  - `docs/20-frontend-specification.md` section 3.10 (Feature flags and phase gating): the 10 route files are
    re-exports of the project catch-all and stay the 404 page until each owner flips its registry entry; the registry
    test pins the planned keys.
  - `docs/20-frontend-specification.md` section 5.6 (Prompt Explorer, where the Topics & Prompts notes are): the five
    seams, the slot convention, `chosenTab` replacing the tab constants, and the moves (`lib/rates`, `lib/export`,
    `components/app/metric/insufficient-pill.tsx`, `components/app/forms/file-dropzone.tsx`, `common.insufficient`,
    `common.fileDropzone`).
- Rebase and push:
  1. `git fetch origin && git rebase origin/develop`; on a conflict in `messages/en.json` keep both sides, then
     `pnpm exec vitest run src/i18n/messages.test.ts`; on `pnpm-lock.yaml` take develop's and rerun the T5 command.
  2. Checks. If `git cat-file -e origin/develop:infra/dev/heavy` fails (the lock is not on develop yet): from the
     root `pnpm install --frozen-lockfile`, then in `apps/web` `pnpm lint`, `pnpm typecheck`, `pnpm format:check` and
     the targeted vitest paths of T1 to T6 plus `src/test/source-text.test.ts`; no full `pnpm test`, no `pnpm build`
     (both are heavy jobs without the lock). If it exists: `infra/dev/heavy --lane medium -- pnpm lint`,
     `infra/dev/heavy --lane medium -- pnpm typecheck`, `pnpm format:check`, then
     `infra/dev/heavy --label wp-02-test -- pnpm test` and `infra/dev/heavy --label wp-02-build -- pnpm build`, which
     the acceptance criteria need before the last push. Do not start one while `$STATE_DIR/pause` of
     `infra/dev/health-watch.sh` exists.
  3. Browser check against the mock (`NEXT_PUBLIC_API_MOCKING=all`, dev server on the session's port per the dev
     server policy, stopped after): Topics & Prompts at 390, 768, 1024 and 1280 px, light and dark, Default and
     Compact, unchanged; `/ai`, `/ai/prompts/p_1`, `/discover/prompts` and `/settings/retention` show the 404 page in
     the shell; the Keywords import dialog shows the dropzone text.
  4. `git push origin HEAD:develop` (fast-forward only); if refused, back to step 1.
- Report (to the coordinator, and through `infra/dev/wp-status WP-02 <status> "<note>"` once that script exists), at
  `building` (plan committed), each push, `review`, `blocked` and `merged`:

```text
WP-02 <status> | branch claude/ai-wp-02-web-scaffold-ca73e6 @ <short sha> | rows done <n>/4 | steps <n>/7 | blockers: <none or list> | next: <one line>
```

  For example at the end: `WP-02 merged | branch claude/ai-wp-02-web-scaffold-ca73e6 @ abc1234 | rows done 3/4 (WB-NAV-01 scaffolded, closes at the last flip) | steps 7/7 | blockers: none | next: leases on settings-frame.tsx for WP-31 and WP-48`.
- End reviewer: reads the whole package diff against the brief's acceptance criteria and the four rows, opens every
  changed page at the four widths, and checks the "Not touched" list with `git diff --stat origin/develop...HEAD`.
- Commit: `WP-02: As built notes for the scaffolding`

## 4. Message namespaces and mock modules

### What the messages test requires of an empty namespace

`src/i18n/messages.test.ts` flattens the catalog to its string leaves (`entries`) and checks each leaf (not empty, no
dash, no double space, no straight quote, no contraction, no exclamation mark) and each key path (camelCase). An empty
object has no leaves, so it adds nothing to check and passes every case; "has messages" holds because the rest of the
catalog has thousands. The typed catalog (`src/i18n/types.d.ts`) accepts `{}`: `useTranslations('citations')` compiles,
and any key in it is a type error until the owner adds it, which is the right signal. So no placeholder key is needed,
and none is added (a placeholder would be copy nobody reads). Prettier prints `{}` on one line.

### The namespaces

| Namespace | Owner | Note |
|---|---|---|
| `aiOverview` | WP-33 | WP-34 to WP-37 cards each get a sub-object pre-created: `aiOverview.engines`, `aiOverview.competitors`, `aiOverview.topics`, `aiOverview.sources`, so four parallel packages never share an object |
| `citations` | WP-21 | `citations.inspectors` pre-created for WP-22 |
| `competitors` | WP-39 | |
| `discover` | WP-46 | |
| `layouts` | WP-15 | `layouts.customize` pre-created for WP-16 |
| `alerts` | WP-48 | |
| `reports` | WP-51 | |
| `promptDetail` | WP-52 | |
| `sources` | WP-61 | |
| `notes` | WP-38 | |
| `exports` | WP-50 | |
| `savedViews` | WP-49 | |
| `commandPalette` | WP-53 | |
| `matrix` | WP-65 | |
| `prompts.import` | WP-28 | |
| `prompts.edit` | WP-29 | |
| `prompts.archive` | WP-29 | |
| `prompts.generate` | WP-44 | |
| `prompts.versions` | WP-41 | |
| `prompts.panels` | WP-43 | |
| `prompts.compare` | WP-19 | |
| `prompts.citationsTab` | WP-21 | |
| `prompts.fanout` | WP-24 | WP-57 adds retrieval keys under a lease |
| `prompts.facets` | WP-17 | |
| `prompts.limits` | WP-27 | |
| `prompts.evidence` | WP-26 | Distinct from the existing top-level `evidence` |
| `prompts.add` | WP-27 | Exists already; not touched by WP-02 |
| `prompts.topicDrawer` | WP-20 | Exists already; not touched by WP-02 |
| `common.insufficient`, `common.fileDropzone` | WP-02 (T3) | Filled with the moved copy, not empty |

### The mock handler modules

Each is `apps/web/src/mocks/handlers/<slug>.ts` exporting `<camel>Handlers: HttpHandler[]`. One per package whose
contract names a route the existing mocks do not answer. A package that only changes the answer of an existing route
takes a lease on that route's existing module instead (the summary is `prompt-answers.ts`, the prompt list
`prompts.ts`, engines `prompts.ts`, schedules `schedules.ts`, runs `runs.ts`); it never shadows a route from a new
module.

| Slug (file) | Export | Package | Routes it will answer (from the brief's Contract line) |
|---|---|---|---|
| `layouts.ts` | `layoutHandlers` | WP-15 (WP-16 under lease) | C12a layouts |
| `compare.ts` | `compareHandlers` | WP-19 | C2 compare |
| `citations.ts` | `citationHandlers` | WP-21 | `ai/citations`, `ai/sources/domains`, `ai/sources/pages` |
| `citation-details.ts` | `citationDetailHandlers` | WP-22 | sources lane series, lost, cited with |
| `fanout.ts` | `fanoutHandlers` | WP-24 | `ai/fanout-queries` |
| `evidence.ts` | `evidenceHandlers` | WP-26 | `ai/observations/{id}/compare` |
| `prompt-limits.ts` | `promptLimitHandlers` | WP-27 | C1 limits read, estimate |
| `prompt-edits.ts` | `promptEditHandlers` | WP-29 | bulk update |
| `ai-health.ts` | `aiHealthHandlers` | WP-30 | C3, N5, budgets |
| `retention.ts` | `retentionHandlers` | WP-31 | data retention settings |
| `ai-overview.ts` | `aiOverviewHandlers` | WP-33 | overview routes |
| `notes.ts` | `noteHandlers` | WP-38 | N9, N13 |
| `competitors.ts` | `competitorHandlers` | WP-39 (WP-35 reads it) | `ai/competitors`, N3, N14 |
| `prompt-versions.ts` | `promptVersionHandlers` | WP-41 | C9 versions |
| `panels.ts` | `panelHandlers` | WP-43 | C9 panels |
| `prompt-links.ts` | `promptLinkHandlers` | WP-44 | C7 links, B18 preview |
| `candidates.ts` | `candidateHandlers` | WP-46 | C10 |
| `alerts.ts` | `alertHandlers` | WP-48 | C11 |
| `saved-views.ts` | `savedViewHandlers` | WP-49 | C12 saved views |
| `exports.ts` | `exportHandlers` | WP-50 | C12 exports |
| `reports.ts` | `reportHandlers` | WP-51 | report routes |
| `prompt-timeline.ts` | `promptTimelineHandlers` | WP-52 | prompt timeline |
| `rederive.ts` | `rederiveHandlers` | WP-56 | C4, C5 candidate parts |
| `retrieval.ts` | `retrievalHandlers` | WP-57 | C6 |
| `prompt-stats.ts` | `promptStatHandlers` | WP-59 | C8 |
| `sources.ts` | `sourceHandlers` | WP-61 | C13 |
| `cross-channel.ts` | `crossChannelHandlers` | WP-65 | C7, C14 |
| `llm-diagnostics.ts` | `llmDiagnosticHandlers` | WP-68 | C4 claims, diagnostics |
| `first-party.ts` | `firstPartyHandlers` | WP-69 | doc 19 3.10 routes |
| `geo-readiness.ts` | `geoReadinessHandlers` | WP-70 | C15 page checks |

WP-15, WP-21 and WP-24 name `layouts.ts`, `citations.ts` and `fanout.ts` in their briefs; the table keeps those names.
Packages without a module (WP-17, WP-18, WP-20, WP-23, WP-25, WP-28, WP-34, WP-36, WP-37, WP-40, WP-53, WP-55,
WP-71) consume existing routes or another package's module; the coordinator adds a module by lease if one turns out
to need it.

In `index.ts`, after the existing imports:

```ts
// WP-15 layouts-react-core
import { layoutHandlers } from './layouts';
// WP-19 compare-deltas
import { compareHandlers } from './compare';
// ... one pair per module, in the table's order
```

and in `handlers`, after `...integrationHandlers,`:

```ts
  // WP-15 layouts-react-core
  ...layoutHandlers,
  // WP-19 compare-deltas
  ...compareHandlers,
  // ... in the table's order
  ...pendingHandlers,
```

## 5. e2e support

`apps/web/e2e/support.ts` stays frozen and WP-02 does not touch it. WP-02 pre-creates nothing under
`apps/web/e2e/support/`: a spec imports its own helper directly (`import { openCitations } from '../support/citations';`),
so there is no registration to make and nothing to conflict on; an empty file per package would be dead code. The
names coexist: `'../support'` still resolves to `support.ts` (a file is tried before a folder's index under
`moduleResolution: "Bundler"`), and files under `e2e/support/` do not match the Playwright `testMatch` patterns
(`flows/.*\.spec\.ts`, `visual/.*\.spec\.ts`). The ESLint rule `@typescript-eslint/no-floating-promises` covers them
through the `e2e/**/*.ts` block. Each package's own spec is `e2e/flows/ai-<slug>.spec.ts` (MASTER-PLAN 3.6).

## 6. The dnd-kit dependency

T5 above: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` in `apps/web` `dependencies`, added from the
repository root with `pnpm --filter @app/web add ...`. Nothing imports them until WP-15's `LayoutGrid`; no check in
the repository fails on an unused dependency (no knip or depcheck; no ESLint dependency rule), and the frozen install
of `infra/ship.sh` only needs the lockfile to match.

## 7. Final task summary

T7 above: As built notes in `docs/20-frontend-specification.md` sections 3.10 and 5.6; `git fetch origin && git rebase origin/develop`;
targeted checks until `infra/dev/heavy` is on `origin/develop`, then `pnpm test` and `pnpm build` through it;
`git push origin HEAD:develop`; the status line above.

## 8. Risks and rollback

| Risk | Where | Guard |
|---|---|---|
| Import cycles from the seams | `seams/*` read types from `prompt-inspector.tsx`, `topic-inspector.tsx`, `prompts-screen.tsx`, `prompt-columns.tsx`, `prompt-model.ts`, which import the seams at run time | Seams import those files with `import type` only (erased under `verbatimModuleSyntax`); no seam has a value import from a screen file. Reviewer greps `from '\.\./` in `seams/` for any non-type import of a screen file |
| Import cycles from the moves | `lib/rates/rate-model.ts` and `strip-model.ts` import each other's types only; `prompt-model.ts` now imports `lib/rates` | `lib` imports no feature (the boundaries rule fails the lint otherwise); `topicsSpanned` stays in the feature for that reason |
| Boundaries lint | `lib/**` may import only `lib`; `components/app/**` only components, `lib` and packages, and no fetching | `pnpm exec eslint` on the moved folders in T3; the moved files import `@/lib/api/types`, `@/lib/stats`, `@/lib/tables`, `@/lib/design`, `@/lib/csv`, `@/components/ui/*`, `next-intl`, `lucide-react`, `write-excel-file` only |
| Dead code and unused dependencies | dnd-kit packages unused; `TopicTab` alias | No knip, depcheck or ts-prune in the repository; ESLint `no-unused-vars` covers unused imports inside files, so each removed constant takes its import with it (`rateState` in `prompt-model.ts`) |
| Next.js route type generation | `pnpm typecheck` runs `next typegen`; 10 new routes join the `Route` union; re-exported pages | T1 runs `pnpm typecheck`; fallback body if the re-export is refused; T7 runs `pnpm build` once the lock exists |
| `notFound()` under a layout | `settings/alert-rules` and `settings/retention` sit under `settings/layout.tsx`; `notFound()` renders the project's `not-found.tsx`, the boundary above the settings layout | Same 404 page in the shell as today's catch-all; checked in the T7 browser pass |
| Navigation registry test | it asserts the visible list for each role and now pins the planned keys | Each page package changes its one `status` line and the pinned list in the same commit, as MASTER-PLAN 3.6 says |
| i18n parity and catalog tests | moved keys (`rankings.import` to `common.fileDropzone`), new `common.insufficient`, empty namespaces | `messages.test.ts` passes with `{}`; the typed catalog turns any missed reader into a type error; `src/test/source-text.test.ts` reads comments for dashes |
| Visible change on Topics & Prompts | the seam wiring rebuilds tab rows, menus, columns and the toolbar | Built-ins byte for byte, empty entries, the existing component tests, the wiring test, and the four-width browser pass |
| MSW order | new modules sit before `pendingHandlers` | Empty arrays change nothing; no new module may answer a route an existing module answers (section 4) |
| Parallel implementers in one worktree | two subagents in one checkout | File-disjoint pairs only; typecheck after both finish; each stages its own paths |
| Lockfile churn | T5 | Alone in its wave; the reviewer reads the lockfile diff |

Rollback: every task is one commit on develop. A broken push is fixed forward on develop; when a fix is not quick,
`git revert <sha>` of that task's commit on develop is a forward commit too (never on `main`, which only
`infra/ship.sh` moves). T3's moves revert cleanly with their import edits because both are in the one commit.
