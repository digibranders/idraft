# Open backend requests 10 to 24: hand-over for the backend owner

Date: 2026-11-23. Written from the two request files, checked against `backend/src/idraft/api/schemas/ai.py`,
`backend/src/idraft/api/schemas/operations.py`, `backend/src/idraft/api/schemas/ai_sources.py`, the routers under
`backend/src/idraft/api` and `backend/openapi/v1.json` (last changed 2026-11-18) on `origin/develop` 6f143b6c.

Sources, kept as they are (the numbers are not changed):

- `docs/ai-visibility/backend-requests-overview.md`: requests 1 to 13 and 24 (the Overview).
- `docs/ai-visibility/backend-requests-prompts-page.md`: the `include=facts` fields (unnumbered), the Prompts drawer
  requests 11 to 16, and requests 17 to 23.

Two numbering facts to know before reading:

1. Numbers 11, 12 and 13 are used twice, once in each file, for different things. Here they are written
   "11 (Overview)" and "11 (Prompts drawer)", and so on. Nothing was renumbered.
2. Request 20 is not a backend task. It is a question for the owner and sits at the end (section 3).

The web app builds every screen below now. Where a value is not collected, a card says "Not collected yet" or n/a with a
reason; production never shows a zero or an invented number (rule R6). Nothing breaks while a request is open.

## 1. Table, in order of value

Order: the requests that remove a visible "Not collected yet" from the Overview or the Prompts page first, then the ones
that add a control, then the ones the owner has to decide.

| Number | Title | Status | Blocks which screen |
|---|---|---|---|
| 13 (Overview) | Share of voice as brand-mention counts (D17) | open | Overview headline tile, by platform, trend, location, period cards, Share of voice over time and its rank, groups, competitor drawer, Prompts cells |
| 24 | Entity cell total and the count of answers that name a tracked brand | open | Same cards when a project tracks more than 20 brands; Overview Lost to competitor card |
| 11 (Overview) | Weekly cells for mention position, recommendation and sentiment | open | Overview headline tiles Mention position, Recommendation rate, Sentiment (the 22 px line) |
| 11 (Prompts drawer) | `recommended` and `list_rank` on each answer | open | Prompt drawer Latest card and History Answers column |
| 13 (Prompts drawer) | `recommended` cell of each tracked brand | open | Prompt drawer Competitors tab, Brands card, Recommendation switch |
| 12 (Prompts drawer) | Rank and Google AI Overview on a linked keyword | open (blocked by WP-44) | Prompt drawer Competitors tab, Related keywords card |
| 22 | First-party favicon route | open | Every domain cell and project mark (placeholder square, first letter) |
| 23 | `compare=previous_year` on the sources routes | open | Overview source cards and prompt drawer Citations tab when "vs same period last year" is chosen |
| 14 | `observations` per platform on the sources rows | open | Prompt drawer Citations tab (one platform at a time) |
| 12 (Overview) | Run number and last run of each platform | open, partly (one number on another route) | Overview status line and Runs tile tooltip |
| 15 | Schedule of a prompt | open | Prompt drawer header badge |
| 17 | Schedule filter, chip and Move to schedule | open (needs 15) | Prompts Filter menu, chip, bulk bar |
| 16 | Version boundary in the History chart | open | Prompt drawer History chart |
| 18 | Edit the text of a prompt | open (a design decision, see its entry) | Prompts row menu `Edit prompt` |
| 19 | Generate prompts from keywords | open (WP-44 owns the router) | Prompts More actions `Generate from keywords` |
| 21 | Import prompts | open, optional (no backend change needed first) | Prompts More actions `Import prompts` |
| 10 | Per-competitor weekly series | delivered, remainder in 13 and 24 | Overview share of voice over time, rank, competitor trend |
| 20 | What `Open page` means | question for the owner, not a backend task | Prompts row menu |

Older items outside 10 to 24 are summarised in section 4, with their status, so nothing is lost.

## 2. The requests

### 13 (Overview). Share of voice as brand-mention counts (D17)

Needs: make the `share_of_voice` cell a count share in every block that has it: `EngineSummary`, `EntityCells`,
`WeekCells` (all in `api/schemas/ai.py`) and the `SummaryTotal` engines, on `GET .../ai/prompts-summary`
(`api/ai/summary_routes.py`). `numerator` is the brand's mentions (valid answers that name it, summed over prompts for a
topic row or the total, never prompt weighted, no `pooled`). `denominator` is the sum of those numerators over every
tracked entity of the set. `value` is the ratio, null when the denominator is under 4 (R2). The own brand's cell sums its
own entities. Do the weekly entity points of `include=series,entities` too, and keep the key name and `n_observations`.
Today the schema text still says "1 / the tracked entities the answer names" (the old equal split).

