# 07. Icons

Status: Accepted (design-system v2)
Last updated: 2026-09-29

## 1. Library

**Lucide** (`lucide-react` 1.x, 1.48.0 at 2026-09-29) is the only icon library. Lucide v1 has no brand icons; engine logos come from a separate, pinned package through `EngineLogo` and are not icons (section 5). It is the shadcn/ui default, has a consistent 24 px grid and stroke style, and tree-shakes per icon. Other icon packages are blocked by lint, except `@lobehub/icons-static-svg`, which only `EngineLogo` may import. If Lucide lacks a glyph, the options in order are: a different Lucide glyph with a text label, a text label alone, or a design-system request to add a custom icon drawn on Lucide's grid and stroke (stored in `components/ui/icons/custom/` and reviewed like any component). Engine and brand logos are not icons (section 5).

## 2. Sizes and stroke

| Size | Token | Stroke width | Use |
|---|---|---|---|
| 12 px | `size-icon-xs` | 1.5 | Inside badges (the check in a positive badge), delta arrows next to 12 px text |
| 14 px | `size-icon-sm` | 1.75 | Table cells, icon buttons inside 32 px rows, the × in applied filter chips, menu items |
| **16 px** | `size-icon` | **1.75** | Default: buttons, inputs and the search field, tabs, icon buttons in tables and inspectors, change feed rows, rule list rows, SERP feature icons |
| 18 px | `size-icon-md` | 1.75 | Sidebar navigation items, top bar actions |
| 20 px | `size-icon-lg` | 1.5 | Empty-state icon, dialog status icon |

Stroke width is set once for the whole app with Lucide v1's `LucideProvider` (default stroke 1.75, `nonScalingStroke`, which replaced the deprecated `absoluteStrokeWidth` in lucide-react 1.x; verified 2026-09-29) and per size by the shared `Icon` wrapper (`components/ui/icon.tsx`). Components never pass their own stroke width. Lucide v1 sets `aria-hidden` on icons by default; the accessible name always comes from the control or an adjacent label.

## 3. Color and alignment

- Icons inherit `currentColor`. Default icon color is `foreground-tertiary` when next to text, `foreground-secondary` in icon-only buttons (darker on hover), and the semantic `-text` color in status contexts.
- The active sidebar item's icon is `primary-text`, like its label. Primary buttons use a `primary-foreground` icon.
- Change feed icons are `positive-text` or `negative-text` for rank moves and `foreground-tertiary` for every other event type.
- Icons are vertically centered with the text's x-height by flex alignment (`items-center`) and never nudged with margins.
- Icon to label gap: 8 px in buttons and menu items, 12 px in sidebar items, 6 px in tabs and chips, 4 px in badges.
- Leading icons only, except the trailing chevron in select triggers and the trailing external-link icon on external links.

## 4. Icon-only controls

An icon-only control must have:
1. an accessible name (`aria-label`) that matches the tooltip text,
2. a tooltip that appears on hover and keyboard focus after 400 ms, with the shortcut if one exists,
3. a 24 px minimum target: 24 px inside 32 px rows, 32 px (`h-control-sm`) in tables, inspectors, toolbars and everywhere else.

Icon-only is allowed only for universally understood actions (close, more, copy, external link, collapse sidebar, settings, search, filter, sort direction, density, column chooser, previous and next record or page, open page (`Maximize2` in the inspector header, tooltip "Open page"), clear, metric info, show secret, stepper decrease and increase, help menu, theme menu, notifications) and for the collapsed sidebar. Everything else has a text label.

## 5. Engines, brands and favicons

| Case | Treatment |
|---|---|
| AI engines (ChatGPT, Gemini, Google AI Mode, Google AI Overview, Perplexity) | `EngineLogo`: the vendor's mark at 16 px, always immediately left of the engine's name, 8 px apart ([ADR-DS-020](adr/ADR-DS-020-engine-logos.md)). Rules: (1) never alone: the name is always beside it, so the image is decorative (`alt=""`) and the name stays the accessible label; (2) source is `@lobehub/icons-static-svg` at a pinned version, full-color marks, never recolored, cropped, outlined or put on a colored tile; (3) the OpenAI mark is monochrome and follows the text color (black in light theme, white in dark); (4) Google AI Mode and Google AI Overview both use the Google mark, because neither surface has a mark of its own; the name tells them apart; (5) fixed 16 by 16 px box with explicit `width` and `height` so rows never shift; an engine without a mark shows the name alone; (6) where: engine lists and engine columns (inspector "AI mentions by engine", per-engine tables, Settings > Engines, `EngineBadge` when `logo` is set). In chart legends and small-multiple row labels the logo follows the series color dot (the dot stays, because it is the key to the line color). Not in column headers of dense keyword tables. Logos are trademarks of their owners and are used only to identify the engine; confirm each vendor's brand guidelines before public launch. `EngineLogo` has a `hidden` prop so logos can be turned off in one place |
| Domains in tables | 16 px favicon from one allowlisted favicon endpoint (configured in the CSP), lazy-loaded into a fixed 16 x 16 px box so rows never shift, with `alt=""` because the domain text is always adjacent. A neutral placeholder square replaces it on error or when the "Show favicons" setting is off. Favicons appear only in domain-first tables (Citations, Sources, Competitors) through `DomainCell`; never in keyword or prompt tables and nowhere else in the UI ([12-tables.md](12-tables.md) section 6, [26-implementation-guidelines.md](26-implementation-guidelines.md) section 12) |
| Our own product mark | Sidebar top only. The workspace switcher shows a 28 px monogram square (radius 6; near black in light theme, cobalt in dark), not an icon |

