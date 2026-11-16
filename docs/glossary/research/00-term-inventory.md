# Term inventory (2026-11-16)

Method: every string of `apps/web/messages/en.json` on branch `port/real-app` (6045 strings, 389 KB) was flattened and
searched for each term, with ICU variables removed so `{engine}` is not counted as the word "engine". The static
design preview (`apps/web/design-preview`, branch `develop`, main checkout, including its uncommitted Prompts files)
was searched in `*.js` and `index.html`. The numbered docs (`docs/00` to `docs/32`) and `docs/ai-visibility/` were
searched as text. Test and end-to-end files were counted by file, not by string.

Finding that shapes everything else: the real app has no hard-coded visible string in its components. Every visible
word is a key in `en.json`. Fixture names in `apps/web/src/mocks` (for example a vocabulary named "Topics", a location
type "Country") are mock data, not screens. So a rename in the real app is a text change plus the tests that assert
the old text.

## 1. Counts per term

Real app counts are visible words only. "Files" are test files (`*.test.ts` or `.tsx`) and end-to-end files that name
the word. Preview counts are occurrences in `.js` and `index.html`. Docs counts are occurrences in `docs/00` to
`docs/32` and `docs/ai-visibility`.

| Word | Real app visible | Real app where (top) | Preview | Docs | Test files / e2e files |
|---|---|---|---|---|---|
| Platform(s) | 290 + 113 | aiOverview, prompts, citations, aiEngines | 7 (Overview mock) | 40 AI docs, 289 numbered docs | 38+19 / 6+7 |
| Engine(s) | 1 (dataRetention) | none (all other uses are `{engine}` variables) | 31 (Prompts mock, settings table, selects) | 1423 AI docs, 698 numbered docs | 13 / 0 |
| Search engine | 1 | dataRetention | 0 | in docs 05, 06, 09 | 0 |
| Model | 4 | prompts (answer model) | 0 | not counted | 0 |
| Surface | 0 | | 0 | 80 AI docs, 64 numbered docs (not meant as UI word) | 0 |
| Group(s) | 168 + 89 | aiOverview 82, prompts 79, rankings 76, projectSettings 12, budgets 6 | 32 (Keywords, Overview, Performance) | 93 AI docs, 268 numbered docs | 44+35 / 9+9 |
| Topic(s) | 2 + 3 | rankings import, taxonomySettings | 49 (Prompts mock) | 1022 AI docs, 311 numbered docs | 15 / 2 |
| Category | 8 | citations (source type), chart | 1 | | |
| Tag(s) | 2 + 27 | rankings 25 | 7 (internal links) | | 10 / 1 |
| Cluster | 1 | taxonomy kind | 0 | | |
| Theme | 7 | shell, account (colour theme) | 0 | | |
| Market(s) | 4 | taxonomy kind | 0 | 22 + 16 | |
| Vocabulary / term | 24 / 60 | taxonomySettings, rankings import | 0 | taxonomy 18 + 61 | |
| Location(s) | 36 + 14 | aiOverview 18, rankings 8, prompts 6, citations 6 | 13 (top bar, Prompts) | 26 AI docs, 190 numbered docs | 13 / 4 |
| Country / Countries | 22 + 16 | rankings 18, prompts 10, aiEngines 8 | 12 (Keywords, Performance) | 193 AI docs, 141 numbered docs | 20+4 / 3+1 |
| Region | 0 | | 0 | 12 + 19 | |
| Prompt(s) | 152 + 252 | aiOverview 197, prompts 142 | many | 2245 AI docs, 1261 numbered docs | 119 / 19 |
| Keyword(s) | 109 + 108 | rankings 154 | many | 291 AI docs, 1315 numbered docs | |
| Query / Queries | 15 + 15 | fanout only | 6 (Performance: Search Console queries) | 86 + 257 | |
| Question | 5 | prompts help text | 2 | | |
| Mention(s) | 100 | aiOverview 57, prompts 30 | | 253 + 249 | |
| Citation(s) / cited | 212 / 143 | aiOverview, citations, prompts | | 479 + 479 | |
| Source(s) | 126 | citations 49, aiOverview 43, evidence 15; Keywords filter "Source" (origin) | | 763 + 508 | |
| Link(s) | 86 | auth 14 (account links), aiOverview, citations | | | |
| Answer(s) | many | aiOverview, prompts, citations | | 971 + 640 | |
| Response | 4 | dataRetention | | 71 + 244 | |
| Observation | 6 | common (statistics) | | 95 + 469 | |
| Run(s) | 196 | aiOverview 60, runs 50, prompts 41 | | 925 + 1008 | |
| Check(s) | 154 | rankings 68, keywordDetail 40 | | 766 + 895 | |
| Read (as a noun or verb for a check) | 2 | rankings refresh dialog | | | |
| Panel | 3 | rankings 2, prompts 1 | code comments | 422 + 244 | |
| Screenshot / Snapshot | 0 / 17 | keywordDetail "SERP snapshots" | | | |
| Share of voice / SOV | 65 / column headers | aiOverview 47, prompts 11 | | | |
| Rank / ranking | 140 | rankings 59, aiOverview 36, keywordDetail 26 | | | |
| Position | 27 | layouts 12 (card position), rankings 7 | | | |
| Branded | 65 | aiOverview 49, prompts 14 | | | |
| Detectable (change) | 22 | aiOverview 15, common 4 | | | |
| Insufficient | 1 | common | | | |
| Competitor(s) | 103 | prompts 29, aiOverview 27, entitySettings 16 | | 280 (entity) | |
| Brand | 179 | aiOverview 99, prompts 37, evidence 17 | | 148 | |
| Entity | few | entitySettings title "Entities and aliases" | | 237 + 280 | |
| Project / Workspace / Client | 233 / 106 / 5 | | | | |
| Workload | 14 | workloads, runs, costs | | | |
| Trigger | 4 | runs | | | |

