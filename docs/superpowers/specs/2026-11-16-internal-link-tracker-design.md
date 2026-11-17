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
| Check that money pages are well linked | SEO executive, SEO lead | T1 pages with few editorial links, deep pages and equity share, in one sorted list |
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
- Journey: canvas and tree list, sharing one focus page, link scope and URL state. Both sides grow step by step (links out to the right, links in to the left). Back links, pages seen elsewhere and two-way links are marked, not repeated (section 7.5).
- Link scope everywhere: editorial, auto-generated (previous and next, related posts), template, all.
- Tier flow matrix with equity share per tier.
- Worklists: under-linked T1 pages, orphans, editorial orphans, deep only through previous and next, broken and redirected links, links to non-indexable pages.

Later slices (named so nothing is lost). On 2026-11-16 the owner asked for every row below to be built in the design preview too, so the whole feature can be reviewed in one place; section 7.10 describes those screens. The real app still ships in these slices.

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
| Placement | Where a link sits on the source page: `content`, `auto_generated`, `navigation`, `header`, `footer`, `sidebar`, `breadcrumb` |
| Link scope | The three groups the screens filter by. **Editorial** is `content`: links a person placed in the body. **Auto-generated** is `auto_generated`: links the CMS writes per page, such as previous and next, related, recent and popular posts, and tag and category lists. **Template** is navigation, header, footer, sidebar and breadcrumb: the same links on many pages. "All" is the three together |
| Linking pages | Unique pages that link to a page. Counts never use raw link totals. Every count follows the link scope in view, editorial by default |
| Equity share | Internal PageRank of a page as a share of the whole crawl (section 6.4). Shares add up per tier. It always uses every followed link, whatever the scope in view, because search engines follow them all |
| Click depth | Fewest clicks from the start page over followed links of any placement |
| Editorial orphan | A crawled page that no editorial link reaches: it is found only through menus, previous and next, or related blocks |
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
3. Classify each link's placement from the HTML. Match the link by source page and `href` in document order. The first rule that matches wins:
   1. **Auto-generated by marker:** the link has `rel="prev"` or `rel="next"`, or an ancestor's `aria-label`, `class` or `id` names article navigation, post navigation, pagination, related, recent, popular, more posts or similar. Also when the link's accessible text starts with "Previous" or "Next" followed by a title. Gives `auto_generated`. This catches the pattern found on cleanstart.com on 2026-11-16: `<a rel="prev">` and `<a rel="next">` in a `<section aria-label="Article navigation">`, inside `main` but outside `article`, and not a `nav`. WordPress's `nav.post-navigation` is caught here too.
   2. **Breadcrumb:** an element marked as a breadcrumb (BreadcrumbList microdata, or `aria-label`, `class` or `id` containing "breadcrumb") gives `breadcrumb`.
   3. **Landmarks:**
      - `nav` or `role="navigation"` gives `navigation`
      - `header` or `role="banner"` outside `main` and `article` gives `header`
      - `footer` or `role="contentinfo"` outside `main` and `article` gives `footer`
      - `aside` or `role="complementary"` gives `sidebar`
   4. **Outside the article:** when the page has exactly one `article` element, a link inside `main` but outside that `article` is not `content`. It goes to the template pass below, and stays `auto_generated` if no other rule claims it.
   5. Otherwise `content`.

   Second pass, template blocks. For every link, take the structural path of its nearest block container (tag names and stable class names, with list positions removed). Group the paths by top-level folder.
   - If one container path appears on at least 50% of a folder's pages and links to the **same** targets on them, its links are `navigation`.
   - If it links to **different** targets page by page, they are `auto_generated`. This catches related-post widgets that carry no marker.
   - The pass only changes links that the first pass called `content` or left open by rule 4.

   Jump links to the same page (`#section`) and links from a page to itself are dropped before classification. Buttons and script-only controls are not links and never count. The spike measures accuracy on real sites, cleanstart.com among them (section 10).
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
- **Depth without auto-generated links:** the same search, leaving out `auto_generated` links. A page is flagged "Deep only through previous and next" when it cannot be reached this way, or sits more than 3 clicks deeper than its click depth. Example: an old post that is 12 clicks deep because "Next" is the only way in.
- **Per page, per link scope** (editorial, auto-generated, template, all): linking pages, linking pages per tier and internal outlinks. Plus outlinks to T1, broken outlinks, links to redirects, links to non-indexable pages, top anchor, orphan flag and editorial orphan flag.
- **Reciprocal pairs:** a flag per (source, target) edge when the target links back to the source in the same scope. The journey and the inspector use it ("Links both ways").
- **Tier flow:** per link scope, the number of unique (source, target) pairs from tier to tier, and each tier's equity share, page count and average depth.

