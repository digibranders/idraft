# Layout customization: design

Date: 2026-09-30. Status: draft for review. Owner decisions are marked **Decided**.

## 1. Goal

People choose what they see. On a dashboard page a person can hide a card (for example Rank distribution), add cards from a catalog, reorder them and set their width. They can choose the headline numbers at the top of a page, and the cards in the record drawer. An admin can set the layout that everyone in the workspace starts from.

Success means:

1. A person can arrange a page in under a minute without reading help.
2. A saved layout is there on the next visit, on another device, and in every project.
3. No layout, however it is arranged, can show a number that breaks the data rules (a rate without its counts, engines pooled into one value).
4. A broken, outdated or unavailable card never breaks the page.

## 2. Decisions from the owner

| # | Question | Decided |
|---|---|---|
| 1 | Who owns a layout | Each person has their own. An admin can save a team default for the workspace. People who have not customized see the team default, and "Reset to default" returns to it |
| 2 | What can be customized | Cards on dashboard pages, the headline numbers at the top of a page, the cards in the record drawer. Not the sidebar menu. Table columns already have their own chooser ([12-tables.md](../../design-system/12-tables.md) section 10) |
| 3 | Where new cards come from | A catalog of ready-made cards with a few options each. No build-your-own card |
| 4 | How much layout freedom | Reorder, plus four preset widths. No free canvas, no free resize |
| 5 | Scope across projects | One layout per person per workspace, used in every project |

## 3. Out of scope

Custom card builder. Free canvas and height resize. Per-project layout overrides. Several named layouts per page. Role-based defaults. Sharing a layout with one person. Sidebar customization. Editing on phones (layouts display there; editing needs 768 px). Costs page (it is a finance report with a fixed shape).

Each of these can be added later without changing the stored document: section 6 leaves room for them.

## 4. Vocabulary

| Term | Meaning |
|---|---|
| Screen | A customizable place, with a stable key: `overview`, `ai_overview`, `rankings`, `prompts`, `citations`, `sources`, `pages`, `inspector.keyword`, `inspector.prompt`, `inspector.page`, `inspector.citation` |
| Zone | A region of a screen. `numbers` is the headline strip. `cards` is the card area |
| Card type | A catalog entry, for example `seo.rank_distribution`. Designed once, with fixed data rules |
| Card | One card type placed on a screen, with a width and its options |
| Number | One headline metric in the strip, identified by its metric registry key ([16-metrics-methodology.md](../../16-metrics-methodology.md) section 2.1) and, for AI metrics, an engine |
| Layout | The document for one screen: its numbers and its cards, in order |
| Built-in default | The layout shipped in the code for a screen. It is what the page templates describe today |
| Team default | A layout saved by an admin for the whole workspace |
| Personal layout | A layout saved by one person |

Which zones a screen has:

| Screen kind | `numbers` | `cards` |
|---|---|---|
| Dashboard pages (`overview`, `ai_overview`) | yes | yes, with widths |
| Table pages (`rankings`, `prompts`, `citations`, `sources`, `pages`) | yes | no: the table is the page |
| Record drawer, Overview tab (`inspector.*`) | no: the three metric cards are one fixed "Key numbers" card | yes, one column, no widths |

## 5. What people see

### 5.1 Entering and leaving

| Screen | Entry point |
|---|---|
| Dashboard pages | A "Customize" button (`secondary`, `SlidersHorizontal` icon) in the page header actions. Below 1024 px it is in the More menu |
| Table pages | "Customize numbers" in the page header More menu |
| Record drawer | "Customize cards" in the drawer's More menu |

Customize mode is a state of the page, not a new route. While it is on:

- The page title gains a "Customizing" badge, and the save bar (section 5.6) is pinned to the bottom.
- Cards keep showing real data, so the person sees the real result. Card content is inert: links, row clicks, chart hover and refetching are off.
- The top bar, sidebar and filter bar stay usable. Leaving with unsaved changes opens the existing "Discard unsaved changes?" dialog, however the person leaves: a link, Back or Forward, or closing the drawer by its button, its scrim or Escape. "Keep editing" leaves the address and the page as they were.
- Escape leaves customize mode (through the same dialog when there are changes).
- Leaving the mode returns focus to the control that started it: the Customize button, or the drawer's More button.

