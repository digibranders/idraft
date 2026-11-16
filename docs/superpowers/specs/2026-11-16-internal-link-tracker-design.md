# Internal link tracker

Status: scope agreed in chat with the owner on 2026-11-16. The written spec is awaiting review.
Research and mockups: the plan page "Internal Link Tracker" (claude.ai artifact DqoEZrSV3wA1oJmSMaUYNv). It has the competitor review, the DataForSEO facts and working mockups of every view named here.
Related: [04-data-model.md](../../04-data-model.md) sections 5.1 and 5.3, [06-dataforseo-seo-integration.md](../../06-dataforseo-seo-integration.md), [18-first-party-integrations.md](../../18-first-party-integrations.md), [32-page-performance.md](../../32-page-performance.md), design system [12-tables.md](../../design-system/12-tables.md), [15-data-visualization.md](../../design-system/15-data-visualization.md), [16-drawers-dialogs-popovers.md](../../design-system/16-drawers-dialogs-popovers.md), [20-accessibility.md](../../design-system/20-accessibility.md).

## 1. Goal

The user picks any page on their site and follows its internal links step by step: who links in, where it links out, and where those pages lead next. The user tags pages by tier (T1 for the pages that make money, down to T4 for utility pages). Then every view answers one question for an SEO executive: do the important pages get enough internal links and equity, and what should be fixed first?

Why it sells: no tool on the market combines hand-set tiers, a journey from any page, and link flow between tiers. idraft can also put rankings and Search Console clicks next to the links for the same URL.

## 2. Users and jobs

| Job | Who | What they need |
|---|---|---|
| Tag a new client site by importance | SEO executive at an agency | Bulk select, URL rules and CSV import, done in under 10 minutes for 2,000 pages |
| Check that money pages are well linked | SEO executive, SEO lead | T1 pages with few content links, deep pages and equity share, in one sorted list |
| Follow a page's link journey | SEO executive | A left-to-right canvas from any page, grown one step at a time |
| Explain the linking to a client | SEO lead, account manager | One number per tier ("T1 pages hold 31% of internal equity"), the tier flow matrix and a shareable link |
| Find fixes | SEO executive, developer | Broken and redirected links, orphans and links to non-indexable pages, grouped by placement so template fixes come first |

## 3. Scope

The owner put the journey canvas in slice 1 ("that is the main thing").

Slice 1:

- Crawl: automatically when a website is added (opt-out checkbox), weekly after that, and "Crawl now".
- Pages table with the slice 1 columns (section 7.2), filters, saved worklists and CSV export.
- Links table (every link edge) with filters and CSV export.
- Tiers: workspace tier settings, one tier per page, bulk tagging, URL rules and CSV import. Free tags through the existing taxonomy.
- Page inspector.
- Journey: canvas and tree list, sharing one focus page, placement switch and URL state.
- Tier flow matrix with equity share per tier.
- Worklists: under-linked T1 pages, orphans, broken and redirected links, links to non-indexable pages.

Later slices (named so nothing is lost):