### 6.5 Tables

Migration names and exact columns are settled in the plan. Workspace isolation follows doc 04 section 13.

| Table | Holds |
|---|---|
| `crawl.runs` | Project, provider task id, trigger (`website_added`, `schedule`, `manual`, `ceiling_retry`), settings snapshot, ceiling, state, pages found, pages crawled, cost, times, error |
| `crawl.pages` | Per run and URL: status code, redirect target, indexable flag and reason, canonical URL, title, in sitemap, depth, the per-page metrics of section 6.4 |
| `crawl.links` | Per run: source URL id, target URL id, anchor (or image alt), kind (text or image), placement, rel, occurrences. Partitioned by run, with an index on (run, source) and (run, target). The last 4 runs are kept in full; older partitions are dropped |
| `crawl.tier_flow` | Per run, link scope and tier pair: link count. Per run and tier: equity share, pages, average depth. Recomputed on tier change |
| `core.page_tier_levels` | Per workspace: id, position (1 to 8), name, description |
| `core.project_pages` | Per project and URL: tier id (nullable), tier source (`manual`, `rule`), rule id, set by, set at |
| `core.tier_rules` | Per project: position, match type, value, tier id |
| `core.page_terms` | Project, URL, taxonomy term (tags) |

`crawl.pages` is kept for every run (about 10,000 rows per run for a 10,000-page site) so slice 2 can chart change. `crawl.links` for a 10,000-page site is about 600,000 rows and 25 MB per run.

### 6.6 Tier changes

A tier or rule change updates `core.project_pages`, then recomputes `crawl.tier_flow` and the tier-based page columns for the latest run. That is a query over stored rows, with no crawl. It runs in the request for up to 5,000 changed pages, and as a `process` job above that. The table shows the static refetch bar while it runs.

## 7. Screens

### 7.1 Place in the app

A new SEO sidebar item, "Internal links", with tabs Pages, Links, Journey and Tier flow (slice 1), then Changes and Opportunities (slices 2 and 3, section 7.10). Worklists are saved views of the Pages and Links tabs, with counts in the page header. Exact routes follow the existing project routes and are settled in the plan.

The page header shows the crawl in scope ("Crawled 14 Nov, 2,148 pages") with a menu of earlier runs, plus Crawl now and Export.

### 7.2 Pages tab

A `DataTable` with selection, the bulk bar, the `FilterBar` (tier, tag, status, indexable, link scope, flags) and the column chooser. The link scope is one chip with Editorial (default), Auto-generated, Template and All. It changes every link count on the screen, but never equity share or click depth.

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

Flags include Orphan, Editorial orphan ("No editorial links in") and "Deep only through previous and next", next to the error flags.

Rows open the page inspector. The path cell has "Open in journey".

Saved worklists in slice 1:

| Worklist | Rule |
|---|---|
| Under-linked T1 pages | T1 pages with fewer than 3 editorial linking pages, deeper than 3 clicks, or in the lowest quarter of equity share |
| Orphans | No internal links in from any scope |
| Editorial orphans | Linked only by menus, footers, previous and next, or related blocks |
| Deep only through previous and next | The flag of section 6.4, mostly old blog posts |
| Broken and redirected links | Links to 4xx, 5xx or through redirects, grouped by scope so template fixes come first |
| Links to non-indexable pages | Targets that are noindex, canonicalised elsewhere or blocked |

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

The canvas and the tree list share one state: focus page, link scope and opened cards on both sides. It is kept in the URL through the shared `nuqs` parsers, so a link reproduces the view.

**Canvas** (`LinkCanvas`, a new application component):