Customize mode needs a viewport of 768 px or more. Below that the entry points are not shown. A window narrowed below 768 px leaves the mode when there is nothing to save. With unsaved changes the mode and its save bar stay until the person saves or cancels: a resize never discards work.

### 5.2 Cards in customize mode

Each card gets a dashed outline and a toolbar in its header:

| Control | Behavior |
|---|---|
| Drag handle (`GripVertical`) | Drag to reorder. A 2 px `primary` line, midway in the gap, shows where the card will land. The card's own place stays at 50% opacity; in the app the copy under the pointer uses `shadow-drag`. Releasing over the card's own place moves nothing |
| Width (`Select`, `sm`) | The widths this card type allows, from: One third, Half, Two thirds, Full. Hidden in the drawer |
| Options (`Settings2`) | Only on card types with options. Opens a popover with the card's form. Changes show at once in the card |
| Hide (`EyeOff`) | Takes the card off the page. Tooltip: "Hide card. Add it back from the catalog" |
| More (`EllipsisVertical`) | Move earlier, Move later, Move to start, Move to end. These are the keyboard and touch alternative to dragging (WCAG 2.5.7) |

Keyboard: the drag handle is a button named "Reorder {card}", with the instructions attached as its description so they are read once and not on every card. Space picks the card up, arrow keys move it, Space drops it, Escape puts it back. Moving focus away, or any edit made with the pointer, drops it where it is. Each step is announced ("Rank distribution, position 2 of 8").

The toolbar is a labelled group, not an ARIA toolbar: every control in it is a normal tab stop.

After the last card there is an "Add card" slot. It takes the free third of the last row when there is one, otherwise half a row. A page with no cards shows only this slot and the sentence "This page has no cards. Add one from the catalog."

### 5.3 Headline numbers in customize mode

Each number in the strip gets the controls of a card, in a row above it: a drag handle, Remove (`X`) and a Move menu (Move earlier, Move later, Move to start, Move to end). The menu is the single-pointer and keyboard alternative to dragging, as it is for cards. The controls are 32 px. In customize mode a number is not a link. After the last number there is an "Add number" slot, which opens a list of the numbers available for this screen, grouped SEO and AI, with the ones already shown marked.

Rules:

- 0 to 6 numbers. With 0 the strip is not shown.
- An AI number is always for one engine. Adding "Mention rate" asks which engine. There is no pooled AI number (metric rule in [16-metrics-methodology.md](../../16-metrics-methodology.md) section 1).
- The strip draws its stronger divider wherever the channel changes between neighbors, so SEO and AI numbers stay visibly separate in any order.
- Every number keeps its context line (denominator or sample size). That line is part of the number and cannot be turned off.

### 5.4 Adding a card: the catalog

"Add card" opens a dialog (720 px): a search field, then the catalog grouped by SEO, AI, Cross-channel and Activity. Each entry shows a small schematic of the card, its name, one sentence about what it answers, and one of these states:

| State | Shown as |
|---|---|
| Can be added | "Add" button |
| Already on the page, single-use type | "Added" (disabled) |
| Already on the page, reusable type (section 7.1) | "Add another" |
| Not available in this project | Disabled, with the reason: "AI tracking is off in this project" |
| New in the last 30 days | "New" badge next to the name |

Adding a card closes the dialog, appends the card after the last one (or at the slot that was clicked), scrolls it into view and moves focus to it. A card type the person has no permission for (for example cost cards without `costs:read`) is not listed.

### 5.5 The record drawer

"Customize cards" puts the drawer's Overview tab into the same mode, with one column: drag or Move earlier and later, Hide, and an "Add card" slot. The header, badges, tabs and the other tabs are fixed. The layout is per record type (`inspector.keyword` and so on), so every keyword opens with the same cards.

### 5.6 Saving

The save bar reuses `SaveBar` ([10-forms.md](../../design-system/10-forms.md) section 13.2):

```
 3 changes · Applies to your view, in every project     [Reset to default] [Cancel] [Save layout]
```