## 2. Where one word carries two meanings (real app)

| Word | Meaning A | Meaning B | Screens |
|---|---|---|---|
| Group | A set of keywords (a keyword may sit in several, path names up to 10 levels) | A set of prompts (one primary group per prompt, group numbers add up to the total, spec D4) | Keywords, Prompts, Overview |
| Group | Keyword or prompt group | A kind of paid job in Budgets ("Scope and group") | Budgets |
| Group | Keyword or prompt group | A group or a term in the schedule selector ("Groups and terms") | Project settings |
| Source | The website an AI answer cites | How a keyword entered the app (filter "Source": By hand, CSV import, Paste, API, Search Console, Discovery) | Citations, Keywords |
| Source | A cited website | A kind of cited website in the filter "Third party sources" | Citations |
| Overview | Home page of the AI area | Home page of the SEO area; Google AI Overview (a platform and a Google results feature) | Navigation, Overview, Keywords |
| AI Overview | A Google results feature (Keywords filter, keyword detail) | A platform in the AI area | Keywords, AI area |
| Position | Where a page ranks on Google | Where a brand is named in an AI answer (A12 mention order) | Keywords, Overview |
| Rank | Google rank | "Structured rank" and "Mention order" in docs | Keywords |
| Visibility | The AI Visibility navigation group | The AI Visibility headline number | Navigation, Overview |
| Share of voice | AI share of voice (mentions) | SEO share of voice (doc 09 section 7) | Overview, Keywords |
| Query | A fan-out search an AI platform runs | A Search Console query (Performance mock) | Fan-out, Performance |
| Type | Prompt type (branded) | Taxonomy kind; entity type; location type; inspector type | Prompts, Settings |
| Tag | A free label on a keyword | A term of any taxonomy vocabulary (the `{vocabulary}: {term}` chip) | Keywords |
| Run | A scheduled AI collection pass | The action "Run started" on one prompt; a rank "check" has no run name | Prompts, Runs, Keywords |
| Check / read | One rank reading of a keyword | "A keyword is read at every location" | Keywords |
| Location | A country or a city (Keywords, settings) | A country only (Prompts, AI settings) | Keywords, Prompts |
| Country | Field label on Keywords add, filter, column | Field label on Prompts add and platform settings; the Prompts column is "Location" | Keywords, Prompts |