- **Layout:** the focus card sits in the middle column.
  - **The focus card stands out** (decided 2026-11-17) so nobody has to hunt for it: a wider column (288 px against 240), a 2 px primary border with a soft primary halo behind it, a larger path, a third line ("N out" and "N clicks from home"), and a primary "Focus page" badge as the column heading. When the card is out of view, a "Back to the focus page" button appears in the top left of the canvas.
  - **Right side, links out:** the next column holds the focus page's outlinks. Each further column holds the outlinks of the cards opened in the column before, grouped under their parent.
  - **Left side, links in:** the column before the focus holds the pages that link in, grouped by tier with counts. Opening one of them adds a further column to the left with the pages that link to it, and so on. This is the backward journey: who feeds the pages that feed this one.
  - Edges always point the way the link goes: from the linking page to the linked page. Each link is its own smooth curve that leaves the source level and arrives at the target level, with a small dot at the source and an arrowhead at the target, in the line colour. Curves fan out from a card with many links, so every line can be followed (a shared vertical trunk, tried first, drew them on top of each other). Columns are 112 px apart to give the curves room.
- **Two layouts** (prototyped in the mock 2026-11-17; a switch "By step | By tier" next to the scope switch):
  - **By step** is the layout above: columns of click distance from the focus page. It answers "how do I click from here to there".
  - **By tier** has one lane per tier, lowest on the left (Untiered, T4, T3, T2) and T1 on the right, with the focus page in its own lane (tinted, wider). A link that runs left to right goes up toward the money pages, so the picture answers the SEO questions: do supporting pages link up to this page, which tier is missing, does a money page link down a tier.
    - A page is one card however many links reach it. Every link between cards on the canvas is a line, so a page reached twice shows two lines, not two cards.
    - Line colour says the direction: green up a tier, blue down a tier, grey dashed sideways in the same tier; amber (redirect) and red (broken target) still win. Lines to a lower lane enter the card from its right edge; same-lane lines swing round the right side of the cards, each by a different amount, so they do not run over the cards they pass.
    - A lane header shows the tier and how many pages are in view. An empty lane says "No T2 page in view", which is a finding.
    - **Tiers shown:** a chip per tier turns a lane off or on, to look at T1 and T2 only, say. The focus page's own lane cannot be turned off. The Untiered lane appears only when an untiered page is in view.
    - The first view fits all lanes down to 50%, and shows the lanes nearest T1 at 50% beyond that. Open, move, select, pan and zoom work as in By step.
    - Not in the prototype: a count such as "3 of 8 T2 pages link up to this page", adding every page of a tier to its lane (to see the ones that do not link here), and the layout in the address.
- **Growing:** nothing opens by itself. Activating a card opens or closes its next step, on either side. At most 8 children show per card (per tier on the first in-link column), then "+N more" adds the next 8. Children sort by tier, then by equity share. Step labels count from the focus: "Step 2 out", "Step 2 in".
- **Three kinds of link.** When a card opens, each of its links is sorted into one of three kinds:
  1. **New page:** the target is not on the canvas yet. It becomes a card in the next column.
  2. **Back link:** the target is a card earlier on this card's own path back to the focus, whether 1 step back or 6. It never becomes a card or a new level. The card shows a marker instead, "Links back: 2 pages", with a count and no tier colour.
     - Hover or focus the marker to draw dashed return arrows to those earlier cards and highlight them. Clicking pins the arrows until clicked again.
     - The marker's tooltip lists each page with its tier, anchor and link scope. A back link to a T1 page is how a cluster supports its money page, so it is shown, not hidden.
     - Return arrows are never drawn by default, because twenty pages linking home would cover the canvas.
  3. **Seen elsewhere:** the target is on the canvas but not on this path, for example in a sibling branch. It shows as a dashed stub, "Already at step 1 out". The stub cannot open. Activating it scrolls to the original card and highlights it. One exception, found in the mock: a page that links both ways with the focus is a full card in the first column on each side (marked "Both ways"), not a stub, because that pair is what the reader is looking for.
  - On the left side the same rules apply with the direction reversed: an in-link from a page already on the canvas is a stub or a back-link marker, never a second card.