| Action | Result |
|---|---|
| Save layout | Stores the personal layout, leaves customize mode. No toast: the page is the confirmation. A draft equal to the default (team, else built-in) is not stored: the person then has no personal layout and keeps following the default, including later changes to it |
| Cancel | Leaves customize mode and drops the changes (asks first when there are changes) |
| Reset to default | Replaces the draft with the team default, or the built-in default when there is none. It is a change like any other: nothing is stored until Save |
| Save as team default (admins and owners only, in a menu on the Save button) | Opens a confirmation: "Set this as the default for everyone in {workspace}? People who have customized this page keep their own layout." On confirm it stores the team default and removes the admin's own personal layout for this screen, so the admin sees what everyone sees |
| Remove team default (same menu, only when one exists) | Confirmation, then the workspace falls back to the built-in default. Unsaved changes are kept and the mode stays open; from then on the draft is compared with the layout without the team default, which is also what Cancel returns to |

The count is the number of differences from the layout the person started with. When it is 0, Save is disabled. It is 0 exactly when the draft shows the same items, in the same order, with the same widths and options. A card or number that was removed and added back counts as the same item: put back where it was it is no change, put back elsewhere it is one move.

A confirmation or the catalog that is open when the mode ends (navigation, a narrowed window) closes with it and does nothing.

### 5.7 Outside customize mode

- A person who has never customized sees the team default, or the built-in default.
- A card that cannot work in the current project (section 8) is skipped. The grid closes the gap. The layout itself is not changed, so the card is back in a project where it works.
- Phones show the saved layout: cards in order, each full width.

## 6. Layout model

### 6.1 The document

One JSON document per screen. This is what is stored and what the client edits:

```ts
interface LayoutDocument {
  schema: 1;                        // document format version
  numbers?: NumberItem[];           // only on screens with a numbers zone
  cards?: CardItem[];               // only on screens with a cards zone
}
interface NumberItem {
  id: string;                       // stable within the document (nanoid), for keys and reordering
  metric: MetricKey;                // 'seo.visibility_volume', 'ai.mention_rate', ...
  engine?: EngineCode;              // required when the metric is an AI metric
}
interface CardItem {
  id: string;
  type: CardTypeKey;                // 'seo.rank_distribution'
  width?: 'third' | 'half' | 'two_thirds' | 'full';   // dashboard pages only
  options?: Record<string, unknown>;                   // validated by the card type's own schema
}
```

Rules:

- A document is a full snapshot, never a diff against a default. Reading a layout is then one lookup with no merge logic, and a change to the built-in default cannot silently rearrange a page someone set up.
- Options never name project-specific things (a competitor, a topic, a keyword group). They name global things only: an engine, a row count, a direction. This is what lets one layout work in every project.
- Limits: 12 cards and 6 numbers per screen, 16 KB per document. They keep a page readable and bound the number of queries it starts.

### 6.2 Widths and rows

Dashboard pages use the 12-column page grid.

| Width | Columns at 1280 px and up | 768 to 1279 px | Below 768 px |
|---|---|---|---|
| `third` | 4 | 6 | 12 |
| `half` | 6 | 6 | 12 |
| `two_thirds` | 8 | 12 | 12 |
| `full` | 12 | 12 | 12 |

- Cards flow in order, left to right. A card that does not fit in the rest of a row starts the next row.
- A row that is not full stays not full. The page does not stretch a card the person set to a smaller width. In customize mode the empty part of a row is a drop target.
- Cards in one row share the height of the tallest, with content aligned to the top.
- Height belongs to the card type (a chart is 280 px, a list shows a capped number of rows). People do not set heights.
- Each card type declares the widths it reads well at. The Width control offers only those.

### 6.3 Which layout is shown

```
personal layout (this person, this workspace, this screen)
   else team default (this workspace, this screen)
      else built-in default (code, this screen)
```

A stored value that is not a layout document at all (not an object, or another `schema`) counts as absent, so the next source is used. A damaged personal layout does not hide the team default.

The result is then sanitized in the client against the catalog the client was built with:

1. Cards and numbers whose type or metric is unknown are dropped.
2. A width the type does not allow becomes the type's default width.
3. Options that fail the type's schema become the type's default options.
4. Items beyond the limits are dropped from the end.
5. Of two instances of a reusable type with the same identity value (two Mention rate trends for one engine), the first is kept.
6. An id that is not a plain token (letters, digits, `-` and `_`, at most 64 characters) or that repeats is replaced.

