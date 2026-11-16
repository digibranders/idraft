# Final word list

Status: decided 2026-11-16. The owner chose Group (D1) and delegated every other word choice to the glossary session,
which took its own recommendation for each (D2 to D16, D19, D21, D22). Three items stay open because they are facts or
unspecified screens, not word choices: **D17** (what Share of voice computes), **D18** (whether group numbers add up)
and **D20** (names for Matrix and Discover). The full definitions, banned words and info texts are in `terms.md`; the
reasons are in `decisions-for-owner.md`. This page is the list to keep open while writing a string.

Rules: sentence case; capitals only for product names and for SEO and AI. A banned word never appears in visible text
(code, API and database names are exempt).

## Areas and pages

| Use | Never |
|---|---|
| SEO, AI visibility (navigation groups) | AI Visibility, GEO, AEO, AI search |
| Overview (titles: "SEO overview", "AI visibility overview") | Dashboard, Home, Summary |
| Keywords, Pages, Prompts, Citations, Competitors, Reports, Integrations, Runs, Costs, Settings | Rankings, Topics, Engines, Sources (as a page name) |
| Citation opportunities (working name for the planned WP-61 page; confirm when it ships) | Sources |

## Where we ask and where we check

| Use | Never |
|---|---|
| Platform (ChatGPT, Gemini, Google AI Mode, Google AI Overview) | Engine, AI engine, Surface, LLM, Assistant |
| Model (the version inside a platform, for example gpt-5) | Engine version |
| Google AI Overview, always with "Google" | AI Overview alone, AIO, SGE |
| Search engine (the SEO side, value "Google") | Engine alone |
| SERP feature, SERP snapshot (gloss "Google results page" on first use) | Search feature, Results page snapshot |
| Device, Language | Locale |
| Location ("Country" and "City" only as levels in help text and pickers); All locations | Country as a field label, Region, Market, Geo, Worldwide |
| Depth, Beyond depth | Unranked, Over 100 |
| Period; Compare with (values: "vs previous period", "No comparison") | Window, Date window, Date range, Benchmark |

## How keywords and prompts are organised

| Use | Never |
|---|---|
| **Group** and Subgroup (keywords and prompts, one word; a group row opens onto its items) | Topic, Category, Cluster, Collection, List, Folder |
| Primary group (prompt dialogs only: a prompt has exactly one) | Main topic |
| Tag (free label, many per item, never adds up) | Label |
| Tag set (a named list of tags; the settings page is "Tags"); types: Product, Service, Campaign, Persona, Segment, Custom | Vocabulary, Taxonomy, Term, Kind, Market, Cluster |
| Domain type (kind of cited website: Your site, Competitor, Review site, Publisher, Community, Other) | Category, Source type |

## Units

| Use | Never |
|---|---|
| Prompt (AI side), Keyword (SEO side) | Query or Question as a label |
| Query (only a Search Console query, on Pages and performance) | Search term |
| Fan-out query (always both words) | Query alone on AI screens, Subquery |
| Answer, Valid answer, Failed answer | Response, Observation, Result, Reply |
| Run (a scheduled collection pass) | Job, Batch, Cycle |
| Check, "Check now" (one keyword rank reading) | Read, Scan, Lookup |
| Schedule | Panel, Cadence |
| Screenshot (image of an AI answer) | Capture |
| Job type (Costs and Budgets); Started by (Schedule, Manual, Backfill, Retry) | Workload, Trigger |

## What the answers contain

| Use | Never |
|---|---|
| Mention, mentioned (the brand name is in the text) | Named, Reference, Appearance |
| Citation, cited (a page the answer links to or lists) | Link as the counted thing, Reference, Source, Backlink |
| Cited domain (tab "Domains"), Cited page (tab "Pages") | Source domain, Source page |
| Source: only as "Source: Google Analytics" (where a number comes from) | Source for cited websites or for keyword origin |
| Added from (how a keyword entered: By hand, CSV import, Paste, API, Search Console, Discovery) | Source, Origin |
| Outcomes: Mentioned and cited, Mentioned only, Cited only, Neither | Named and linked, Named only, Unlinked mention |
| Branded, Non-branded | Brand prompt, Unbranded, Generic |
| Intent (Informational, Navigational, Commercial, Transactional, Local); Funnel stage | Search intent in labels, Stage alone |
| Retrieved, not cited (ChatGPT only, when it ships) | Found in, Source |

## Measures