## 3. Conflicts between screens (same concept, different word)

| Concept | Real app (provisional) | Design preview | Docs and specs |
|---|---|---|---|
| Where prompts are asked | Platform | Overview mock: Platform. Prompts mock: Engine (select "Engine", filter "Engines", column "Engine gap", settings "Engines") | Engine (specs, docs, code) |
| A named set of prompts | Group (tab "Groups", column "Group") | Prompts mock: Topic (tab "Topics", column "Topic", "Topic drawer"). Overview and Keywords mock: Group | Topic (owner requirements R-09), taxonomy term |
| Where | Rankings: Country (add, filter, column) and Location (settings, import, filter). Prompts and Overview: Location (column, scope), Country (add dialog, platform settings) | Location (top bar, Prompts). Country (Keywords, Performance) | Country, location, market |
| A website that is cited | "Sources" page, "Citations" page, tabs Domains and Pages, "Source share" and "Citation share" | Cards "Top cited domains", "Citation share" | "Source share (C1)", "Domain citation rate (A2)" |
| The headline AI number | "AI Visibility" | "AI visibility" hero | "AI Visibility", D1 of the Overview spec |
| One AI reply | Answer | Answer | Observation, response, answer |
| Where in an answer | "Position" (card "position distribution") | "Average mention position" | A12 mention order, A10 structured rank |
| Empty states | "Insufficient data", "n/a", "not collected yet", "too few valid answers", hatched cell "3 answers" | n/a, "Not collected yet" badge, hatched cell | "unknown is never zero" (R6) |
| Own brand | "your brand", "Own brand", "Own domain", "your site", "Own pages", "owned" | "your brand", "Your pages" | own, owned |
| Brand record | "Entities and aliases" (settings), Own brand, Competitors, Watched | | entity (data model) |
| Strength of a change | "detectable", "within normal variation", "interim test" | same | "detectable change" (doc 17) |
| Time scope | window, period, "28 days", "previous period" | Compare with | window (doc 17) |

## 4. Navigation and page names in the real app

Navigation groups: **SEO** (Overview, Matrix, Keywords, Pages) and **AI Visibility** (Overview, Prompts, Citations,
Sources, Competitors, Discover, Reports), then Integrations, Runs, Costs, Settings. Two items are both called
"Overview". Both "Citations" and "Sources" exist. Keywords is the nav label of the route that is called "rankings" in
the code. Matrix and Discover are not defined in any spec I read; they are listed in `application-plan.md` as
"decide before the pass".

## 5. Info ("i") texts that exist today

Only the AI Overview preview has them (`apps/web/design-preview/aiov-info.js`: 27 cards, 9 measures, two parts each).
The real app carries them under `aiOverview` in `en.json`. Keywords, Pages, Costs, Runs and Integrations have tooltips
but no two-part info texts.

Defects found while reading them (not fixed here, listed in `decisions-for-owner.md`):

- The Share of voice text says "your mentions divided by all mentions of you and the tracked competitors" (a count
  share). `docs/16-metrics-methodology.md` section 5 defines an equal split inside each answer, averaged over the
  answers (A7), and lists the count share only as an export metric (`ai.mention_count_share`). The two disagree.
- The group heat map text says "every prompt belongs to one group, so the groups add up to the total" (spec D4).
  `docs/16` section 4 still says "a prompt in two topics counts in both; topic values do not sum to the total".
- "Prompt-weighted" and "schedule of their panel" show in visible text.
- Recommendation rate has a denominator in doc 16 ("valid answers where recommendation was classified or brand not
  mentioned") that the preview text does not state.