Two layouts are the same when they show the same items in the same order with the same widths and options. Ids are not part of the comparison.

Sanitizing changes only what is displayed. The stored document is rewritten only when the person saves. A sanitized layout is never an error state.

### 6.4 When the product changes

| Change | Effect |
|---|---|
| A new card type ships | It appears in the catalog with a "New" badge for 30 days. It is added to the built-in default only if we decide so. It never enters a team default or a personal layout by itself |
| The built-in default changes | People on the built-in default see the new one. Team defaults and personal layouts are untouched |
| A card type is retired | Its key stays in the catalog as `retired` for one release, so it still renders but cannot be added. After that, sanitizing drops it |
| The document format changes | `schema` is raised. The client upgrades older documents on read with a pure function per version step |

## 7. The catalog

The catalog is code, not data: one definition per card type and per number, in `packages/contracts`, shared by the web app and (as generated JSON) the API.

```ts
interface CardTypeDefinition {
  key: CardTypeKey;
  title: string;                    // "Rank distribution"
  description: string;              // one sentence: what question the card answers
  group: 'seo' | 'ai' | 'cross' | 'activity';
  screens: ScreenKey[];             // where it may be placed
  widths: Width[];                  // allowed widths, first is the default; omitted for drawer cards
  maxInstances: number;             // 1 for most; more for reusable types
  options?: ZodSchema;              // project-agnostic options and their defaults
  requires: Requirement[];          // 'channel:seo', 'channel:ai', 'integration:gsc', 'permission:costs:read'
  status: 'active' | 'retired';
  addedOn: BusinessDate;            // drives the "New" badge
}
```

### 7.1 Dashboard cards, first release

| Key | Name | Group | Widths (default first) | Options | Requires |
|---|---|---|---|---|---|
| `trend.visibility_mentions` | Visibility and mention rate | cross | two_thirds, full | none (its Series menu is a view control, not a stored option: options are single-choice in the first release) | seo or ai |
| `seo.rank_distribution` | Rank distribution | seo | third, half | none | seo |
| `seo.top_movers` | Top movers | seo | half, third | Direction: all, improved, declined. Rows: 5 or 10 | seo |
| `seo.serp_features` | SERP features | seo | third, half | none | seo |
| `ai.by_engine` | AI by engine | ai | half, two_thirds, full | none | ai |
| `ai.mention_trend` | Mention rate trend (reusable, up to 4) | ai | half, two_thirds, full | Engine | ai |
| `ai.citation_share_by_domain_type` | Citation share by domain type | ai | third, half | none | ai |
| `cross.matrix_summary` | SEO and AI matrix | cross | half, two_thirds | none | seo and ai |
| `cross.unclassified` | Not classified | cross | third, half | none | seo and ai |
| `cross.opportunities` | Opportunities | cross | half, third | Rows: 5 or 10 | seo and ai |
| `competitors.summary` | Competitors | cross | half, two_thirds, full | none | seo or ai |
| `competitors.share_of_voice` | Share of voice | cross | third, half | Channel: SEO, or one AI engine | seo or ai |
| `activity.key_changes` | Key changes | activity | half, two_thirds, full | Rows: 5 or 8 | none |
| `activity.collection_status` | Collection status | activity | third, half | none | none |

The built-in default for `overview` is the eight cards on today's Overview, in today's order and widths: Visibility and mention rate, Rank distribution, SEO and AI matrix, Not classified, Key changes, Opportunities, AI by engine, Competitors. The other six (Top movers, SERP features, Mention rate trend, Citation share by domain type, Share of voice, Collection status) are in the catalog but not in the default.

### 7.2 Headline numbers, first release

| Group | Numbers |
|---|---|
| SEO | Keywords tracked, SEO visibility (volume-weighted), SEO visibility (equal-weight), Top 3, Top 10, Top 20, Average rank, Estimated clicks, AIO citation rate, SEO share of voice |
| AI, one engine each | Mention rate, Citation rate, Recommendation rate, Share of voice |

