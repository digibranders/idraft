# Backend requests for the new Prompts page columns

Date: 2026-11-16. Written by the W0-facts package of the port plan
(`docs/superpowers/plans/2026-11-16-real-app-port-overview-and-prompts.md`).

The Prompts tab gets new columns: Intent, Volume, Position, Recommended, Sentiment, Brands, Links and Screenshot. The web app
builds them now against typed optional fields and mock data. This file lists what the backend has to return so the columns
show real numbers. Until then every column shows n/a with a reason, never a zero.

## How the web reads it

- One read: `GET /api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary`, as today. The page asks with
  `include=entities,facts`. It never makes one request per row.
- The web types are in `apps/web/src/lib/api/prompt-facts.ts` (re-exported by `features/prompts/facts`) and the mock that builds them is
  `apps/web/src/mocks/prompt-facts.ts`. Both mark themselves as the backend request shape. `lib/api/schema.ts` is not edited:
  it is regenerated (`pnpm gen:api`) once the backend ships.
- Every new field is optional. A field that is absent means "not built yet". A field that is `null` means "the backend
  answered and the value does not apply" (an engine that does not classify sentiment, a prompt with no linked keyword). The
  web shows a different message for each and never turns either into 0.
- The web sends `include=facts` only where the mocks answer it, because the production API refuses an include value it does not
  know (422). When the backend ships the value, one constant in `facts/use-prompt-facts.ts` (`factsRequested`) is flipped.

## The new include value

| Item | Request |
|---|---|
| Endpoint | `GET .../ai/prompts-summary` |
| Change | Add `facts` to the allowed values of `include` (today `series`, `entities`, `total`, `co_mentions`, `cells`). |
| Smallest change | One new include that switches on the fields below. They are computed from the same answers and the same window as the cells, so a row's numbers agree with its Mentioned cell. |
| Owner area | `backend/src/idraft/api/ai/summary.py`, `summary_repository.py` and the models of `api/schemas/ai.py` (the summary models are leased, see MASTER-PLAN section 6). |
| Related | WP-12 summary lane for the include and the models; the work packages named below for the data. |

`include=facts` works with `rows=topics`, `rows=none`, `compare` and every filter, like the other includes. `total` and
`by_country` rows carry the same engine fields as a topic row.

## Fields on a prompt row (`PromptSummaryRow`)

| Field | Shape | Meaning and rule | Smallest change | Owner area | Related |
|---|---|---|---|---|---|
| `intent` | `"informational" \| "navigational" \| "commercial" \| "transactional" \| "local" \| "unknown"` | The prompt's own intent (the `Prompt.intent` the prompt list already has), repeated on the summary row so the table needs no second read. | Copy the column of the prompt into the row. | prompt summary read | WP-13 prompts lane. |
| `linked_keyword` | `{ keyword: string, search_volume: number \| null } \| null` | The keyword the prompt is linked to. `null`: no link. `search_volume` is the monthly searches from the keyword's latest metrics, `null` when it has none yet (a number, including 0, is never invented). When a prompt has several links, the one with the most searches. | Join `core.keyword_prompt_links` to the keyword metrics. | `api/ai/link_routes.py` data, `api/ai/summary_repository.py` | WP-44 keyword links (table does not exist yet). The value stays absent until WP-44 merges. |

## Fields on a topic row (`TopicSummaryRow`, `total`, `by_country`)

| Field | Shape | Meaning and rule | Smallest change | Owner area | Related |
|---|---|---|---|---|---|
| `linked_keywords` | `{ keyword: string, search_volume: number \| null }[]` | The distinct keywords linked to the prompts of the topic, each once. The group volume is the sum of the known volumes of that list, so a keyword shared by three prompts counts once. A keyword with `search_volume: null` is not counted as 0: the web shows the sum as a lower bound. | Distinct on the keyword over the topic's prompts. | `api/ai/summary_repository.py` | WP-44. |

## Fields on an engine of a prompt row or a topic row (`EngineSummary`)

The same names on a prompt row, a topic row, `total` and `by_country`. On a topic row the counts are the sum over the topic's
prompts, and the cells are prompt weighted exactly as `mentioned` is (`pooled` holds the answers).