- **Links both ways:** when a card's page and its parent link to each other in the scope in view, the card shows a "Links both ways" marker. On the first columns this means the page links to the focus and the focus links to it. That reciprocal pair is the shape topic clusters are built on.
- **Link scope:** with Editorial in view (the default), only editorial links draw as cards. Each opened card's other links collapse into group cards, one per scope with a count, such as "Previous, next and related: 2 links" or "Menus and footer: 9 links". A group card opens like any card, and its children follow the same three kinds. Editorial edges are solid, auto-generated edges dotted and template edges dashed. Links to redirects are amber and broken targets red, with a legend.
- **Card:** two lines, 240 px wide and about 42 px tall (decided 2026-11-17 to fit more cards on screen).
  - A left edge in the tier colour.
  - Line 1 is the path.
  - Line 2 is the link's anchor (the page title on the focus card) on the left, and the facts on the right: tier code, "N in" (editorial or all links in, following the scope in view), a status badge when the page is not 200, and a small two-way arrow when the page links both ways with its parent. The words "linking pages" and "links both ways" live in the tooltip and the accessible name.
  - A stub is two lines too: the path, then the anchor and "Also at step 1 out".
  - Equity share is not shown anywhere in the UI (decided 2026-11-16).
- **Info panel** (house tooltip look; decided 2026-11-17): title, tier name, status, depth, linking pages (editorial and all), this link's placement and rel. It never opens on hover or focus, because it covered the cards the user was reading. Each card's hover tools (shown on hover or keyboard focus) are "Info" (an "i" button), "Make focus" and "Details". The panel opens from "Info", stays while the pointer moves, and closes on the button again, a click elsewhere, Escape, or a pan or zoom. Lines and the back-link marker keep their small hover tips.
- **Re-center:** each card has "Focus", which makes it the new focus. The URL updates, so Back returns to the previous focus.
- **Size:** the canvas holds at most 300 cards. Past that, opening is refused with a message pointing to the tree list or a tier filter.
- **Viewport:** a real pannable, zoomable canvas (decided 2026-11-17, built in the mock as `il-canvas.js`), not a scrolling area.
  - **Pan:** drag the empty background, two-finger scroll on a trackpad, wheel, or Space and drag. A fast drag glides to a stop (not under reduced motion). On touch, one finger pans from anywhere.
  - **Zoom:** pinch, or Ctrl or Cmd and scroll, toward the cursor; 25% to 200%, continuous. On touch, two fingers pinch and pan together. Buttons zoom in 25% steps around the centre.
  - **View controls** (bottom left, a toolbar named "Canvas view"): zoom out, the percentage (activating it returns to 100%), zoom in, Fit everything, Centre on the focus page, Reset card positions, Legend and controls (the gestures and keys, and what the line styles and box styles mean). There is no permanent legend row under the canvas: it took too much height.
  - **Minimap** (bottom right, hidden below 640 px): every card and the part in view; press or drag on it to move the view.
  - **First view:** the whole journey when it is readable at 70% or more; otherwise the focus page at 85%, so the first thing seen is never a blur. The last view of a journey is restored when the page re-renders, for example after a tier change.
  - **Growing never loses the place** (decided 2026-11-17, after the layout jumped on every click): when a card opens or closes, the card the user pressed stays exactly where it is on screen, every other card glides from its old place to its new one (300 ms, ease in and out), new cards fade in, the lines follow frame by frame, and the view pans the least it takes to show the card and its new children, all as one movement. Nothing teleports. Under reduced motion all of it is instant.
  - **Dot grid** behind the cards moves and scales with the view, so panning always reads as movement.
  - Moves animate over 150 to 320 ms and are instant under reduced motion.
- **Selecting and moving:**
  - **Select:** Shift or Cmd and click adds a card; Shift and drag on the background draws a selection box. A bar appears with "N cards selected", Set tier, Show their links and Clear; a plain click or Escape clears. Selection works with the keyboard on the cards (Shift and Enter).
  - **Move:** dragging a card (or the selection) moves it, and its lines follow live. Positions are kept per focus page for the session; "Reset card positions" restores the layout. Touch does not drag cards, so a tap always opens.
- **Hover:** hovering or focusing a card lights its path back to the focus page and its direct children and fades the rest. Hovering a line shows its anchor text, link type and attribute; the lines have a wide invisible hit area.
- **Keyboard:** arrows move between cards in reading order (left and right across columns, up and down within one) and pan the view when the empty canvas has focus (Shift for bigger steps). A card that takes focus off screen is brought into view. Enter or Space opens or closes. F re-centers. Escape clears the selection, then returns to the focus card. Plus and minus zoom, 0 fits everything, 1 is 100%, Home centres on the focus page. Each card is a button whose accessible name reads like "/pricing, T1 Money pages, 12 linking pages, linked as See plans, content". The canvas region names the tree list as its text alternative.
- **Technology:** React Flow (`@xyflow/react`, MIT) for rendering, viewport and edges, and `elkjs` (layered, direction right) for positions. Cards are our own components, so tokens, badges, focus rings and tooltips match the design system. Both are new web dependencies. The canvas is a new design-system component: its spec, tokens and preview section land before any feature code (UI rule "When something is missing").