Each screen lists which of these it offers. A number may appear once per screen (once per engine for AI numbers).

### 7.3 Drawer cards, first release (keyword)

Key numbers, Rank history, AI mentions by engine, Competing domains (the four in the built-in default), plus SERP features and Ranking URL history. Other record types get their lists when their drawers are built.

### 7.4 What makes a card safe

Every card type is a reviewed component. It owns its query, its formatting, its denominators and its method note. A person chooses which cards to show and a few options, never how a number is computed or drawn. This is the reason the catalog is code and the reason there is no card builder.

## 8. Availability and failure

| Situation | In normal view | In customize mode |
|---|---|---|
| The project lacks something a card requires (AI tracking off, integration not connected) | Card skipped, grid closes up | Placeholder card with the reason, so the person understands why it is missing here. It can still be moved or hidden |
| The person lacks a permission a card requires | Card skipped | Card skipped. Not listed in the catalog |
| An engine in a number or option is not collected in this project | The number or card shows its "Not collected" state ([17-empty-loading-error-states.md](../../design-system/17-empty-loading-error-states.md) section 8) | Same |
| One card's data fails to load | That card shows its error state with Retry. Other cards are unaffected (each card has its own error boundary and query) | Same |
| The layout cannot be loaded | The page shows the built-in default and a region banner: "Your layout could not be loaded. Showing the default." with Retry. Customize is disabled until it loads, so a failed read can never be saved over a good layout | n/a |
| Saving fails | n/a | The save bar shows "Could not save. Try again." The draft and customize mode stay |
| The layout was changed elsewhere (another tab or device) while editing | n/a | Save returns `412`. Dialog: "This layout was changed somewhere else." with "Keep mine" (overwrite) and "Load the other version" |

## 9. Storage and API

### 9.1 Table

```sql
CREATE TABLE core.layouts (
    id              uuid PRIMARY KEY DEFAULT uuidv7(),
    workspace_id    uuid NOT NULL,
    owner_user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,   -- NULL = team default
    screen          text NOT NULL,                  -- 'overview', 'inspector.keyword', ...
    document        jsonb NOT NULL,                 -- LayoutDocument, at most 16 KB
    schema_version  integer NOT NULL,               -- copy of document.schema, for migrations
    updated_by      uuid NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX layouts_personal ON core.layouts (workspace_id, owner_user_id, screen) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX layouts_team     ON core.layouts (workspace_id, screen)                WHERE owner_user_id IS NULL;
```

Row-level security is the workspace policy every tenant table gets (`tenant_isolation`, [04-data-model.md](../../04-data-model.md) section 13). It does not separate members of one workspace, so the API does: personal routes read and write only rows where `owner_user_id` is the session user, and writes to the team default row need `layouts:manage`. Layouts hold no tenant data, so this is enough for the first release. Only the API role is granted access to the table; workers never read layouts.

It is a separate table from `core.saved_views` because a saved view belongs to a project and holds a table's query, while a layout belongs to a workspace and holds no query.

### 9.2 Routes

`{W}` is the workspace prefix of [19-api-specification.md](../../19-api-specification.md) section 2.2.

| Method | Path | Permission | Request | Response |
|---|---|---|---|---|
| GET | `{W}/layouts/{screen}` | any member | none | `One<ResolvedLayout>` with `ETag` |
| PUT | `{W}/me/layouts/{screen}` | any member, session only | `LayoutDocument`, `If-Match` | `One<ResolvedLayout>` |
| DELETE | `{W}/me/layouts/{screen}` | any member, session only | none | `204` |
| PUT | `{W}/layouts/{screen}/default` | `layouts:manage` | `LayoutDocument`, `If-Match` | `One<ResolvedLayout>` |
| DELETE | `{W}/layouts/{screen}/default` | `layouts:manage` | none | `204` |

```ts
interface ResolvedLayout {
  screen: ScreenKey;
  source: 'personal' | 'team' | 'builtin';
  document: LayoutDocument | null;   // null when source is 'builtin': the client holds the built-in default
  team_default_exists: boolean;
  updated_at: Iso | null;
  updated_by: { user_id: Uuid; name: string } | null;
}
```