| Field | Shape | Meaning and rule | Smallest change | Owner area | Related |
|---|---|---|---|---|---|
| `position` | `{ rank_sum: number, ordered_answers: number, mentions: number, answers: number } \| null` | `answers`: valid answers (the denominator of `mentioned`). `mentions`: valid answers that name the own brand (the numerator of `mentioned`). `ordered_answers`: of those, answers where the brand is in an ordered list with a place. `rank_sum`: the sum of those places, 1 named first. The web computes the mean `rank_sum / ordered_answers` per engine, only from 2 ordered answers, then averages the engines with equal weight. Counts, not a mean, so they add up over prompts and the web can say what the number rests on. `null` on an engine whose answers cannot be parsed into lists. | Read `own_mention_order` and `had_structured_list` of the fact rows (both exist today in `ObservationFacts`) and sum them. No new extraction. | `api/ai/summary_repository.py` | WP-54 structured rank (the quality of `had_structured_list`). |
| `sentiment` | `{ positive: number, neutral: number, negative: number, mixed: number } \| null` | Counts of the classified mentions of the own brand by tone. They add up to the classified mentions of the engine, which can be fewer than `mentions` when some mentions are not classified. `null` on an engine whose answers are not classified (today everything but ChatGPT and Gemini in the design). The web shows four shares, never one score, and needs 4 classified mentions per engine. | Add a sentiment column to the fact row and sum it. | extraction, `api/ai/summary_repository.py` | WP-54 extract and recommend (stage 10 sentiment). Owner decision D-44 (competitor sentiment, own brand first). |
| `recommended` | `MetricCell \| null` | The recommendation rate: valid answers that recommend the own brand over valid answers, as a normal cell (`numerator`, `denominator`, `n_observations`, `pooled` for topics). A recommendation is a kind of mention, so `numerator <= mentioned.numerator`. `null` where the engine is not classified. The generated model already has the key `ai.recommendation_rate` suppressed as `not_classified`; this is the same number on the summary. | Reuse the recommendation fact of stage 9 in a cell. | `api/ai/summary.py` | WP-54. |
| `other_brands` | `{ name: string, mentioned: MetricCell }[] \| null` | Brands the answers named that are not tracked entities, with their Mentioned cell built like an entity cell. The list is complete for the engine: a brand that is not in it was named in none of the engine's answers. The tracked entities are not here (they are the `entities` cells of `include=entities`). At most 20 brands per engine, most named first. A brand that is later tracked leaves this list and appears in `entities`. | Aggregate the untracked brand candidates of the answers per prompt and engine. | extraction candidates, `api/ai/summary_repository.py` | Entity candidates: WP-45 candidates API and WP-56 re-derive (the candidate store that holds brands the matcher saw but nobody tracks). |
| `top_links` | `{ url: string, domain: string, domain_role: "own" \| "competitor" \| "third_party", answers: number }[] \| null` | The pages cited by the engine's answers for the row, with how many answers cited each one (a page counts once per answer). `url` is the canonical URL, `domain` the host. At most 20, most cited first, then by `url`. The web cuts the list at 10. `[]` is a real result: valid answers with no source. | Group `ai.citations` by canonical URL per row and engine. | `api/ai/summary_repository.py` (citations are already stored) | WP-14 sources lane, WP-60 source intelligence. |
| `latest` | `{ observation_id: string, observed_at: string, screenshot_url: string \| null } \| null` | The newest valid answer of the engine for the row in the window. `observation_id` and `observed_at` open the answer (`GET .../ai/observations/{id}`). `screenshot_url` is a short-lived signed URL of an image of the answer, `null` when none was captured. `null` for `latest` when the row has no valid answer on the engine. | Add the newest answer per row and engine. The screenshot needs the spike below. | `api/ai/summary_repository.py`, storage | Screenshot spike (below). |

### Screenshot spike

The providers return the answer text and the sources, not an image. A screenshot needs one of: the provider's own screenshot
or "check URL" render, a headless capture of the check URL the provider returns (`check_url` exists on answers today), or no
screenshot at all. The web builds the column and the dialog for `screenshot_url` and shows "No screenshot" when it is null. Until
the spike decides, return `null`. Do not return a placeholder image.

## What stays as it is

- Tracked brands: the `entities` include already gives Mentioned and Share of voice per tracked entity. The Brands column reads
  them. Nothing to add except the cap of 20 entities, which exists.
- Prompt weighting and engine averaging stay in the web (`lib/stats`, `facts/*`), as for every rate on the page.

## Add as competitor (no new endpoint)