Why: the owner decision D17 (2026-11-17) says the web always writes "x of y brand mentions" beside the percent. The old
cell holds no count of mentions.

Until then: the web rewrites the cell from `entities[].mentioned` where a read carries `include=entities`
(`apps/web/src/lib/rates/brand-mention-share.ts`) and writes "Not collected yet" for the whole figure where it does not.
Cards that show it ask one extra small read (topic rows and `total` with `include=entities`, and for weekly lines
`include=series,entities` with `rows=none`). When this lands that file goes and nothing else in the web changes.

Status: open.

### 24. Entity cell total and the count of answers that name a tracked brand

Needs: add `entities_mentions_total` (integer, the sum of `mentioned` over every tracked entity of the set, not only the
20 cells listed) and `named_answers` (integer, valid answers that name at least one tracked brand) to `EngineSummary`,
`WeekCells` and the `SummaryTotal` engines.

Why: with more than 20 tracked brands the cells stop at 20 (own ones first), so y of "x of y brand mentions" would be too
small. The second figure is the denominator of the Lost to competitor card (`ai.opportunities`, row "No tracked brand
mentioned"), which the count share of request 13 no longer holds.

Until then: a block with 20 cells of a longer set shows "More than 20 tracked brands" and no percent, layer or rank. The
Lost to competitor card keeps its figure through the old denominator the web keeps (`naming_answers`), right only while
the API still sends the old cell. Ship 24 together with 13, or the card breaks when 13 lands.

Status: open.

### 11 (Overview). Weekly cells for mention position, recommendation and sentiment

Needs: with `include=series`, add to each `WeekCells` (per engine and for the weekly series of the total) the
`mention_order` mean with its count of ordered answers, and, once request 4 of the Overview file lands (section 4),
`recommended` and the positive `sentiment` share as `MetricCell`s over the same answers. Pool the weeks as the other
cells do and keep `is_pooled` and `pool`. A week with fewer than 4 valid answers keeps its counts and no rate.
Today `WeekCells` holds `mentioned`, `cited`, `share_of_voice` and `entities`, and nothing else.

Why: the preview draws a 22 px line on these three tiles (OV-HEAD-14). The real tiles have none.

Until then: the three tiles have no line. The web never draws a flat or invented line.

Status: open. The two cells depend on the classifier (request 4 of the Overview file); the mention position line depends
on request 2 of that file.

### 11 (Prompts drawer). `recommended` and `list_rank` on each answer

Needs: on `ObservationFacts` (`api/schemas/ai.py`, the answer list and the answer detail), add `recommended: boolean | null`
(the answer recommends the own brand; null on a platform whose answers are not classified for it) and
`list_rank: { place: number, listed: number } | null` (the place of the own brand in a list the answer gives, and how many
brands the list names; null when the answer is not a list). The schema has `own_mention_order` and `had_structured_list`
but not the list length, and the facts table columns `own_recommended` and `own_sentiment` are written as null at ingest
(`collectors/ai_prompt_ingest.py`).

Why: the drawer's Latest card says "Recommended" and "Rank 2 of 3", and the History Answers table has a `Recommended`
column.

Until then: those facts say "Not collected yet" (n/a where the platform is not classified).

Status: open. Needs the classifier (WP-54) for `recommended`.

### 13 (Prompts drawer). `recommended` cell of each tracked brand

Needs: a `recommended` cell in `EntityCells`, built as `mentioned` is, per engine and per tracked entity.

Why: the Competitors tab, Brands card, Recommendation switch shows a competitor's recommendation rate.

Until then: competitor rows say "Not collected yet".

Status: open. Needs the classifier (WP-54). Note the contradiction in section 5: the source says the own brand's
`recommended` cell exists today, and the schema does not have one.

### 12 (Prompts drawer). Rank and Google AI Overview on a linked keyword

Needs: on `linked_keyword` of a prompt row (with `include=facts`), add `rank: number | null` (rank in the latest rank
check; null when not in the first 20) and `ai_overview: { cited_position: number | null } | null` (null is no Google AI
Overview; `cited_position` is the place of the own site among its sources, null when not cited).

Why: the Related keywords card shows `Rank`, and `Cited #2`, `Not cited` or `No Google AI Overview`.

Until then: the card says "Not collected yet".

Status: open, and blocked. `linked_keyword` itself is part of the unnumbered `include=facts` work (section 4) and needs
WP-44: `backend/src/idraft/api/ai/link_routes.py` is an empty router today, and `SummaryInclude` has no `facts`.

### 22. First-party favicon route

Needs: `GET /api/v1/workspaces/{workspace_id}/favicons/{domain}` returning an image of at least 32 px, or `404` when the
site has no icon. The server fetches and caches the icon of the registrable domain, accepts only a public registrable
domain (the web's `normalizeDomain` rule), is rate limited, and sends a long `Cache-Control`. No route exists today
(checked in `api` and in `openapi/v1.json`).

Why: owner decision 6. The web no longer asks `google.com/s2`, because that sends every cited domain to a third party.

Until then: every domain cell draws a neutral square and every project mark its first letter. The web side is one
function, `faviconUrl(host)` in `apps/web/src/lib/favicon.ts`, which returns null today and returns this path once the
route exists. No component changes.

Status: open.

### 23. `compare=previous_year` on the sources routes

Needs: `compare=previous_year` on `ai/sources/domains` and `ai/sources/pages`, and a compare on `ai/sources/changes`.
Today `SourceCompare = Literal["none", "previous_period"]` (`api/schemas/ai_sources.py`) and `sources/changes` has no
compare. Same dates a year earlier (29 February becomes 28 February), as the summary does (`previous_year_dates` in
`api/ai/summary.py`), with `meta.compare_window` and `previous` on each row.

Why: owner decision 15 adds "vs same period last year". The summary routes already take it.

Until then: the Overview source cards and the drawer's Citations tab read no comparison while last year is chosen, and
say so.

Status: open.

### 14. `observations` per platform on the sources rows

Needs: `observations` inside `EngineUnits` on the `sources/domains` and `sources/pages` rows. Today `EngineUnits` has
`engine_code` and `citation_units` only, and `observations` is one number over the platforms read.

Why: the Citations tab counts in answers (R11). A per-platform column cannot be counted in answers.

Until then: the Citations tab shows one platform at a time.

Status: open.

### 12 (Overview). Run number and last run of each platform

Needs: add `run_number` (counts the project's collecting runs, oldest is 1) and `engine_codes` (the platforms the run
asked) to `Run` (`api/schemas/operations.py`, `GET {P}/runs`). A platform's last run is then the newest run whose
`engine_codes` holds it.

Why: the status line says `Updated Sep 28, 02:10 · run 48`, and the Runs tile tooltip says `Run 48, last Sep 28, 02:10`
and, with a platform chosen, that platform's last run (OV-SHELL-07, OV-HEAD-16).

Until then: the web counts the collecting runs of the period and shows the time the newest finished, with no run number
and no per-platform time. The freshness line is the newest answer, a different fact.

Status: open, partly. `RunWindow.latest_run_number` exists on `GET .../ai/citation-overview` (how many prompt runs the
project had up to the latest answer's run), but `Run` has neither field and nothing gives the platforms of a run.

### 15. Schedule of a prompt

Needs: `schedule` (`core`, `discovery`, `brand_watch`) and the core lock on `Prompt` and `PromptSummaryRow`. Not on
`Prompt` today (`GET /schedules` lists schedules, but a schedule selects subjects by `groups`, `terms` or `all`).

Why: the badge beside the type and the version in the drawer header.

Until then: the badge is not shown.

Status: open.

### 17. Schedule filter, chip and Move to schedule

Needs: `schedule` (or a `schedule_id`) on `Prompt` and `PromptSummaryRow` (request 15 is the read side of this);
`schedule` in `PromptPatch` and `PromptBulkSet` (a core prompt is refused with a proposed `409 schedule_locked`, so the
web can say core prompts stayed); `filter[schedule_in]` on `GET /prompts` and `ai/prompts-summary` beside `filter[term]`.
Neither patch schema has the field today.

Why: PR-OPEN-02, PR-MENU-07, PR-FILTER-01, 03, 11, 12 of the Prompts register.

Until then: no Schedule field in the Filter menu, no chip, no lock on a core prompt, no `Add to schedule`.

Status: open. Do 15 first, then this.

### 16. Version boundary in the History chart

Needs: the day each `PromptVersion` took effect (`created_at` exists on `PromptVersion`) and a `GET` of the version list
of a prompt. Today only `Prompt.current_version` is exposed; no versions route is in `openapi/v1.json`.

Why: the chart draws a dashed boundary where the wording changed (`v2`), as the preview does.

Until then: no boundary is drawn.

Status: open.

### 18. Edit the text of a prompt

Needs: allow `text` in `PromptPatch`. A changed text writes a new `PromptVersion` (`change_kind` `wording`, or `typo`
when the caller says so; the enum is `initial`, `wording`, `typo`, `context`), answers the new `current_version`, and
the old answers keep the version they were asked with. Refuse a text that duplicates another active prompt of the project
(a proposed `409 duplicate_prompt`), as `bulk-create` does with `skipped`.

Why: the row menu has no `Edit prompt` (PR-MENU-03, PR-MENU-12).

Until then: the item is left out of the menu.

Status: open, and a decision for the backend owner first. `PromptPatch.text` is refused on purpose today
("Fixed once saved: archive the prompt and add a new one", `immutable_field`). The request reverses that rule, so confirm
it is wanted before building.

### 19. Generate prompts from keywords

Needs: `POST /api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/suggestions` with
`{ keyword_ids: uuid[] (at most 50), count_per_keyword: 1 to 5, language_code, country_iso }`, answering
`{ data: { keyword_id, text, prompt_type, is_branded }[] }` and the cost of the call. The web lists the suggestions in the
Add dialog and adds the chosen ones through `bulk-create` with `creation_method: "generated"` and `generated_from` set.

Why: `Generate from keywords` in More actions (PR-MENU-01, PR-MENU-12).

Until then: the item is left out.

Status: open. The header of `api/ai/link_routes.py` says WP-44 "links-generate" owns "prompts generated from keywords", so
this may already be planned there; if the route is named differently, tell the web session.

### 21. Import prompts

Needs: nothing from the backend to start. The web can read a CSV in the browser and feed `POST /prompts/lint` and
`POST /prompts/bulk-create`. A server side import with a report (as `keyword-imports` has) is only needed for files larger
than the Add dialog's cap.

Why: `Import prompts` in More actions (PR-MENU-01, PR-MENU-12). Blocked on a design of the import dialog, which the
preview does not have.

Until then: the item is left out.

Status: open, optional.

### 10. Per-competitor weekly series

Status: delivered. `WeekCells.entities` (`list[EntityCells]`, with `entity_id`, `mentioned`, `share_of_voice`) is filled
with `include=series,entities` for each tracked entity of the engine's `entities` (own ones first, at most 20) over the
weeks the point holds, its own week or, when `is_pooled`, the weeks of `pool`. No `previous`. The web draws a rival line
only from these points.

What remains is carried by request 13 (the weekly cells still use the old equal split; the web writes the count share
from `entities[].mentioned`) and request 24 (`WeekCells` has no `entities_mentions_total`, so above 20 tracked brands the
web says "More than 20 tracked brands"). Nothing else is asked.

## 3. Question for the owner: what does `Open page` open? (request 20)

Not a backend task yet. The Prompts row menu in the preview has `Open page` next to `Open`, and it is a stub: the menu item
carries `data-preview-note="The prompt page"` (`apps/web/design-preview/index.html`, `#menu-prompt-row`; the note text is
printed by `interactions.js`). There is no page of one prompt in the product design and no URL for it. The real app leaves
the item out (PR-MENU-03, PR-MENU-12). The other `Open page` in the preview (`perf-detail.js`) is the Page performance
screen, a different feature.

What the data model has. A prompt does not link to a page. `Prompt` (`api/schemas/ai.py`) has a text, terms, intent and
flags, and no URL or keyword. Three things could stand for "the page of a prompt":

1. The prompt's own drawer by link. `?inspect=prompt:{id}` exists in the web app today (`app/[workspace]/[project]/ai/prompts/page.tsx`
   says one prompt has no page of its own and opens in the right inspector). The item then becomes a link to the same
   drawer, which `Open` already does.
2. The linked keyword and its ranking URL. `GET` keywords can return `ranking_urls` (`include=ranking_urls`, own pages that
   ranked at the last check). The link between a prompt and a keyword does not exist yet: `core.keyword_prompt_links` is WP-44
   and `link_routes.py` is an empty router. `linked_keyword` on the summary row is also not built.
3. A cited own page. Answers cite pages, and `ai/sources/pages` accepts `filter[prompt_id]` and `filter[domain_role_in]`,
   so the most cited own page of one prompt can be read today with no backend change. It is a page of the customer's own
   site (an external link), and a prompt with no own citation has none.

My reading of each option:

| Option | Cost | What the person gets | Risk |
|---|---|---|---|
| 1. Drawer by link, shown as `Copy link` | Web only, small (the menu already has `Copy prompt`) | Nothing new: the same drawer | Honest, but then the item is not "Open page" and the menu repeats `Open` |
| 2. Linked keyword page or ranking URL | Web small after WP-44 and the `linked_keyword` field; backend work is WP-44 and request 12 | A real page: the keyword in Keywords, or the page that ranks for it | Many prompts have no linked keyword, so the item is often disabled; blocked until WP-44 |
| 3. Most cited own page | Web medium (one read on open, a menu item with a loading state); no backend change today | The own page the engines cite for this prompt | Absent for prompts that nobody cites; it opens a customer page, not a product page; one extra read per menu open (can wait for `top_links` of `include=facts`, which gives it in the row) |

Recommendation: option 1 now, named `Copy link`, and drop `Open page`. It is a zero backend change, it is already true
in the app, and it is what the source file proposes. Revisit option 3 when `include=facts` ships `top_links` (the data is then
in the row and costs no extra read) and option 2 after WP-44. If the owner wants a real "page of a prompt" later, that is a
product design (a full page route with its own URL), which needs a decision before any backend work.

Decision needed: confirm option 1 (then request 20 is closed with no work), or pick 2 or 3 (then a backend line is added
here).

## 4. Older items outside 10 to 24, still open

These keep their numbers in the source files. Statuses were checked against `api/ai/metrics.py` and `api/schemas/ai.py`
today. Overview file:

| Number | Title | Status | Check |
|---|---|---|---|
| 1 | `ai.visibility_rate` and the weekly `visibility` | open | No such key in `metrics.py`; `WeekCells` has no `visibility` |
| 2 | `ai.mention_order_mean` and the order counts | open | `EngineDetailCells` has no `mention_order` |
| 3 | The two keys in `AVERAGED` | open | `AVERAGED` still holds five keys |
| 4 | Sentiment and recommendation cells | open | Facts columns exist, are written as null |
| 5 | Referral traffic route | open | No `traffic` or `ai-referrals` route in `api` |
| 6 | Source overlap per competitor | open | No `sources/overlap` route |
| 7 | AI Overview as an engine | open | The API accepts three engines |
| 8 | One topic per prompt | open | Rule not on writes |
| 9 | Per-platform weekly run log | open | Only `ai/collection/daily` exists |

Prompts file, unnumbered: the `include=facts` fields (`intent`, `linked_keyword`, `linked_keywords`, `position`,
`sentiment`, `recommended`, `other_brands`, `top_links`, `latest`) are open: `SummaryInclude` is still
`series, entities, total, co_mentions, cells`. The web flips one constant (`factsRequested` in `facts/use-prompt-facts.ts`)
when the value ships. The backend order in that file stands: facts from data that exists today, then WP-44, then WP-54,
then the candidate store, then screenshots after the spike.

## 5. Unclear or contradictory in the sources

- Numbers 11, 12 and 13 are each used twice (Overview file and Prompts drawer table) for different requests. Kept as
  they are; this document tells them apart by screen. A later cleanup could renumber, but the registers and code comments
  cite the numbers.
- Prompts drawer 13 says "today only the own brand's `recommended` cell exists". The schema has no `recommended` field
  on `EngineSummary` or `EntityCells` at all; `ai.recommendation_rate` is a suppressed metric key (`not_classified`).
  Treated as: no recommendation cell exists for any brand.
- Request 18 asks to allow `text` in `PromptPatch`, which the schema refuses on purpose (`immutable_field`). Flagged as a
  decision, not just a task.
- Request 19 may overlap WP-44 ("links-generate"), whose empty router names generating prompts from keywords.
- Request 12 (Overview) has a related field on another route (`RunWindow.latest_run_number`) that the source does not
  mention.
- The Prompts file says request 17 builds on "request 15 above", which is consistent, but 15 is a table row with no title
  of its own; here it has an entry.