- `GET` resolves personal, then team. It returns `source: 'builtin'` with a `null` document when neither exists. The built-in default lives in the client so it ships with the components it refers to.
- `PUT` validates the document: known screen, known `schema`, known card types and metric keys for that screen, allowed widths, limits, size. It answers `422 validation_failed` with field paths. Option contents are validated in the client by each card type's schema; the API checks only that `options` is an object within the size limit. The list of valid keys reaches the API as JSON generated from the catalog in `packages/contracts`.
- `If-Match` is required on `PUT` when a row exists. A mismatch is `412 precondition_failed`.
- Errors use the codes of 19 section 2.7. Layout routes are excluded from API keys, like the other `/me` mutations.

### 9.3 Permission

A new key in the permission matrix ([24-security.md](../../24-security.md) section 3.2): `layouts:manage`, granted to owner and admin. It is stricter than workspace saved views (editor and above) because a team default changes what every member sees on opening the product.

Personal layouts need no permission key: every member, including viewer, may arrange their own view.

Setting or removing a team default writes `ops.audit_logs` (`layout.default.set`, `layout.default.remove`) with the before and after documents.

## 10. Web app structure

```
packages/contracts/src/layouts/
  schema.ts            zod schemas: LayoutDocument, NumberItem, CardItem, ResolvedLayout
  catalog.ts           card type and number definitions (section 7), screen definitions and built-in defaults
  sanitize.ts          sanitizeLayout(document, screen, catalog): the four rules of section 6.3
  upgrade.ts           upgradeDocument(document): schema version steps
apps/web/src/features/layouts/
  registry.tsx         card type key -> lazy React component and its options form
  availability.ts      cardAvailability(definition, projectCapabilities, permissions)
  rows.ts              packRows(cards, columns): row packing for the grid and for drop targets
  draft.ts             reducer for customize mode: add, hide, move, setWidth, setOptions, reset; changeCount(a, b)
  use-layout.ts        TanStack Query read and the three mutations; fallback to the built-in default
  layout-provider.tsx  context for one screen: effective layout, mode (view or customize), draft, actions
  layout-grid.tsx      renders the cards zone in either mode
  card-frame.tsx       a card's frame and header; in customize mode, the toolbar of section 5.2
  number-strip.tsx     MetricStrip fed from the layout; in customize mode, section 5.3
  card-catalog-dialog.tsx, card-options-popover.tsx, layout-save-bar.tsx, customize-button.tsx
```

Boundaries:

- `packages/contracts/src/layouts` has no React and no fetching. Everything in it is a pure function or a constant, tested in isolation.
- A card component receives `{ options, width, mode }` and the page scope (project, window, location, compare) from context. It knows nothing about layouts. Existing panels become card components by being registered, not rewritten.
- `layout-provider` is the only place that knows both the stored layout and the draft. The grid, the strip and the drawer read from it.
- Drag and drop uses `@dnd-kit/core` and `@dnd-kit/sortable` (pointer, touch and keyboard sensors, built-in live announcements). It is imported only by `layout-grid.tsx` and `number-strip.tsx`.

Loading and performance:

- The layout request is small and cached per workspace; pages render the built-in default's skeleton while it loads, then the real layout. Skeletons use each card's final height so nothing shifts.
- Each card runs its own query. Cards below the fold mount when they come within one viewport of view.
- In customize mode, queries do not refetch and dragging moves cards with transforms, so reordering does not re-render card contents.

## 11. Accessibility

- Every drag has menu and keyboard equivalents (section 5.2). Nothing requires a pointer.
- Moves, hides and adds are announced through one polite live region. Focus stays on the moved card; after Hide it goes to the next card, to the previous one when the hidden card was last, or to "Add card" when none is left. A keyboard move at either end says so ("Rank distribution is already first").
- In customize mode, card content is `inert`, so Tab moves between card toolbars and not through every link inside every card.
- The Customize button is a toggle (`aria-pressed`). The "Customizing" badge is text, not color alone.
- Reduced motion: cards jump to their new place without animation.
- All controls meet the 32 px minimum of the design system; on touch devices the toolbar uses the 44 px touch sizes of [19-responsive-behavior.md](../../design-system/19-responsive-behavior.md) section 10.