The Brands popover lets a person add a brand the answers named to the competitor list. It uses two existing calls:

1. `POST /api/v1/workspaces/{workspace_id}/entities` (`EntityCreate`: `canonical_name`, `entity_type: "brand"`, the name as an alias)
   creates the entity. If the workspace already has an entity of that name, the web uses it and skips this call.
2. `POST /api/v1/workspaces/{workspace_id}/projects/{project_id}/entities` (`ProjectEntityCreate`: `entity_id`, `role: "competitor"`,
   `track_ai: true`, `color_index`) tracks it in the project.

Rules:

- Undo is `DELETE .../projects/{project_id}/entities/{entity_id}`: it removes the project role and keeps the workspace entity.
- The palette has six colors: the own brand and five competitors (`color_index` 2 to 6). A competitor added past the fifth gets
  `color_index: null`, which every chart draws as the neutral "other" color. The web uses `nextCompetitorColor` of the entities
  feature.
- At most 20 entities are tracked in AI answers (the summary gives entity cells for at most 20, the own ones first). The web
  disables the action and says so at 20. The backend keeps refusing a 21st.
- After a change the summary has to be read again: the brand moves from `other_brands` to the `entities` cells of the next read.
  Answers already stored are matched again by the re-derive job (WP-56); until it has run the new competitor shows 0 answers and
  the web must not present that as a measured zero.

## Fields for the prompt drawer (package P-drawer, 2026-11-17)

The prompt drawer is built against these optional fields; until the backend sends one, the drawer says "Not collected yet" (or
n/a where the platform is not classified) and shows no number. Types: `apps/web/src/lib/api/prompt-facts.ts`
(`AnswerFactsExtra`, `LinkedKeywordVolume`); sample values for them live only in `apps/web/src/mocks/prompt-facts.ts`.

| # | Where | Field | Meaning and smallest change | Used by |
|---|---|---|---|---|
| 11 | `ObservationFacts` (the answer list and the answer detail) | `recommended: boolean \| null` | The answer recommends the own brand; `null` on a platform whose answers are not classified for it. Same fact as `recommended` of the summary, per answer. Add the stage 9 fact to the fact row. | Latest card fact `Recommended`; History Answers column `Recommended` |
| 11 | `ObservationFacts` | `list_rank: { place: number, listed: number } \| null` | The place of the own brand in a list the answer gives (1 is first) and how many brands the list names; `null` when the answer is not a list. Today `own_mention_order` is the place among the tracked brands and `had_structured_list` says a list was found, but the length of the list is not stored. | Latest card fact `Rank 2 of 3` |
| 12 | `linked_keyword` of a prompt row (with `include=facts`) | `rank: number \| null` | Where the linked keyword ranks in its latest rank check; `null` when it is not in the first 20 results. | Competitors tab, Related keywords card (`Rank`) |
| 12 | `linked_keyword` | `ai_overview: { cited_position: number \| null } \| null` | What Google showed for the keyword in its latest rank check: `null` is no Google AI Overview; `cited_position` is the place of the own site among the sources of the overview, `null` when it is not cited. | Related keywords card (`Google AI Overview`: `Cited #2`, `Not cited`, `No Google AI Overview`) |
| 13 | `entities` cells of the summary, per engine | `recommended` cell of each tracked brand | The recommendation rate of a competitor, built as `mentioned` is. Today only the own brand's `recommended` cell exists. | Competitors tab, Brands card, `Recommendation` switch (competitor rows say "Not collected yet") |
| 14 | `sources/domains` and `sources/pages` rows | `observations` per engine in `EngineUnits` | The answers that cite the row on each platform, so a per-platform column of the Citations tab can be counted in answers too. Today `observations` is one number over the platforms read, and `EngineUnits` has citation units only. | Citations tab (one platform at a time until then) |
| 15 | Prompt | `schedule` (`core`, `discovery`, `brand_watch`) and the core lock | The schedule the prompt is asked on, for the badge beside the type and the version in the drawer header. Not on `Prompt` today. | Drawer header badges (not shown until sent) |
| 16 | History, version boundary | the day each `PromptVersion` took effect (`created_at` of the version exists) and a `GET` of the version list | The History chart draws a dashed boundary where the wording changed, as the preview does (`v2`). Reading the version list per prompt is not done in the drawer yet. | History chart (not drawn until read) |