**Tree list:** `DataTable` in tree mode with lazy children from the neighbours endpoint.

- Columns: Page, Tier, Anchor, Placement, Linking pages, Equity share, Status.
- A direction switch (Links out, Links in) picks which side the tree follows.
- A back link shows as a muted row, "Links back to /crm-software (step 0)", that does not expand. A page listed elsewhere in the tree shows "Listed above" and does not expand either. Reciprocal rows carry the "Links both ways" marker.
- It is the canvas's text alternative and the better view for scanning anchors.

**Empty and edge states:**

- A focus page with no editorial in-links says so ("Editorial orphan") and offers the All scope to show the menu and auto-generated links that reach it.
- A focus page that is a redirect shows one child: its target.
- A focus page that is not in the crawl offers a search for crawled pages.

### 7.6 Tier flow tab

- **Matrix:** an ECharts heatmap (already imported) with rows "from tier" and columns "to tier". Cells hold unique link counts, with a table alternative. Clicking a cell opens the Links tab filtered to that pair.
- **Strip:** a `MetricStrip` with each tier's equity share, page count and average depth.
- **Scope:** the link scope chip applies here too.
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

### 7.10 Slice 2 and 3 screens (built in the mock on 2026-11-16)

These are specified by the mock in `apps/web/design-preview/il-*.js`; the real app builds them after slice 1.

**Crawl picker.** Choosing an older crawl shows the site as it was then: links, pages, depth, equity, flags, worklists and the tier flow all follow it. An "Older crawl" badge and "Back to latest" show while it is not the latest. Tier changes apply to every crawl, because tiers belong to the URL. "Crawl now" appends a crawl and shows it.

**Changes tab** (compares the crawl in view with the previous one).
- Strip: links lost, links added, links lost to T1 and T2 pages, pages added.
- Alert banner when links to important pages were lost: "3 links to T1 and T2 pages were lost since 7 Nov", the channel, and "Change alert rules". The tab carries a count badge while an alert is open.
- Lost links table, T1 targets first, with a Priority cell (Lost to T1, Lost to T2, Lower priority); a menu switches between "Only T1 and T2 targets" and all.
- New links table, and "Pages that moved most": editorial links in, equity share and depth, each against the previous crawl. Deeper is worse, so a depth increase is the negative tone.
- Alert rules (crawl settings and project settings): on or off, important pages (T1 only, or T1 and T2), threshold (1 to 50 lost links), channel (in the app, email, Slack).
- Worklist "Lost links to T1 and T2" in the Pages issues row.

**Links tab.** "First seen" and "Lost on" columns and a Status menu (Active, Lost since last crawl, All).

**Pages tab.** Columns: Change (editorial links in against the previous crawl, shown by default), Equity change, Tracked keywords, Average rank, AI citations (28 days, ChatGPT, Gemini and AI Mode in the tooltip), Anchors (distinct count and generic share), Anchor matches keyword. Worklists added: "Lost links to T1 and T2" and "T1 pages linking out to weak pages" (a T1 page with at least 3 editorial outlinks, over half of them to T4, Untiered, error or non-indexable pages). New flag: "Mostly generic anchors" (over half of the editorial anchors are words such as "click here", with at least 2 links).

**Tier suggestions.** A chip in the issues row opens "Suggested tiers": pages in the top fifth by Search Console clicks, or ranking 1 to 5 for a keyword with 2,000 or more searches, that are T3 or lower, get T2; Untiered pages with 50 or more clicks get T3. Pages with a manual tier are never suggested. Each row has Accept and Dismiss, with "Accept all". Nothing changes until accepted.

**Inspector additions.** "Changes since the last crawl", "Tracked keywords" (rank, places moved, volume; labelled as idraft rank tracking), "AI citations" (three engines, 28 days) and "Anchor text pointing here" (top anchors with a Generic badge, distinct count, generic share, and whether an anchor contains a tracked keyword).