## 12. Effect on existing specs

| Document | Change |
|---|---|
| design-system/24-page-templates.md | T1 describes the built-in default of a customizable page. "At most 5 major sections" and "no section repeats a headline metric" become rules for built-in defaults; customized pages are bounded by the limits of section 6.1 |
| design-system/23-application-patterns.md | New section: customize mode, card frame toolbar, catalog dialog, save bar use |
| design-system/16-drawers-dialogs-popovers.md | Section 2.4: drawer cards can be hidden, reordered and added; order is fixed per record type per person, not per product |
| design-system/25-component-inventory.md | New components of section 10 |
| design-system/20-accessibility.md | Section 7: card and number reordering added to the drag alternatives table |
| 04-data-model.md, 19-api-specification.md, 24-security.md | Table, routes and the `layouts:manage` key of section 9 |
| 20-frontend-specification.md | Overview and drawer sections point to the layout system; personal layout data is non-sensitive but is stored by the API, not in browser storage |

## 13. Testing

| Level | What |
|---|---|
| Unit (`packages/contracts`) | Schema accepts and rejects; `sanitizeLayout` for each of the four rules; `upgradeDocument`; built-in defaults are valid against the catalog |
| Unit (web) | `packRows` at each breakpoint; draft reducer actions; `changeCount`; `cardAvailability` for each requirement kind |
| Component | Keyboard reorder and its announcements; width control offers only allowed widths; catalog states; save bar states; number rules (engine required, limit of 6) |
| End to end (Playwright) | Customize, save, reload, other project: the layout persists. Reset. Team default set and removed by an admin; a member without the permission sees no team actions. `412` conflict dialog. A card unavailable in a project is skipped there and present elsewhere. Layout read failure falls back to the default and disables Customize |
| Accessibility | axe on a page in customize mode; the full flow with keyboard only |
| Visual regression | Overview in customize mode, the catalog dialog, the drawer in customize mode, light and dark |
| API | Validation failures, permission checks per role, workspace isolation, one member cannot read or write another member's personal layout through any route, ETag handling, audit log entries |

## 14. Delivery order

1. Contracts: schema, catalog, sanitize, built-in defaults for `overview`. Pure code with tests.
2. Static preview: customize mode on Overview (cards and numbers), the catalog with the six new cards, saving to browser storage, reset, a simulated team default. This is where the interaction is reviewed.
3. Static preview: drawer cards.
4. Design-system documents of section 12.
5. API: table, routes, permission, audit (with the platform foundation phase).
6. Web app: the structure of section 10 on Overview, then `ai_overview`, then numbers on table pages, then the drawers as they are built.

## 15. Status of the preview (2026-09-30)

Delivery steps 1 to 4 are done: the rules in `apps/web/src/lib/layouts` (47 unit tests), customize mode on the Overview and in the keyword drawer of the static preview, and the documents of section 12. What the preview does not show, because it has no server: the `412` conflict dialog, the "layout could not be loaded" fallback banner, saving and failed-save states of the save bar, and cards that are unavailable in a project (the preview project has both channels). The drawer's footer has no team-default menu in the preview. Layouts are kept in browser storage there.

Two things the build settled: card options are single-choice (enum) only in the first release, and a reusable card cannot take an option value another instance already uses (one Mention rate trend per engine). The second is a rule of the layout itself (`setCardOption` and sanitizing), not only of the options popover.

An independent code review of the build found one critical defect (a team default could be written from a draft that no longer existed) and fourteen smaller ones. All are fixed, and sections 5 and 6 above describe the corrected behavior. A second review of the fixes confirmed all fifteen and found one more inconsistency (the change count could disagree with the layout comparison) and seven small ones, also fixed. Two findings are left for the app: `addCard` does not check the screen (the catalog and sanitizing do), and the preview redraws every chart after each edit.

## 16. Open points

| # | Point | Proposed answer |
|---|---|---|
| 1 | Who may set the team default | Owner and admin (`layouts:manage`). Editors may not |
| 2 | Should a person be told when the team default changes after they customized | No notification. Customize mode shows "Your layout differs from the team default" with Reset |
| 3 | Editing on phones | Not in the first release |
| 4 | Costs page | Not customizable |