| Left out | Slice |
|---|---|
| Path finder (shortest route from the home page, any link and content only) | 2 |
| Crawl-over-crawl changes, lost-link worklist, alerts on lost links to T1 and T2 | 2 |
| Anchor analysis: distinct anchors, generic anchor share, anchor matches the tracked keywords that target the URL | 2 |
| Tracked keyword and average rank columns | 2 |
| T1 pages linking out mostly to weak pages | 2 |
| Link opportunities (a page mentions a T1 page's keyword but does not link), accept and dismiss | 3 |
| Tier suggestions from tracked keyword targets and Search Console clicks | 3 |
| AI citation columns per page | 3 |
| Reordering tiers, per-project tier lists | When asked |
| Whole-site graph picture | When asked |

## 4. Concepts

| Concept | Definition |
|---|---|
| Tier | One level per page from the workspace's tier list, or Untiered. T1 is the most important. Decided by the owner on 2026-11-16: one tier per page plus free tags |
| Tags | Any number of free labels per page, as terms of a taxonomy vocabulary of kind `tag` (doc 04 section 5.3) |
| Placement | Where a link sits on the source page: `content`, `navigation`, `header`, `footer`, `sidebar`, `breadcrumb` |
| Linking pages | Unique pages that link to a page. Counts never use raw link totals. Every count comes in two forms: content links only, and all placements |
| Equity share | Internal PageRank of a page as a share of the whole crawl (section 6.4). Shares add up per tier |
| Click depth | Fewest clicks from the start page over followed links of any placement |
| Orphan | A URL found in the sitemap, or a page with Search Console clicks in the last 90 days, that no crawled page links to |
| Crawl | One run of the crawler over a project's site. Every number on screen belongs to one crawl, the latest finished one unless the user picks another |

## 5. Tiers and tags

### 5.1 Tier settings (workspace)

Tiers are set once for the workspace in Workspace settings, under Page tiers. Every project uses the same scale, so an agency's client reports read the same way. Owners and admins can edit; other roles see the list.

- A new workspace gets four tiers: T1 Money pages, T2 Supporting pages, T3 Content pages, T4 Utility pages, each with a one-line description. Existing workspaces get them in the migration.
- **Rename:** name (1 to 60 characters) and description (up to 200) are edited in place. Pages keep their tier because they store the tier id.
- **Add:** appends the next position (T5, then up to T8).
- **Delete:** a dialog shows the page count and the rules that use the tier, and asks for a target: another tier or Untiered. The pages and rules move in one transaction. A tier with no pages and no rules is deleted straight away. Positions close up (deleting T2 makes T3 the new T2), and the dialog says so.
- **Code and color:** the code (T1 to T8) and color come from the position. There is no color picker.
- **Where names show:** badges show the code only. Filters, tooltips, the inspector and CSV headers show code and name ("T1 Money pages").
- Untiered is fixed: it cannot be renamed or deleted.

### 5.2 Setting tiers on pages

- **Bulk:** select rows (shift-click selects a range, "Select all N matching" uses the current filter), then pick a tier in the bulk bar. Keys 1 to 8 set a tier on the selection and 0 clears it, through `useShortcut`, so the single-key switch in Preferences turns them off.
- **Rules:** ordered per project. The match types are `exact` (path), `prefix` (path starts with) and `pattern` (glob with `*`). Each rule names one tier. Saving shows a preview count first. Rules apply to every page of every crawl, so new pages arrive tagged.
- **CSV import:** columns `url` and `tier` (code or name). Rows whose URL is not in the latest crawl are listed back; they are stored and apply once a crawl finds the URL. Unknown tier names are errors with line numbers.
- **Precedence:** a manual tier beats any rule. The first matching rule wins. A page shows its source: "Manual, set by Priya on 12 Nov" or "Rule: path starts with /services/". "Reset to rule" removes a manual tier.
- Tiers attach to the URL, not to the crawl. They survive recrawls, and a tier change needs no crawl (section 6.6).

### 5.3 Tags

Bulk add and remove through the same bulk bar, using the project's or workspace's `tag` vocabulary. Tags filter the pages and links tables and the journey, and they never enter the tier maths.

## 6. Data and processing

### 6.1 Crawl provider

DataForSEO On-Page API (`POST /v3/on_page/task_post`) on the standard queue. Task settings:

| Setting | Value |
|---|---|
| `target` | Host of the project's `primary_domain_id` |
| `start_url` | `https://{host}/`, following redirects |
| `max_crawl_pages` | The safety ceiling (section 6.2) |
| `respect_sitemap` | true, for orphan detection. DataForSEO then returns `click_depth` 0, so we compute depth ourselves |
| `store_raw_html` | true, for link placement (section 6.3) |
| `enable_javascript` | Project setting "Render JavaScript", off by default. It costs 10 times the base price |
| Subdomains | Off. Project setting for allowed subdomains, empty by default |
| `pingback_url` | Our callback route, signed per task. The planner's poll is the fallback |

Results stay at DataForSEO for 30 days and raw HTML for 7, so ingest copies everything we need when the crawl finishes.

Cost: $0.00015 a page base and $0.0015 with JavaScript (verified on the pricing page, 2026-11-16). Every crawl writes its cost to the existing ledger and passes the workspace budget check like every other collection.

### 6.2 When crawls run

| Trigger | Behaviour |
|---|---|
| Website added | The new-project form and the onboarding step get a checkbox, ticked by default: "Map this site's internal links". When ticked, saving queues the first crawl. Onboarding does not wait for it |
| Weekly refresh | On by default. Project settings offer weekly, every two weeks, monthly or off. It runs at night in the project's time zone, spread by the planner |
| Crawl now | Button on the Internal links pages. Only one crawl per project runs at a time; while one runs, the button shows when it started |
| Tier, rule or tag change | No crawl. Section 6.6 |

**Limits:** none per plan for now (owner, 2026-11-16). One safety stop protects against crawl traps. The ceiling is three times the sitemap URL count, at least 2,000 and 50,000 when there is no sitemap. A crawl that reaches it ends as `stopped_at_ceiling`. The screen offers "Crawl again with a higher limit" (a new task with double the ceiling) and keeps the pages already found.

**Run states:** `queued`, `crawling` (with pages found so far, read from the `summary` endpoint), `processing`, `ready`, `stopped_at_ceiling`, `failed` (with the provider's reason), `cancelled`.

### 6.3 Ingest and placement

1. Read `/on_page/pages` and `/on_page/links` (internal direction, all pages through `search_after_token`) and `/on_page/non_indexable`. Upsert URLs through the existing `core.urls` path with canonicalizer v1.
2. Read raw HTML for each 200 page and store it zstd-compressed in R2, latest crawl only, so placement can be classified again if the classifier changes.
3. Classify each link's placement from the HTML. Match the link by source page and `href` in document order, then walk its ancestors:
   - `nav` or `role="navigation"` gives `navigation`
   - `header` or `role="banner"` outside `main` and `article` gives `header`
   - `footer` or `role="contentinfo"` outside `main` and `article` gives `footer`
   - `aside` or `role="complementary"` gives `sidebar`
   - an element marked as a breadcrumb (BreadcrumbList microdata, or `aria-label`, `class` or `id` containing "breadcrumb") gives `breadcrumb`
   - otherwise `content`

   Second pass, template detection: a link (same target, same anchor) that appears outside `main` on at least 50% of the pages in its top-level folder is treated as `navigation` when the first pass said `content`. The spike measures accuracy on three real sites (section 10).
4. Store the edges per crawl, deduplicated per (source, target, placement, anchor) with an occurrence count.

### 6.4 Metrics

All metrics are computed in the worker after ingest, per crawl:

- **Click depth:** breadth-first search from the start URL over followed links of every placement. A redirect counts as a hop to its target.
- **Equity share:** PageRank with damping 0.85, iterated until the largest change is under 1e-9 (at most 100 rounds), over unique followed (source, target) pairs of every placement.
  - A 3xx page passes everything to its redirect target.
  - Nofollow links count in the source's out-degree, but their share is dropped.
  - 4xx and 5xx pages keep what they receive and pass nothing on; this is reported as equity lost to errors.
  - Equity share is a page's value divided by the sum over all crawled URLs.
  - It is computed with a sparse matrix (numpy and scipy; adding them is a plan task).
- **Per page:** linking pages (content and all), linking pages per tier, internal outlinks (content and all), outlinks to T1, broken outlinks, links to redirects, links to non-indexable pages, top anchor, orphan flag.
- **Tier flow:** for content and for all placements, the number of unique (source, target) pairs from tier to tier, and each tier's equity share, page count and average depth.

### 6.5 Tables

Migration names and exact columns are settled in the plan. Workspace isolation follows doc 04 section 13.

| Table | Holds |
|---|---|
| `crawl.runs` | Project, provider task id, trigger (`website_added`, `schedule`, `manual`, `ceiling_retry`), settings snapshot, ceiling, state, pages found, pages crawled, cost, times, error |
| `crawl.pages` | Per run and URL: status code, redirect target, indexable flag and reason, canonical URL, title, in sitemap, depth, the per-page metrics of section 6.4 |
| `crawl.links` | Per run: source URL id, target URL id, anchor (or image alt), kind (text or image), placement, rel, occurrences. Partitioned by run, with an index on (run, source) and (run, target). The last 4 runs are kept in full; older partitions are dropped |
| `crawl.tier_flow` | Per run, placement scope and tier pair: link count. Per run and tier: equity share, pages, average depth. Recomputed on tier change |
| `core.page_tier_levels` | Per workspace: id, position (1 to 8), name, description |
| `core.project_pages` | Per project and URL: tier id (nullable), tier source (`manual`, `rule`), rule id, set by, set at |
| `core.tier_rules` | Per project: position, match type, value, tier id |
| `core.page_terms` | Project, URL, taxonomy term (tags) |

`crawl.pages` is kept for every run (about 10,000 rows per run for a 10,000-page site) so slice 2 can chart change. `crawl.links` for a 10,000-page site is about 600,000 rows and 25 MB per run.

### 6.6 Tier changes

A tier or rule change updates `core.project_pages`, then recomputes `crawl.tier_flow` and the tier-based page columns for the latest run. That is a query over stored rows, with no crawl. It runs in the request for up to 5,000 changed pages, and as a `process` job above that. The table shows the static refetch bar while it runs.

## 7. Screens

### 7.1 Place in the app

A new SEO sidebar item, "Internal links", with tabs Pages, Links, Journey and Tier flow. Worklists are saved views of the Pages and Links tabs, with counts in the page header. Exact routes follow the existing project routes and are settled in the plan.

The page header shows the crawl in scope ("Crawled 14 Nov, 2,148 pages") with a menu of earlier runs, plus Crawl now and Export.

### 7.2 Pages tab

A `DataTable` with selection, the bulk bar, the `FilterBar` (tier, tag, status, indexable, placement scope, flags) and the column chooser. The placement scope is one chip, "Content links" (default) or "All links". It changes every link count on the screen.

Default columns:

- Page (path, title below)
- Tier
- Status
- Depth
- Linking pages
- Linked from tiers (a small stacked bar of linking pages per tier, with the counts in its tooltip and text alternative)
- Outlinks
- Equity share
- Flags

In the chooser: tags, indexability reason, in sitemap, outlinks to T1, broken outlinks, links to redirects, links to non-indexable pages, top anchor, and GSC clicks and impressions when Search Console is connected (labeled as Google data, last 28 days).

Rows open the page inspector. The path cell has "Open in journey".

### 7.3 Links tab

A `DataTable` of edges with these columns:

- Source page, Source tier
- Target page, Target tier
- Anchor
- Placement, Rel
- Target status (with redirect hops)
- Target indexable
- Occurrences

It uses the same filters plus source and target search. Export follows the filter.

### 7.4 Page inspector

Standard 400 px inspector with these parts:

- tier (editable) and its source, tags
- a metric strip: depth, linking pages, equity share, outlinks
- linking pages by tier and by placement
- top 5 anchors pointing here
- capped tables of linking pages and outlinks
- flags with their counts
- "Open in journey"

### 7.5 Journey tab

The canvas and the tree list share one state: focus page, placement scope and opened cards. It is kept in the URL through the shared `nuqs` parsers, so a link reproduces the view.

**Canvas** (`LinkCanvas`, a new application component):

- **Layout:** columns left to right. Column 1 lists pages linking in to the focus page, grouped by tier with counts, at most 8 per tier with "+N more". Column 2 is the focus card. Column 3 lists the focus page's outlinks. Each further column holds the outlinks of the cards opened in the column before, grouped under their parent. Edges run from parent to child.
- **Growing:** nothing opens by itself. Activating a card opens or closes its next step. At most 8 children show per card, then "+N more" adds the next 8. Children sort by tier, then by equity share.
- **Repeats:** a page already on the canvas appears again as a dashed stub, "On the canvas at step 2", which cannot open. Loops cannot grow the canvas.
- **Placement:** with "Content links" on, only content links draw. With it off, a page's non-content links collapse into one group card ("Navigation and footer: 9 links") that opens like any card. Content edges are solid, other placements dashed, links to redirects amber and broken targets red, with a legend.
- **Card:** a left edge in the tier color, the path, the link's anchor and placement, then the tier code, linking pages and equity share. A status badge shows when the page is not 200.
- **Tooltip** (house tooltip): title, tier name, status, depth, linking pages (content and all), equity share, this link's placement and rel.
- **Re-center:** each card has "Focus", which makes it the new focus. The URL updates, so Back returns to the previous focus.
- **Size:** the canvas holds at most 300 cards. Past that, opening is refused with a message pointing to the tree list or a tier filter.
- **Viewport:** zoom in, zoom out and fit-to-view buttons (the non-drag alternative to pan and zoom). There is no minimap. Nothing animates on load; layout changes move in 150 ms and do not move under reduced motion.
- **Keyboard:** arrows move between cards in reading order (left and right across columns, up and down within one). Enter or Space opens or closes. F re-centers. Escape returns to the focus card. Each card is a button whose accessible name reads like "/pricing, T1 Money pages, 12 linking pages, linked as See plans, content". The canvas region names the tree list as its text alternative.
- **Technology:** React Flow (`@xyflow/react`, MIT) for rendering, viewport and edges, and `elkjs` (layered, direction right) for positions. Cards are our own components, so tokens, badges, focus rings and tooltips match the design system. Both are new web dependencies. The canvas is a new design-system component: its spec, tokens and preview section land before any feature code (UI rule "When something is missing").

**Tree list:** `DataTable` in tree mode with lazy children from the neighbours endpoint.

- Columns: Page, Tier, Anchor, Placement, Linking pages, Equity share, Status.
- Repeats show "Listed above" and do not expand.
- It is the canvas's text alternative and the better view for scanning anchors.

**Empty and edge states:**

- A focus page with no in-links says so and suggests turning off "Content links".
- A focus page that is a redirect shows one child: its target.
- A focus page that is not in the crawl offers a search for crawled pages.

### 7.6 Tier flow tab

- **Matrix:** an ECharts heatmap (already imported) with rows "from tier" and columns "to tier". Cells hold unique link counts, with a table alternative. Clicking a cell opens the Links tab filtered to that pair.
- **Strip:** a `MetricStrip` with each tier's equity share, page count and average depth.
- **Scope:** the placement chip applies here too.
- **Untiered:** it shows as its own row and column, so untagged pages are visible rather than hidden.

### 7.7 Tier settings

Workspace settings section "Page tiers" as specified in section 5.1: a `DataTable` with code, name, description and page count, plus the add, rename and delete dialogs. The page count comes from `core.project_pages` across the workspace's projects.

### 7.8 Website-added checkbox and project settings

- The new-project form and the onboarding step get the checkbox from section 6.2.
- Project settings get an "Internal links" section with these settings:
  - crawl schedule (weekly, every two weeks, monthly, off)
  - Render JavaScript, with the cost multiplier stated
  - allowed subdomains
  - a list of recent crawls with state, pages and cost

### 7.9 Design-system additions (before the screens)

- **Tier color tokens:** `--tier-1` to `--tier-8` and `--tier-none`, one cobalt sequential scale per theme, darkest for T1. They need contrast tests against `surface` in both themes (the card edge needs 3:1, and every badge pairs its color with the code text).
- **`TierBadge`:** an outline badge with a color square and the code.
- **`LinkCanvas` and `LinkCard`:** spec, states (default, hover, focus, opened, stub, group, error target), keyboard model and preview entry.
- **`StackedMiniBar`** for "Linked from tiers", if the existing bar parts do not cover it. The plan checks the inventory first.

## 8. API

`{P}` is `/api/v1/projects/{project_id}`. Every list takes `run` (default `latest`), `placement` (`content` or `all`, default `content`), cursor paging and `format=csv` where export applies.

| Method and path | Purpose |
|---|---|
| `GET {P}/link-crawls`, `POST {P}/link-crawls`, `GET {P}/link-crawls/{id}`, `POST {P}/link-crawls/{id}/cancel` | Runs, Crawl now, progress and cancel |
| `GET {P}/internal-links/pages` | Pages table (filters, sort, columns of section 7.2) |
| `GET {P}/internal-links/pages/{url_id}` | Inspector payload |
| `GET {P}/internal-links/edges` | Links table |
| `GET {P}/internal-links/neighbors` | One journey step. Takes `url_id`, `direction` (`in` or `out`), `limit` (8), `offset`. Returns children with edge fields, tier, metrics and `has_children` |
| `GET {P}/internal-links/tier-flow` | Matrix and per-tier strip |
| `GET {P}/internal-links/worklists` | Counts for the saved views |
| `PUT {P}/pages/tiers` | Bulk set or clear a tier: `{url_ids}` or `{filter}`, plus `{tier_id or null}` |
| `POST {P}/pages/tiers/reset` | Reset pages to their rule tier |
| `POST {P}/pages/tiers/import` | CSV import, which returns accepted, pending and error rows |
| `GET/POST/PATCH/DELETE {P}/tier-rules`, `POST {P}/tier-rules/preview` | Rules and preview count |
| `PUT {P}/pages/tags` | Bulk add and remove tag terms |
| `GET/POST/PATCH /api/v1/workspaces/{w}/page-tiers`, `DELETE .../page-tiers/{id}` with `{move_to}` | Tier settings |

The project settings model gains `internal_links: {schedule, render_javascript, allowed_subdomains}`. Backend commits update `backend/openapi/v1.json`, and the web side regenerates the client in its own commit (AGENTS.md).

## 9. Errors and states

| Case | What the user sees |
|---|---|
| No website on the project | Internal links explains that a website is needed and links to project settings |
| First crawl running | Progress with pages found so far. Tables are skeletons, never empty |
| Crawl failed | Banner with the provider reason in plain words, Retry, and the last good crawl still shown |
| Stopped at the ceiling | Banner: "Stopped at 6,000 pages. The site has far more URLs than its sitemap lists". Offers "Crawl again with a higher limit" and keeps the data |
| Site blocks the crawler (403 on the start page) | Specific message suggesting the client allow the crawler's user agent |
| Very few pages and a script-heavy start page | Suggests turning on Render JavaScript, with its cost |
| Budget exceeded | The existing budget message; the crawl is not queued |
| Raw HTML missing for a page | Its links stay `content` by default and the page is flagged "Placement unknown" in the inspector |

## 10. Spike first (one day)

Run on one real client site and two public sites of different builds (WordPress, a JavaScript framework, a custom CMS) to measure:

1. Crawl speed in pages per minute, and whether `max_crawl_pages` stops cleanly.
2. Whether `store_raw_html` changes the price, and the call limits of `raw_html`.
3. What `respect_sitemap` does to scope and orphan flags.
4. Placement classifier accuracy against a hand check of 100 links per site. The target is 95% for `content` versus template links.
5. Whether `/links` returns the anchor text and rel we expect for image links and redirects.

The plan adjusts sections 6.1 to 6.3 from the results before the backend tasks start.

## 11. Testing

- **Backend unit:**
  - placement classifier on HTML fixtures (nav, header inside `main`, breadcrumbs, template detection)
  - PageRank on small graphs with known answers (sums to 1, redirect pass-through, nofollow dropped, error sink)
  - depth through redirects
  - rule matching and precedence
  - tier delete with move
  - ceiling logic
- **Backend integration:**
  - ingest from recorded DataForSEO payloads in `fixtures/`
  - the API under tenancy and row-level security, including that one workspace cannot read another's tiers or crawls
- **Web unit and axe:**
  - `TierBadge`, `LinkCard`, `LinkCanvas` (keyboard order, accessible names, refusal at 300 cards), bulk bar, tier settings dialogs, in both themes
- **Playwright flow:**
  - add a project with the checkbox ticked
  - see crawl progress (mocked)
  - tag 20 pages in bulk and by rule
  - see the tier flow change
  - open the journey, expand two steps, re-center, switch to the tree list
  - reload and get the same view from the URL
- Visual baselines for the four tabs and tier settings.

## 12. Order of work

1. Spike (section 10).
2. Design-system additions (section 7.9) with preview entries.
3. Backend: migrations and tier seed; crawl workload (submit, progress, ingest, cost ledger); placement and metrics; tiers, rules, tags and CSV API; read API; triggers (website added, schedule, Crawl now).
4. Web: tier settings; Pages tab with bulk tagging, rules and CSV; inspector; Journey canvas and tree list; Links tab; Tier flow; website-added checkbox and project settings; states.
5. The Playwright flow and the acceptance run on the spike site.

Backend and web can run as two tracks once the API contract (section 8) is written into the OpenAPI file.

## 13. Decisions and open points

Decided by the owner on 2026-11-16:

- One tier per page plus free tags.
- T1 to T4 by default. The workspace can rename, describe and add up to 8. There is no reordering and no per-project lists for now.
- The journey canvas is in slice 1.
- No crawl limits per plan for now; pricing comes later. The crawl-trap safety stop stays.
- Crawl automatically when a website is added (opt-out), weekly after that, and Crawl now.

Recommended, awaiting the owner:

- **Build order:** this feature as its own track next to the AI visibility program, after the spike. The shared files are `apps/web/messages/en.json`, the design-system registry and `backend/openapi/v1.json`.

Open until the spike:

- Ceiling multiplier and the no-sitemap default (section 6.2).
- The template-detection threshold (section 6.3).
- Whether raw HTML is fetched for every page or only for pages in templates the first pass cannot classify.