**Opportunities tab.** Pages that mention a topic of another page without an editorial link to it. Table: source page and tier, the mention in its sentence with the phrase highlighted, target page and tier, suggested anchor, source equity share, status. Actions: Accept (planned fix), Dismiss, Undo, copy instruction, bulk accept and dismiss. "Planned fixes" exports accepted rows (or open rows when none are accepted). Only pages reachable from the home page are sources, because a link from an unreachable page passes no equity. The mock's mentions are sample data; the real feature reads page text and tracked keywords.

**Path finder** (a third Journey view). For a chosen page, the shortest route from the home page over any link and over editorial links only, as chains of step cards with the anchor used between steps, plus a sentence when menus make the page closer than editorial links do. "Open in canvas" returns to the canvas on that page.

**Client summary.** Export menu entry "Client summary (HTML)": a standalone page with the tier table (pages, share of pages, equity share, average depth), the editorial tier flow, the open worklists with counts and the lost links to T1 and T2.

## 8. API

`{P}` is `/api/v1/projects/{project_id}`. Every list takes `run` (default `latest`), `scope` (`editorial`, `auto_generated`, `template` or `all`, default `editorial`), cursor paging and `format=csv` where export applies.

| Method and path | Purpose |
|---|---|
| `GET {P}/link-crawls`, `POST {P}/link-crawls`, `GET {P}/link-crawls/{id}`, `POST {P}/link-crawls/{id}/cancel` | Runs, Crawl now, progress and cancel |
| `GET {P}/internal-links/pages` | Pages table (filters, sort, columns of section 7.2) |
| `GET {P}/internal-links/pages/{url_id}` | Inspector payload |
| `GET {P}/internal-links/edges` | Links table |
| `GET {P}/internal-links/neighbors` | One journey step, either side. Takes `url_id`, `direction` (`in` or `out`), `scope`, `limit` (8), `offset`. Returns the children in scope with edge fields, tier, metrics, `has_children` and `reciprocal`, plus a count per other scope for the group cards. The canvas decides "new", "back link" or "seen elsewhere" itself, because only it knows what is on screen |
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

Run on cleanstart.com (a Next.js blog with `rel="prev"` and `rel="next"` article navigation), one WordPress site and one other CMS to measure:

1. Crawl speed in pages per minute, and whether `max_crawl_pages` stops cleanly.
2. Whether `store_raw_html` changes the price, and the call limits of `raw_html`.
3. What `respect_sitemap` does to scope and orphan flags.
4. Placement classifier accuracy against a hand check of 100 links per site. The target is 95% for editorial versus auto-generated versus template, with previous and next links found on every blog post that has them.
5. Whether `/links` returns the anchor text and rel we expect for image links and redirects.

The plan adjusts sections 6.1 to 6.3 from the results before the backend tasks start.

## 11. Testing

- **Backend unit:**
  - placement classifier on HTML fixtures: nav, header inside `main`, breadcrumbs, `rel="prev"` and `rel="next"` in an "Article navigation" section outside `article` (the cleanstart.com shape), WordPress `post-navigation`, an unmarked related-posts block, a template block with the same targets, same-page jump links
  - PageRank on small graphs with known answers (sums to 1, redirect pass-through, nofollow dropped, error sink)
  - depth through redirects, depth without auto-generated links, the "deep only through previous and next" flag, editorial orphans, reciprocal pairs
  - rule matching and precedence
  - tier delete with move
  - ceiling logic
- **Backend integration:**
  - ingest from recorded DataForSEO payloads in `fixtures/`
  - the API under tenancy and row-level security, including that one workspace cannot read another's tiers or crawls
- **Web unit and axe:**
  - `TierBadge`, `LinkCard`, `LinkCanvas` (keyboard order, accessible names, refusal at 300 cards), bulk bar, tier settings dialogs, in both themes
  - canvas link kinds: a link to an ancestor two steps back becomes a back-link marker and never a card; a link to a sibling branch becomes a stub; the left side follows the same rules; the return arrows draw on hover and focus and pin on click; "Links both ways" shows on reciprocal pairs
- **Playwright flow:**
  - add a project with the checkbox ticked
  - see crawl progress (mocked)
  - tag 20 pages in bulk and by rule
  - see the tier flow change
  - open the journey, expand two steps out and two steps in, see a back-link marker and its return arrow, re-center, switch to the tree list
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