The Citations tab counts in answers (rule R11) from the `observations` of each domain and page row over `meta.answers`; the
sort is `-observations`. The minimum of citation units was removed from the tab because it is a threshold of another unit.

## Order of work for the backend

1. `include=facts` with `intent`, `position`, `top_links` and `latest` (data that exists today: facts rows, citations, answers).
2. `linked_keyword` and `linked_keywords` with WP-44.
3. `sentiment` and `recommended` with WP-54.
4. `other_brands` with the entity candidate store.
5. `screenshot_url` after the spike.

## Gap pass of the Prompts page (2026-11-17)

Checked against `backend/openapi/v1.json` while closing the gaps between the real Prompts page and its design preview
(`docs/superpowers/parity/prompts-page-parity.md`). Each item says what the API has today, and the smallest change. Nothing
below is shown in the web app until the backend sends it: no screen calls an endpoint that does not exist.

| # | Preview feature (register rows) | What the API has today | Smallest backend change |
|---|---|---|---|
| 17 | Schedule filter, Schedule chip and `Move to schedule` in the bulk bar (PR-OPEN-02, PR-MENU-07, PR-FILTER-01, 03, 11, 12) | `GET /schedules` lists the project's schedules, but a schedule selects its subjects by `groups`, `terms` or `all` (`Selector`), so a prompt has no schedule of its own. `Prompt` and `PromptSummaryRow` carry no schedule; `PromptPatch` and `PromptBulkSet` cannot set one; `GET /prompts` has no `filter[schedule]`. Request 15 above asks for the read side only | Add `schedule` (`core`, `discovery`, `brand_watch`, or a `schedule_id`) to `Prompt` and `PromptSummaryRow`; add `schedule` to `PromptPatch` and `PromptBulkSet` (a prompt of the core schedule is refused with `409 schedule_locked`, so the web can say that core prompts stayed); add `filter[schedule_in]` to `GET /prompts` and to `ai/prompts-summary` beside `filter[term]`. The web then adds the Schedule field to the Filter menu, the chip, the lock on a core prompt and the `Add to schedule` menu |
| 18 | `Edit prompt` in the row menu (PR-MENU-03, PR-MENU-12) | `PATCH /prompts/{prompt_id}` takes `funnel_stage`, `importance`, `intent`, `is_active`, `is_branded`, `prompt_type`, `term_ids`, but not the text. A prompt has versions (`PromptVersion.change_kind`, `GET` of the version list is not exposed) | Allow `text` in `PromptPatch`: a changed text writes a new `PromptVersion` (`change_kind: "edited"`), keeps the history of the prompt and answers the new `current_version`; the old answers keep the version they were asked with. Refuse a text that duplicates another active prompt of the project (`409 duplicate_prompt`) as `bulk-create` does with `skipped` |
| 19 | `Generate from keywords` in More actions (PR-MENU-01, PR-MENU-12) | Nothing generates prompt texts. `PromptCreate` has `generated_from` and `creation_method`, which record where a prompt came from, but no endpoint proposes any | `POST /api/v1/workspaces/{workspace_id}/projects/{project_id}/prompts/suggestions` with `{ keyword_ids: uuid[] (at most 50), count_per_keyword: 1 to 5, language_code, country_iso }`, answering `{ data: { keyword_id, text, prompt_type, is_branded }[] }` and the cost of the call. The web lists the suggestions in the Add dialog's check list and adds the chosen ones through `bulk-create` with `creation_method: "generated"` and `generated_from` set |
| 20 | `Open page` in the row menu (PR-MENU-03, PR-MENU-12) | The preview opens a stub (`The prompt page`). There is no page of one prompt in the product design and no URL for it | No backend change. The owner decides what the item opens: the page can be the prompt drawer by link (`?inspect=prompt:{id}`, which exists), in which case the item is `Copy link`, which the menu has |
| 21 | `Import prompts` in More actions (PR-MENU-01, PR-MENU-12) | The preview opens a stub (`Importing prompts`). `POST /prompts/bulk-create` takes up to the Add dialog's cap and `POST /prompts/lint` checks texts; keywords have `keyword-imports` with an upload route, prompts have none | No backend change is needed to read a CSV in the browser and feed `lint` and `bulk-create` (the Add dialog already takes one prompt per line). A server side import with a report, as `keyword-imports` has, only when files larger than the dialog's cap are wanted. Blocked on the design of the import dialog, which the preview does not have |