## 6. Standard glyph assignments

Using the same glyph for the same concept everywhere matters more than the specific choice.

| Concept | Lucide icon |
|---|---|
| Overview | `LayoutDashboard` |
| Matrix | `Grid2x2` |
| Rankings | `ListOrdered` |
| Keywords | `KeyRound` is **not** used (means credentials); use `Tag` |
| Pages | `FileText` |
| AI Visibility | `Sparkles` is **not** used (hype); use `MessageSquareText` |
| Prompts | `MessageSquare` |
| Citations | `Quote` |
| Sources | `Globe` |
| Competitors | `Swords` is **not** used; use `Users` |
| Topics | `FolderTree` |
| Discover | `Compass` |
| Reports | `FileChartColumn` |
| Integrations | `Plug` |
| Settings | `Settings` |
| Alerts, notifications | `Bell` |
| Filter | `ListFilter` |
| Sort ascending / descending | `ArrowUpNarrowWide` / `ArrowDownWideNarrow` |
| Columns | `Columns3` |
| Density | `Rows3` |
| Export | `Download` |
| External link | `ExternalLink` |
| Copy | `Copy` |
| More | `Ellipsis` |
| Close, clear a value, remove a chip or tag | `X` |
| Search, command palette | `Search` |
| Breadcrumb root (the project) in the top bar | `House`, 16 px, `foreground-tertiary` |
| Breadcrumb separator | `ChevronRight`, 14 px, `foreground-muted` ([11-navigation.md](11-navigation.md) section 4) |
| Open page (inspector header) | `Maximize2`, in a 32 px icon button with the tooltip "Open page", next to close (`X`) ([16-drawers-dialogs-popovers.md](16-drawers-dialogs-popovers.md) section 2.1) |
| Help menu (top bar) | `CircleHelp` ([20-accessibility.md](20-accessibility.md) section 15) |
| Info / methodology | `Info` |
| Warning | `TriangleAlert` |
| Error, failed status | `CircleX` |
| Critical alert severity | `OctagonAlert` (reserved for critical; a failed status keeps `CircleX`, [18-notifications-alerts.md](18-notifications-alerts.md) section 2) |
| Success, completed | `CircleCheck` |
| Running | `LoaderCircle` (rotating only while running) |
| Queued | `CalendarClock` |
| Partial data | `CircleDashed` |
| Provider delayed | `Hourglass` |
| Cancelled | `CircleSlash` |
| Stale | `Clock` |
| Cost, budget blocked run status | `Receipt` |
| Version boundary (prompt version, extractor, model, panel membership) | `GitCommitVertical` |
| Setup step to do / done | `Circle` / `CircleCheck` |
| Locked core panel prompt | `Lock` |
| Selected item, checked checkbox, copied, mark as read | `Check` |
| Indeterminate checkbox; stepper decrease / increase | `Minus`; `Minus` / `Plus` |
| Date picker trigger, top-bar date range button | `Calendar` |
| Top-bar location button | `MapPin` |
| Show secret value | `Eye` |
| File upload | `Upload` |
| Direction and disclosure (chevrons; the control's name carries the meaning) | `ChevronUp` / `ChevronDown`: previous and next record in the inspector. `ChevronLeft` / `ChevronRight`: previous and next page; `ChevronLeft` alone: back in a sheet. `ChevronRight` between breadcrumb items: separator. Trailing `ChevronDown`: opens a select or menu, or expands a disclosure group. Trailing `ChevronRight`: submenu |
| Rank improved / declined | text arrows `↑` `↓` in type, not icons |
| Engine status in prompt-by-engine cells (cited, mentioned, not mentioned) | Not an icon: `EngineStatusGlyph` draws a 10 px filled `primary` circle, a 10 px circle with a 2 px `primary` ring, or a 6 px `foreground-muted` dot, each with an accessible name |
| Engine presence (per-engine columns) | Not an icon: `EnginePresenceSquare`, an 8 px square with `rounded-2xs` (2 px), `primary` when present and `border` when absent |
| AI Overview status | `ScanSearch` |
| Citation present | `Link2` |
| Mention present | `AtSign` |
| Recommended | `ThumbsUp` is **not** used (casual); use `BadgeCheck` |

Status glyphs follow [17-empty-loading-error-states.md](17-empty-loading-error-states.md) sections 4.1 and 6. `EventTimeline` event types reuse the concept glyphs above, with one exception: rank moves use `TrendingUp` or `TrendingDown` by direction (colored only when emphasized), and a new or lost ranking uses `ListOrdered` ([18-notifications-alerts.md](18-notifications-alerts.md) section 7.1). The others: ranking URL change `FileText`, SERP feature or AI Overview change `ScanSearch`, citation `Link2`, mention `AtSign`, competitor overtook `Users`, version boundary `GitCommitVertical`, alert fired the severity icon ([18-notifications-alerts.md](18-notifications-alerts.md) section 7).

Changing an assignment is a design-system change.