| Use | Never |
|---|---|
| AI visibility rate (headline), short "Visibility" only in a narrow column | AI Visibility as a number name, Visibility score |
| SEO visibility (always with the prefix) | Visibility alone, Search visibility |
| Mention rate, Citation rate, Recommendation rate | Brand mention rate, Source citation rate, Endorsement rate |
| Share of voice (SEO side: "SEO share of voice") | Voice share, Share of mentions |
| Citation share | Source share, Domain share |
| Mention position (AI order; never bare "Position" on an AI screen) | Rank or Position for the AI order |
| Rank, Best rank, Top 3 (Google organic) | Position for a tracked keyword, Ranking as a noun |
| Average position (Search Console data only, labelled as such) | Avg rank |
| Sentiment: Positive, Neutral, Negative, Mixed (four shares) | Sentiment score |
| Search volume ("Volume" in a column), Keyword difficulty, CPC, Impressions, Clicks | SV, Demand, Competition |
| AI referral visits | Referral traffic, Sessions in plain text |
| They lead, You lead, Equal | Winning, Losing |

## Brands, sites and states

| Use | Never |
|---|---|
| Brand (settings page "Brands and aliases"; Type values: Brand, Product, Company, Person, Other) | Entity, Organization |
| Your brand, Your site, Your pages (sentences, empty states, info texts); tables, legends, exports and reports show the real brand name | Own brand, Own domain, Owned pages, Client brand |
| Competitor; Watched brand; Alias | Rival, Watched entity, Variant |
| Tracked, Not tracked, Paused, Archived | Monitored, Active, Disabled, Hidden |
| Project (one brand and its site), Workspace (a team's account); Client is never a level | Site, Account, Organisation, Agency |

## Data states and statistics

| Use | Never |
|---|---|
| Detectable change; Within normal variation; Provisional | Significant, Clear change, Interim test, Noise |
| Not enough data (answers exist, too few) | Insufficient data, Low sample |
| Not collected yet (no run has collected it) | No data, Pending |
| n/a (table cells only, with a tooltip that gives the reason) | N/A, Not applicable as the cell text, a blank cell |
| Sample data (a badge on the card, not inside info texts); Estimate (provider numbers) | Demo data, Mock, Placeholder |

## Abbreviations

Allowed: SEO, AI. In a narrow column header only, with the full term in the tooltip: SOV, KD, CPC. SERP only inside the
two labels above. Never: AIO, AIV, SV, GEO, AEO, SGE.

## Settled by taking the recommendation

| ID | Choice | Taken |
|---|---|---|
| D1 | Group or Topic | **Group** (the owner's decision) |
| D2 | Platform or Engine | Platform |
| D3 | Location or Country | Location |
| D4 | "Source" | Leaves the AI side; Citations page; Added from; page name for WP-61 |
| D5 | Rank or Position | Rank, and Mention position for AI |
| D6 | Verbs | Mention and cite; the four outcomes renamed |
| D7 | AI visibility casing | "AI visibility", headline "AI visibility rate" |
| D8 | Taxonomy page | Tags, Tag set |
| D9 | Empty states | Not enough data, Not collected yet, n/a in cells |
| D10 | Detectable change | Kept; "Provisional" replaces "interim test" |
| D11 | Overview | Kept with the area prefix; Google AI Overview in full |
| D12 | Brand or Entity | Brand, Alias, Watched brand; Type values Brand, Product, Company (was Organization), Person, Other |
| D13 | Fan-out | Fan-out query |
| D14 | SERP | Kept in two labels |
| D15 | Small words | Schedule, Job type, Started by |
| D16 | "Your brand" | Sentences only; real name in tables and exports |
| D19 | Tag set types | Topics and Clusters dropped, Market becomes Segment |
| D21 | Period or Window | Period |
| D22 | Smaller splits | As listed in `decisions-for-owner.md` |

## Still open

| ID | What | Who settles it |
|---|---|---|
| D17 | Share of voice: the preview text says a count share, doc 16 section 5 says an equal split per answer | Backend and owner, before any info text ships |
| D18 | Do group numbers add up: spec D4 says yes, doc 16 section 4 says no | Owner updates doc 16 to D4, or the heat map text is false |
| D20 | Names for the Matrix and Discover navigation items | Owner, when their screens are specified |
| A7b | Final name of the WP-61 page ("Citation opportunities" is a working name) | Owner, when WP-61 starts |
| D1 backend | One shared group list for keywords and prompts (spec D4) | Backend |
