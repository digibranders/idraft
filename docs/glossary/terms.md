# idraft glossary: terms

Status: DECIDED 2026-11-16, except D18 and D20 (see `final-list.md`); D17 was decided 2026-11-17 (a count share). The owner chose Group (D1) and delegated
every other word choice to the glossary session, which took its own recommendation. Where a row says **Firm**, none of
the three independent proposals (Opus, Fable, Codex) chose a different word for that term. Where it says **D1** to
**D22**, a proposal split on it or the owner had to choose; the options and reasons are in `decisions-for-owner.md`,
and the label shown is the decision taken. Rows marked D17, D18 or D20 are not final: their wording waits for a backend
fact or an unspecified screen.

Rules that apply to every row:

- Sentence case for every label ("Share of voice", "Mention rate"). Capitals only for product and platform names
  (ChatGPT, Gemini, Google AI Mode, Google AI Overview, Search Console, Google Analytics) and for the acronym SEO.
- Singular is the label of one thing, plural is the label of a list, a column of many, a filter and a page name.
- A banned word never appears in a visible string, aria label, tooltip, error, export header or email. It may appear in
  code, API fields, database columns, comments and internal docs.
- Abbreviations are allowed only in a narrow column header, only the three listed in section 9, and the tooltip then
  carries the full term.
- "Your brand" and "your site" speak to the reader in sentences, empty states and info texts. Column headers, filters
  and legends show the neutral term or the real brand name.

Columns: **ID**, **Label** (singular / plural), **Definition** (one sentence, starts with the category), **Is not**,
**Banned**, **Where used**, **Translation**, **Status**.

## 1. Areas and pages

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| A1 | AI visibility (navigation group, page titles) | The area of the app about how AI answers treat your brand. | Not the headline number (see M1). Not GEO. | AI Visibility (capital V), GEO, AEO, AI search, LLM tracking | Navigation group, breadcrumbs, page titles | Keep "AI" untranslated; translate "visibility" with the usual marketing word | D7 |
| A2 | SEO (navigation group) | The area of the app about Google search: keywords, pages, links. | Not a metric. | Search, Organic (as a nav name) | Navigation group, breadcrumbs | Acronym, not translated | Firm |
| A3 | Overview / Overviews | The first page of an area. Written "SEO overview" and "AI visibility overview" in page titles (h1, tab title). The AI breadcrumb and navigation item read "AI visibility" (owner decision 2026-11-17); the SEO item stays "Overview". | Not Google AI Overview. | Dashboard, Home, Summary, AI Overview (for this page) | Navigation, page titles, breadcrumbs | German Übersicht, French Vue d'ensemble. Google's feature has a different local name, so the Google prefix rule (P3) matters | D11 |
| A4 | Keywords | The SEO page that lists tracked keywords with their rank. | Not Prompts. | Rankings, Rank tracker (as a page name) | Navigation, page title | Safe | Firm |
| A5 | Pages | The SEO page that shows how each page of your site performs in Google. | Not cited pages (see E4). | Landing pages (unless the URL is one) | Navigation | Safe | Firm |
| A6 | Prompts | The AI visibility page that lists the prompts we ask and how your brand does on each. | Not Keywords. | Topics and prompts, Queries, Questions | Navigation, page title | Loanword in most languages | Firm |
| A7 | Citations | The AI visibility page about what AI answers cite, with the tabs Domains and Pages. | Not the page of opportunities (A7b). | Sources (as page name) | Navigation, page title | See E2 | D4 |
| A7b | Citation opportunities (working name) | The planned AI visibility page (work package WP-61, route `/ai/sources`) that shows which publishers and domain types answers cite, and where competitors are cited and you are not. | Not the Citations page: it is built on top of it. | Sources, Source intelligence | Navigation, once WP-61 ships | Name it for its job, then fix with the owner after the WP-61 scope is final | D4 |
| A8 | Competitors | The AI visibility page that compares your brand with each competitor. | | Rivals | Navigation | Safe | Firm |
| A9 | Reports / Integrations / Runs / Costs / Settings | The page names equal the plural of what they list. | | Engines, Topics, Panels, Taxonomy (see C6) | Navigation | Safe | Firm |
| A10 | Matrix, Discover | Not defined in any spec read for this work. | | | Navigation | Name them before the application pass | D20 |
| A11 | Link map (a tab of Internal links) | The tab that draws every live page of a crawl, and the links in page bodies between them, as one graph. Menu and footer links are not drawn: they are a property of the page they point to. | Not Journey (one page and its neighbours). Not Tier flow (link counts between tiers). | Site map, Network, Graph (as the tab name) | Internal links tabs, page titles | Safe | Firm |
| A12 | Website audit (navigation group) | The area of the app about the state of your own website: its issues, its pages and its internal links. | Not a page. Not a one-off report. | Site audit, Technical SEO, Site health | Navigation group, breadcrumbs | Safe | Owner decision 2026-11-26 |
| A13 | Issues | The Website audit page that lists every problem found on your website, in the tabs Technical and On-page. | Not alerts: a rank drop or a traffic drop is a change, not an issue. Not Cannibalization, which has its own page. | Errors (as the page name), Problems, Site health, Audit | Navigation, page title | Safe | Owner decision 2026-11-26 |
| A14 | Technical, On-page (tabs of Issues) | Technical: what stops a page being reached, crawled or indexed. On-page: what the page itself says (titles, addresses, keywords, and later descriptions, headings, content and images). | Not two pages. | Tech, Onpage, Content (as the tab name) | Issues tabs | "On-page" keeps its hyphen | Owner decision 2026-11-26 |

## 2. Where we ask, and where we check

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| P1 | Platform / Platforms | An AI answer product whose answers the app collects: ChatGPT, Gemini, Google AI Mode, Google AI Overview. Written "AI platform" only where SEO and AI words meet in one sentence. | Not the model version. Not a search engine. Not idraft itself. | Engine, AI engine, Surface, Product, LLM, Assistant, Chatbot | Filters, columns, the settings page "Platforms", setup step "Select AI platforms", run coverage, every AI card | Plattform, plateforme, plataforma. "Engine" would translate as motor and read as search engine | Firm |
| P2 | Model / Models | The version of a platform's AI model that wrote one answer, shown as the provider's own string (gpt-5). | Not the platform. | Engine version, LLM | Prompt inspector, answer detail, change notes ("Model changed on ChatGPT") | Keep the provider string untranslated | Firm |
| P3 | Google AI Overview / Google AI Overviews | Google's AI summary at the top of a results page. It is a platform on AI screens and a search feature on keyword screens, and it is always written with "Google". | Not the Overview page. Not Google AI Mode. | AI Overview (alone), AIO, SGE | Platform lists and columns, Keywords search features, info texts | Use Google's local product name with the prefix | D11 |
| P4 | Google AI Mode | Google's conversational search mode. We ask it prompts like ChatGPT. | Not Google AI Overview. Not Gemini. | AI Mode (alone), Google AI | Platform lists | Keep Google's local name | Firm |
| P5 | ChatGPT, Gemini | Product names of platforms. | | | Platform lists | Not translated | Firm |
| P6 | Search engine / Search engines | The classic search product a keyword rank is checked on. Today only Google; shown as a value ("Google"), under a column or filter titled "Search engine". | Not a platform. | Engine (alone), Platform (on keyword screens) | Keywords, keyword detail, add keyword, project settings | Suchmaschine, moteur de recherche | Firm |
| P7 | SERP feature / SERP features | A block on a Google results page other than the plain results: Google AI Overview, featured snippet, local pack and so on. "SERP" is Google's search results page; the first use on a screen carries the gloss "Google results page". | Not a platform, not a metric. | Search feature, Rich result, Result type | Keywords filter, keyword detail | SERP stays untranslated in most markets | D14 |
| P8 | Device / Devices | Desktop or mobile, for keyword checks. | Not used for prompts. | Platform (for device) | Keywords | Safe | Firm |
| P9 | Language / Languages | The language a keyword is searched in or a prompt is written in. | Not the location. | Locale | Filters, columns, add dialogs | Safe | Firm |
| P10 | Location / Locations | The place a keyword is checked from or a prompt is asked from: a country or a city. | Not the language. Not a market. | Country (as a field label), Region, Market, Geo, Area | Every filter, column, picker and top bar on both sides ("Location: Germany") | German Standort, French Zone or Lieu (not Emplacement). Flag for the translator | D3 |
| P11 | Country, City (lower case, inside sentences) | The two levels a location can have. Never a field label. | | Nation, Town, Metro | Help text and picker placeholder ("Search countries and cities"), note "AI answers are collected at country level" | Safe | D3 |
| P12 | All locations | The scope value that includes every location of the project. | Not worldwide. | All countries, Global, Worldwide | Scope pickers, top bar | Safe | D3 |
| P13 | Depth / Beyond depth | How many Google results a check reads (top 10, 20, 50, 100). Beyond depth means your site was not in the results read. | Not "does not rank". | Unranked, Not ranking, Over 100 | Keywords filter and column | "Beyond depth" needs a gloss: not in the results read | Firm |
| P14 | Period | The date range the numbers cover. | Not a run. | Window (in UI), Date window, Date range, Timeframe | Date control, info texts, Compare | Safe | D21 |
| P15 | Compare with (control) / "vs previous period", "vs same period last year" and "No comparison" (values; Overview and Prompts have all three since owner decision 15, 2026-11-17, Citations the first and last) | A control that shows the period just before the chosen one, or the same dates a year earlier, of equal length, next to it. The words that follow the chosen mode are "Previous period: range" or "Same period last year: range" (a period tooltip) and "against the previous period" or "against the same period last year" (a change sentence). | Not a comparison with a competitor. | Compare period, Benchmark, Baseline, vs last period | Top bar | Safe | D22 |

## 3. How keywords and prompts are organised

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| C1 | Group / Groups | A named set of keywords or of prompts that numbers are rolled up by. A group row opens onto the items inside it. Same word on both sides. | Not a tag. Not a kind of paid job. Not a domain type. | Topic, Category, Cluster, Theme, Collection, List, Folder, Term, Segment | Keywords, Prompts, Overview select and cards, schedules, reports | Gruppe, groupe, grupo. "Topic" and "Cluster" stay English in German and confuse clients | Decided (D1) |
| C2 | Subgroup / Subgroups | A group inside another group, written as a path "Services / Audits". | Not a second kind of object. | Child group, Nested group, Subtopic, Level | Group manager, "Add subgroup", "includes subgroups" | Untergruppe, sous-groupe | Firm |
| C3 | Primary group | The one group a prompt must have, so that group numbers add up to the total. Shown only in the add and edit prompt dialogs and the info texts that say the groups add up. | Not the only group a keyword may have. | Main topic, Default group | Add and edit prompt dialogs | Safe | Decided (D1) |
| C4 | Group row (design name, not shown to users) | A table row for a group that opens to show the prompts or keywords inside it. Users see only "Groups", the toggle "By group" and "All prompts" or "All keywords". | | Accordion, Topic drawer, Parent row | Specs and design docs | Not translated | Firm |
| C5 | Tag / Tags | A free label on a keyword or prompt. An item can have many. Tags do not form a tree and are never used for totals. | Not a group. No subtags. | Label (for this), Keyword label | Keyword rows, filters, bulk edit | Loanword in German and Dutch; French étiquette | Firm |
| C6 | Tag set / Tag sets (settings page "Tags") | A named list of tags that belong together, for example Products, Services, Campaigns, Personas. Replaces "vocabulary" and "taxonomy". | Not a group. | Vocabulary, Taxonomy, Dimension, Facet, Classification | Settings page, tag pickers (shown as "Persona: Enterprise") | Safe | D8 |
| C7 | Tag set type | What a tag set is for, chosen once when it is created: Product, Service, Campaign, Persona, Custom. Replaces "kind". | Not prompt type. | Kind | The create dialog only | Safe | D8, D19 |
| C8 | Domain type / Domain types | The kind of website a citation goes to: Your site, Competitor, Review site, Publisher, Community, Other. Set by the app. | Not a group. | Category, Source type, Source category, Role | Citations cards and filters | Safe | D22 |
| C9 | Theme | The light or dark colour setting. | Never an organiser. | | User menu | Safe | Firm |

## 4. Units of work and data

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| U1 | Prompt / Prompts | The text the app sends to an AI platform on a schedule, written as a buyer would ask it. | Not a keyword. Not a fan-out query. | Query, Question (as a label), Search term | The AI visibility area | Loanword in most languages | Firm |
| U2 | Keyword / Keywords | A search term whose Google rank the app tracks per location, device and language. | Not a prompt. Not a Search Console query. | Term, Search term, Phrase, Query | The SEO area | Safe | Firm |
| U3 | Query / Queries | A search that people typed into Google, as Search Console reports it. | Not a tracked keyword. Not a fan-out query. | Search term | Page performance only | Follow Google's local Search Console wording | D22 |
| U4 | Fan-out query / Fan-out queries (always both words) | A search an AI platform runs by itself while it builds an answer. First use on a page carries the gloss "searches the platform runs to build its answer". | Not our prompt. Not a Search Console query. | Query (alone, on AI screens), Subquery, Related search | Prompt detail, Overview card | No natural equivalent: keep "fan-out" and translate the gloss | D13 |
| U5 | Answer / Answers | What one platform returned for one prompt in one location on one day. | Not a run. | Response, Observation, Result, Output, Reply, Reading | Every AI screen | Antwort, réponse, respuesta | Firm |
| U6 | Valid answer / Valid answers | An answer that was collected in full and can be counted. It is the base of every AI rate. | Not an answer that mentions you; a valid answer may mention nobody. | Good answer, Usable answer, Successful response | Info texts, coverage, tooltips | Translate as "countable", not "correct" | Firm |
| U7 | Failed answer / Failed answers | An answer the app could not collect or the platform refused. Left out of every rate. | Not a miss for your brand. | Invalid answer, Error, Missing answer | Runs, run calendar, coverage | Safe | Firm |
| U8 | Run / Runs | One scheduled pass that asks a set of prompts or checks a set of keywords at a set time. | Not one answer or one check. | Job, Batch, Cycle, Wave, Crawl | Runs page, run calendar, "Run started" | Durchlauf, exécution. Not "race" | Firm |
| U9 | Check / Checks (verb: Check now) | One reading of a keyword's rank at one location, device and language. | Not a run. Not used for AI answers. | Read, Reading, Lookup, Scan | Keywords, keyword detail, Costs | Prüfung, vérification | D22 |
| U9b | Check / Checks (Issues page only) | One test your website is put through on the Issues page, for example "Pages without a title". A check passes when it finds no page. | Not a keyword rank reading (U9); the page it is on tells the two apart. Not an issue: the issue is what a check found. | Rule, Test, Audit, Scan, Hint | Issues: "Checks passed", "Show passed checks", "No checks match" | Same word as U9 in most languages | Proposed 2026-11-26, open for the owner |
| U13 | Issue / Issues | A problem a check found on one or more pages of your website that someone can fix on the site. | Not a change over time (a rank drop, a traffic drop): those are alerts. | Error (for every issue), Problem, Defect, Bug | Issues page, column "Issue", "Pages with an issue" | Safe | Owner decision 2026-11-26 |
| U14 | Severity: Error, Warning, Notice | How much an issue matters. Error: breaks a page for visitors or for Google, fix these first. Warning: holds a page back, fix after the errors. Notice: worth a look, often intended. | Not a score. Not the HTTP status of a page. | Critical, High, Medium, Low, Info, Hint | Issues column, filter and strip ("Pages with an error") | Safe | Proposed 2026-11-26, open for the owner |
| U15 | Found by (column, filter, badge) | The data a check comes from: Crawl, Rank checks, Search Console, Google Analytics or AI answers. | Not "Source": that word only says where a number comes from ("Source: Google Analytics"). | Source, Origin, Detected by, Provider | Issues column, filter "Found by", badge "Found by: Crawl" | Safe | Owner decision 2026-11-26 |
| U10 | Schedule / Schedules | The rule that says when runs happen and which prompts or keywords they cover. | Not a run. | Panel, Cadence, Plan | Project settings, run calendar | Safe | D15 |
| U11 | Screenshot / Screenshots | A stored image of an AI answer as the platform showed it. | Not a snapshot. | Capture, Image | Answer detail | Loanword | Firm |
| U12 | SERP snapshot / SERP snapshots | The stored copy of the Google results page from one check. | Not an image of an AI answer. | Snapshot (alone), Results page snapshot, SERP copy, Cache | Keyword detail tab | Use a word unlike the one for screenshot (German Momentaufnahme) | D14 |
| U13 | Job type / Job types | A kind of paid collection work in Costs and Budgets: Rank checks, AI prompts, Search Console sync. Replaces "workload". | Not a group. | Workload, Group (here) | Costs, Budgets ("Scope and job type") | "Workload" translated literally would mislead | D15 |
| U14 | Started by | What started a run: Schedule, Manual, Backfill, Retry. Replaces "trigger". | Not a person. | Trigger, Origin, Source | Runs, Costs | Safe | D15 |

## 5. What the answers contain

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| E1 | Mention / Mentions (verb: mention, mentioned) | A brand's name appearing in the text of an answer. | Not a citation. A mention needs no link. | Named, Naming, Reference, Appearance, Brand hit | Every AI screen | Erwähnung, mention | D6 |
| E2 | Citation / Citations (verb: cite, cited) | A page that an answer links to or lists as a source. One citation is one page in one answer, however often it repeats. | Not a mention. Not a quotation of your text. | Link (as the counted thing), Reference, Source, Backlink | Citations page, every AI metric | False friend in French and German (quotation). Use the local "reference to a source" and test it with a native SEO | D6 |
| E3 | Cited domain / Cited domains (tab "Domains") | A website, identified by its registrable name (example.com), that answers cite. | Not a data source. Not how a keyword was added. | Source, Source domain, Reference | Citations tab Domains, competitor drawer | Safe | D4, D22 |
| E4 | Cited page / Cited pages (tab "Pages") | One URL that answers cite. | Not a page of your site unless it is marked "Your pages". | Source page, Source | Citations tab Pages | Safe | D4, D22 |
| E5 | Link / Links | A hyperlink between two pages, as internal link tracking records it. In prose: "an answer links to a page". | Not a citation. | (none on the SEO side) | Internal links area | Safe | Firm |
| E6 | Source (only as "Source: Google Analytics") | The provider a number comes from. | Not a cited website. Not how a keyword was added. | Used for cited sites; used for keyword origin | Footnotes of cards and exports | "Data source" | D4 |
| E7 | Added from | How a keyword entered the project: By hand, CSV import, Paste, API, Search Console, Discovery. Replaces the Keywords filter "Source". | Not the person who added it. | Source, Origin | Keywords filter and column | Safe | D4 |
| E12 | Retrieved, not cited (ChatGPT only; ships later) | A page the platform read while building an answer and did not cite. | Not a citation. | Found in, Source | Citations, when the metric ships (doc 16 C8) | Safe | Firm |
| E8 | Outcome / Outcomes (card "Outcome split") | Which of four things happened to your brand in one answer: Mentioned and cited, Mentioned only, Cited only, Neither. | Not a rate by itself. | Named and linked, Named only, Unlinked mention (as a filter value), Result | Outcome split card, prompt rows, filters | Safe | D6 |
| E9 | Branded / Non-branded | A prompt or keyword whose text contains your brand name or one of its aliases, or does not. Branded prompts are left out of AI numbers by default. | Not "the answer mentions your brand". | Brand prompt, Unbranded, Generic, Navigational | Prompts and Keywords filters, scope chip "Non-branded only" | Translators may need "with the brand name" | Firm |
| E10 | Intent | Why someone searches or asks: Informational, Navigational, Commercial, Transactional, Local. Same word and values on both sides. | Not funnel stage. | Search intent (once in help text), Purpose, Goal | Keywords, Prompts | Safe | Firm |
| E11 | Funnel stage | Where a searcher is in buying: Top of funnel, Middle of funnel, Bottom of funnel, Retention. | Not intent. | Stage (alone) | Filters | "Funnel" is understood in marketing circles; gloss it elsewhere | Firm |

## 6. Measures

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| M1 | AI visibility rate (short: "Visibility" only in a narrow column) | The share of valid answers that mention your brand, cite your site, or both. | Not SEO visibility. Not share of voice. A rate, never a composite score. | AI Visibility as a metric name, Visibility score, Presence, Coverage | Overview headline, Prompts, Reports | Safe | D7 |
| M2 | SEO visibility | An estimate of how visible your tracked keywords are in Google, weighted by rank and by search volume. | Not a share of answers. Not comparable with M1. | Visibility (alone), Search visibility, Visibility index | SEO overview | Always carries the prefix | Firm |
| M3 | Mention rate | The share of valid answers that mention your brand. | Not a count of mentions. | Brand mention rate, Mention frequency, Visibility | AI screens | Safe | Firm |
| M4 | Citation rate | The share of valid answers that cite at least one page of your domains. | Not citation share. | Source citation rate, Domain citation rate, Link rate | AI screens | Follows E2 | Firm |
| M5 | Share of voice (abbreviation SOV only in a narrow column) | Your brand's mentions over all tracked-brand mentions (yours and the tracked competitors'), decided 2026-11-17 (D17). It is always shown as "x of y brand mentions" beside the percent. With All platforms it is the equal-weight average of the platforms' shares ("average of N"), each platform's own "x of y brand mentions" in the tooltip and no pooled count beside the percent (docs/16 section 5). On the SEO side written "SEO share of voice". | Not mention rate: it changes when a competitor is added. | Voice share, Share of mentions, Mention share | Overview, Competitors, Keywords | Often left in English; French "part de voix" is established | D17, D22 |
| M6 | Citation share | A domain's part of all citations in scope. For your domains, "Your citation share". | Not citation rate: the base is citations, not answers. | Source share, Domain share, Share of citations | Citations, Overview | Follows E2 | D4 |
| M7 | Mention position (card "Average mention position"; never bare "Position" on an AI screen) | The order in which your brand is first mentioned in an answer, among the brands you track. 1 is first; lower is better. | Not a Google rank. Not a place in a numbered list inside an answer. | Position (alone), Rank, AI rank, Mention order, Prominence | Overview, prompt tables | Safe with the qualifier | D5 |
| M8 | Rank / Ranks (best rank, average rank, Top 3) | Where your page appears in Google's organic results for a keyword, counted from the top. 1 is first. | Not a mention position. Not Search Console's average position. | Position (for tracked keywords), Ranking (as a noun), SERP position | Keywords, keyword detail, SEO overview | Safe | D5 |
| M9 | Average position | Google Search Console's own average place for a query or page. Used only on Search Console data and labelled as such. | Not a tracked rank. | Avg rank | Pages, performance | Follow Google's local wording | D5 |
| M10 | Recommendation rate | The share of valid answers that recommend your brand, not only mention it. | Not sentiment. A positive mention is not always a recommendation. | Endorsement rate, Top pick rate | AI screens | Safe | Firm |
| M11 | Sentiment (values: Positive, Neutral, Negative, Mixed) | The tone of the text around a mention of your brand, shown as four shares. | Not one score. | Tone (in the explaining sentence only), Sentiment score, Favourability | AI screens | German also Tonalität | Firm |
| M12 | Search volume (short: "Volume" in a column) | The data provider's estimate of average monthly Google searches for a keyword at a location. | Not clicks. Not impressions. Not available for prompts. | SV, Demand, Popularity | Keywords | Safe | Firm |
| M13 | Keyword difficulty (abbreviation KD only in a narrow column) | The data provider's score from 0 to 100 for how hard it is to reach the first results for a keyword. | Not our calculation. Not a probability. | Difficulty (alone), Competition, SEO difficulty | Keywords | KD is understood by SEO users in most markets | D22 |
| M14 | CPC | The average cost per click that advertisers pay for a keyword, in US dollars. | | Cost per click (spelled out only in the tooltip) | Keywords | Google Ads uses CPC in every language | Firm |
| M15 | Impressions, Clicks | As Google Search Console defines them. | Not AI numbers. | Views, Visits (for clicks) | Pages, performance | Follow Google's local wording | Firm |
| M16 | AI referral visits | Visits to your site that Google Analytics attributes to AI platforms. | Not clicks in an answer. | Referral traffic, Sessions (in plain text) | Overview card | Safe | Firm |
| M17 | They lead / You lead / Equal | In one prompt, a brand leads when it is mentioned in at least 2 more answers than the other, over the platforms in scope, and the prompt has at least 4 valid answers. A smaller difference is Equal. | Not a win in any single answer. | Winning, Losing, Lost to (as a column) | Competitor card and drawer | Safe | Firm |

## 7. Brands, sites and states

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| B1 | Brand / Brands | A company or product name the app looks for in answers, with its aliases and domains. | Not a domain. Not always a competitor. | Entity, Company, Organisation | Settings page "Brands and aliases", pickers | Marke, marque, marca | D12 |
| B2 | Your brand | The brand this project is about. | Not the agency's brand. | Own brand, Our brand, Client brand, Primary brand | Info texts, empty states, legends | Formal or informal "your" is set once per language | D16 |
| B3 | Your site / Your pages | The domains and pages that belong to your brand. | Not every domain in the project. | Own domain, Owned pages, Own pages, Own site | Citations, info texts | Same as B2 | D16 |
| B4 | Competitor / Competitors | A brand you compare yourself with. It counts in share of voice. | Not a watched brand. | Rival, Peer | Everywhere | Safe | Firm |
| B5 | Watched brand / Watched brands | A brand followed in answers that does not count as a competitor and not in share of voice. | Not a competitor. | Watched entity, Watchlist | Settings, filters | Safe | D12 |
| B6 | Alias / Aliases | Another spelling or name that counts as a mention of a brand. | | Variant, Synonym, Entity alias | Brands and aliases | Safe | D12 |
| B7 | Tracked / Not tracked | Tracked: collected on a schedule (a keyword, a prompt, a brand). Not tracked: seen in the data and not added (a brand found in answers, a Search Console query). | Not paused. | Monitored, Active, Untracked, Candidate | States, counts ("Tracked prompts") | Safe | Firm |
| B8 | Paused | Collection is stopped and can be resumed. History stays and the item stays in lists. | Not archived. | Disabled, Inactive, Stopped, On hold | Projects, schedules, prompts, keywords | Safe | Firm |
| B9 | Archived | Removed from lists and reports, not collected, history kept, can be restored. | Not deleted. Not paused. | Hidden, Removed, Retired | Projects, prompts, keywords | Safe | Firm |
| B10 | Project / Projects | One brand and its site, with its keywords, prompts, competitors and schedules. | Not a workspace. Not a client. | Client, Site, Campaign, Property, Account | Everywhere | Safe | Firm |
| B11 | Workspace / Workspaces | A team's account: its members and its projects. | Not a project. | Organisation, Team, Account, Agency | Sign-in, settings, switcher | Often kept in English | Firm |
| B12 | Client | Not a product level. Allowed only in example text. | | Client (as a level, filter or page) | Role help text | Safe | D22 |

## 8. Data states and statistics

| ID | Label | Definition | Is not | Banned | Where used | Translation | Status |
|---|---|---|---|---|---|---|---|
| S1 | Detectable change | A change larger than the app can explain by normal variation between periods. | Not "big" or "important". | Significant, Statistically significant, Real change, Clear change | Change chips, key changes, deltas | German nachweisbare Änderung, French changement détectable | D10 |
| S2 | Within normal variation | A change small enough to be ordinary movement. | Not "no change". | Not significant, Noise, Stable, Flat | Change chips, tooltips | Safe | Firm |
| S3 | Provisional | A change tested with a simpler method because the full one is not possible yet. Treat it with care. | Not a detectable change. | Interim test, Unpaired, Preliminary | Change chips | Safe | D10 |
| S4 | Not enough data | There are answers or checks, and too few to show a number. The tooltip gives the reason and the minimum. | Not zero. Not "not collected yet". | Insufficient data, Too few valid answers (as the label), Low sample | Cells, cards | Safe | D9 |
| S5 | Not collected yet | No run has collected this yet. Waiting fixes it. | Not a failure. | No data, Pending, Empty | Cells, cards, new projects | Safe | D9 |
| S6 | n/a (lower case, with a tooltip "Not available for this platform" or the fitting reason) | The measure cannot exist here, for example fan-out queries on a platform that does not show them. | Not "not enough data". A blank cell is never used. | N/A, Not applicable (as the cell text) | Table cells only | Use the local short form; spell it out in the tooltip | D9 |
| S7 | Sample data (badge) | Invented numbers shown until the real feature or connection exists. | Not an estimate. | Demo data, Mock, Placeholder, Example | A badge on the card, never inside an info text | Safe | Firm |
| S9 | Blocked (page status chip, flag, filter) | A page that answered 401, 403 or 429 to the crawler, so its content and links out are unknown. Neutral grey, never red. | Not an error page. Not a broken link. | Error page (for these), Forbidden, Denied, Broken | Internal links: Pages status and flag, Links target status, journey | Safe | Firm |
| S10 | Coverage sentence | "Read {read} of {crawled} pages; {blocked} refused our crawler, so numbers may be incomplete." Shown above the tabs and in the client summary when a crawl had refused pages. Asks nothing of the customer. | Not a failure of the crawl. | Warning, Crawl failed | Internal links banner, client summary | Safe | Firm |
| S13 | Stopped early (crawl note) | "This crawl was stopped early, so some pages are missing." Shown on a finished crawl that stopped itself (no new page for 5 minutes, or 45 minutes in all). Asks nothing of the customer. | Not a failed crawl. | Timed out, Stalled, Aborted | Internal links banner | Safe | Firm |
| S14 | Parameter variant (flag, filter, count) | An address that is the same page as another one with a query string added (`/blogs?page=2`, a tracking link): its canonical names that page. Its links count for the page it names, and it is left out of every page count. The count is shown beside the page total and opens the list of them. | Not a page of the site. Not an error. | Duplicate, Parameter page, Query page, Tracking page | Internal links: crawl total, Pages filter and flag, inspector | Safe | Firm |
| S11 | May be incomplete | A small note on a count that reads pages the crawler could not open. | Not "wrong". | Inaccurate, Unreliable | Internal links worklist counts, client summary | Safe | Firm |
| S12 | URLs found / URLs read (crawl progress) | While a crawl runs, "found" is every address the crawler has seen so far (pages not fetched yet, redirects, error pages and other files included) and "read" is how many it has fetched. The total grows as links are followed. A finished crawl says "URLs read". | Not the number of pages of the site. | Pages found (while crawling) | Internal links crawl banner, first crawl, crawl limit bar | Safe | Firm |
| S8 | Estimate (badge or suffix "est.") | A number a data provider supplies as an estimate: search volume, CPC, keyword difficulty. | Not sample data. | Approx., Projected | Keywords | Safe | Firm |

## 9. Abbreviations

| Allowed in a narrow column header, with the full term in the tooltip | Never allowed |
|---|---|
| SOV (Share of voice), KD (Keyword difficulty), CPC (decision D22: Opus bans SOV and KD). SEO and AI always. SERP only inside "SERP feature" and "SERP snapshot" | AIO, AIV, SV, GEO, AEO, SGE, n/a anywhere but table cells |

## 10. Info ("i") texts

Rules: two parts, in this order. **What it shows** is one sentence that defines the card or number. **How it is counted**
gives the method, then what it leaves out. Only two verbs, "mention" and "cite". The only base is "valid answers". No
figure that changes with the data. Fixed rule numbers (at least 4 valid answers, at least 2 more answers, 28 days) are
configuration constants and stay; if a constant changes, its texts change in the same commit. "Sample data until ..."
sentences move to the Sample data badge. The same text is used for the card, its tooltip and any export footnote.

### 10.1 AI visibility cards (keyed as in `aiov-info.js`)

**ai.visibility_split: AI visibility rate (headline)**
- What it shows: How often AI answers mention your brand or cite your site.
- How it is counted: The share of valid answers that mention your brand, cite a page of your site, or both. It equals 100% minus the answers that do neither. Each prompt counts once. The bar splits the rate into the four outcomes. Each tile beside it has its own info button.

**ai.rate_trend_by_engine: Rate by platform over time**
- What it shows: How the chosen rate changes from week to week.
- How it is counted: One point for each weekly run, one line for each platform, with their average dashed. For a single platform the shaded band is the 95% range the true rate likely sits in. With Compare on, a dashed vertical line separates the previous 28 days from the current 28 days.
- How it is counted, with "vs same period last year": the same text, ending: With Compare on, a second dashed line shows the same period last year, week for week.

**ai.outcome_mix: Outcome split by platform**
- What it shows: What happens to your brand in each platform's answers.
- How it is counted: Each valid answer is mentioned and cited, mentioned only, cited only, or neither. The four shares add up to 100%. Mentioned only means your brand is mentioned and none of your pages is cited.

**ai.share_of_voice: Share of voice** (D17 decided 2026-11-17: a count share)
- What it shows: How much of the brand talk in answers is about you, compared with your competitors.
- How it is counted: Your brand's mentions over all tracked-brand mentions: x of y brand mentions, where y adds up the mentions of you and of every tracked competitor (an answer that names three tracked brands adds three). It depends on which competitors are tracked: adding one lowers every other share. Watched brands do not count. A share is shown only from 4 brand mentions. For All platforms it is the average of the platforms' shares, each platform counting once, and the counts are per platform in the tooltip. Click a competitor to open it.

**ai.sov_over_time: Share of voice over time**
- What it shows: How the split of brand mentions between you and your competitors changes week by week.
- How it is counted: Each week adds up to 100% of the tracked brands' shares of voice.

**ai.lost_to_competitor: Lost to competitor**
- What it shows: Where each competitor is mentioned more often than you, and where you are mentioned more often than them.
- How it is counted: Counted in prompts. A brand leads a prompt when it is mentioned in at least 2 more answers than the other and the prompt has at least 4 valid answers; a closer result is mostly noise and is not counted. Click a name or a number to see the prompts.

**ai.topic_heatmap: Groups by platform**
- What it shows: How each group of prompts performs on each platform.
- How it is counted: Pick a measure; each cell is that rate for the group's prompts on that platform. Every prompt belongs to one group, so the groups add up to the total. A hatched cell has fewer than 4 valid answers and shows no rate. Click a cell to open the group.

**ai.top_prompts: Prompts of this group**
- What it shows: The prompts of this group and how your brand does on each.
- How it is counted: Rates are averaged over the platforms in scope. Prompts with fewer than 4 valid answers are not listed.

**ai.topic_extremes: Strongest and weakest groups**
- What it shows: The groups where your brand does best and worst.
- How it is counted: Groups are ranked by the chosen measure, averaged over the platforms, with each group's prompt count. It needs at least 4 groups with a rate.

**ai.group_vs_all: This group against all groups**
- What it shows: How the chosen group compares with all groups, on each platform.
- How it is counted: The bar is the group's rate for the chosen measure. The note beside it is the rate for all groups and the gap in points. A platform with fewer than 4 valid answers in the group shows no rate.

**sources.top_domains: Top cited domains**
- What it shows: The domains AI answers cite most often.
- How it is counted: A page is counted once for each answer that cites it. Each share is a part of all citations in scope.

**ai.citation_share_by_domain_type: Citations by domain type**
- What it shows: What kinds of domains AI answers cite.
- How it is counted: The areas add up to all citations in scope, grouped by domain type: your site, competitors, review sites, publishers, community and other.

**sources.own_pages: Your pages cited**
- What it shows: Which pages of your site AI answers cite.
- How it is counted: Each page's share of all the citations that go to your domains.

**ai.unlinked_mentions: Mentioned, not cited**
- What it shows: Prompts where AI mentions your brand but cites none of your pages.
- How it is counted: Counted per prompt, from the answers that mention your brand without citing your site.

**ai.position_distribution: Mention position**
- What it shows: Where your brand comes in the order of brands mentioned in an answer.
- How it is counted: The mention position is among the brands you track, not every brand in the answer. 1 means mentioned first, and lower is better. It is not a Google rank.

**ai.sentiment_by_engine: Sentiment by platform**
- What it shows: The tone AI uses when it mentions your brand.
- How it is counted: The share of mentions that are positive, neutral, negative or mixed, shown as four shares and never one score. Tone is rule-based, with a model check on low-confidence mentions.

**traffic.ai_referrals: AI referral visits**
- What it shows: Visits to your site that come from AI platforms.
- How it is counted: A visit is a session as Google Analytics counts it, from chatgpt.com and gemini.google.com as Google Analytics classifies them. Google AI Mode and Google AI Overview visits cannot be told apart from Google organic.

**ai.fanout_top: Top fan-out queries**
- What it shows: The extra searches ChatGPT runs to build its answers.
- How it is counted: Only ChatGPT shows them. A fan-out query is listed when it appears in at least 2 answers.

**activity.key_changes: Key changes**
- What it shows: The changes in the last 28 days that deserve your attention.
- How it is counted: Only detectable changes are listed, together with collection events.

**ops.answer_calendar: Run calendar**
- What it shows: When each weekly run happened and how it went.
- How it is counted: Each cell is one weekly run. A partial run keeps the answers that completed; failed answers count as collection problems, not as a miss for your brand.

### 10.2 Competitor drawer

**competitor.summary**
- What it shows: You and this competitor side by side on each measure.
- How it is counted: The gap is your value minus theirs. Rates count each prompt once. Share of voice depends on which competitors are tracked.

**competitor.trend**
- What it shows: How your mention rate and theirs change week by week.
- How it is counted: One point for each weekly run. The 8 weeks are the previous 28 days and the current 28 days.

**competitor.platforms**
- What it shows: You and this competitor on each platform.
- How it is counted: A platform with fewer than 4 valid answers shows n/a. Google AI Overview is read from rank checks and counts only the checks that showed one.

**competitor.groups**
- What it shows: The groups where this kind of lead happens most.
- How it is counted: Click a group to narrow the prompt list below to it. Click it again to clear.

**competitor.prompts**
- What it shows: The prompts behind the lead you picked, the largest difference first.
- How it is counted: A brand leads a prompt when it is mentioned in at least 2 more answers than the other, over the platforms in scope. A smaller difference is mostly noise and counts as equal. A prompt needs at least 4 valid answers; those with fewer are left out.

**competitor.sources.theirs**
- What it shows: The domains AI cites in answers that mention this competitor.
- How it is counted: Each domain's share of the citations in those answers. Their domain ranks high because their pages are cited more when they are mentioned.

**competitor.sources.yours**
- What it shows: The domains AI cites in answers that mention you.
- How it is counted: The same count as for the competitor, over the answers that mention you.

**competitor.sources.gap**
- What it shows: Domains that AI cites next to this competitor and does not cite next to you.
- How it is counted: Taken from the top cited domains of each side. These are the places to look for a citation of your own.

### 10.3 Headline measures (keyed as `MEASURE_INFO`)

**visibility: AI visibility rate**
- What it shows: How often AI answers mention your brand or cite your site.
- How it is counted: The share of valid answers that mention your brand or cite your site, which is 100% minus the answers that do neither. Each prompt counts once.

**mention: Mention rate**
- What it shows: How often AI answers mention your brand.
- How it is counted: The share of valid answers whose text contains your brand name or one of its aliases. Each prompt counts once. A citation without the brand name in the text is not a mention.

**sov: Share of voice**
- What it shows: Your share of all brand mentions.
- How it is counted: Your brand's mentions over all tracked-brand mentions, shown as x of y brand mentions (D17). It depends on which competitors are tracked.

**citation: Citation rate**
- What it shows: How often AI answers cite your site.
- How it is counted: The share of valid answers that cite at least one page of your domains. Several citations in one answer count once. A mention without a citation does not count.

**position: Mention position**
- What it shows: How early your brand is mentioned in an answer.
- How it is counted: The mean order among the tracked brands, over the answers that mention you. 1 means mentioned first, and lower is better. It is not a Google rank.

**recommendation: Recommendation rate**
- What it shows: How often AI recommends your brand.
- How it is counted: The share of valid answers that recommend it. An answer that does not mention your brand counts as not recommending it. Answers whose recommendation could not be judged are left out.

**sentiment: Sentiment**
- What it shows: How positive the tone is when AI mentions your brand.
- How it is counted: The share of judged mentions with a positive tone. The Sentiment card shows all four shares.

**prompts: Prompts**
- What it shows: How many prompts are tracked in this view.
- How it is counted: Each prompt is counted once, however many platforms answer it.

**runs: Runs**
- What it shows: How many weekly runs are behind these numbers.
- How it is counted: Prompts are asked on their schedule, so a run may hold only some of them.

### 10.4 SEO measures (new: the real app has none of these as two-part texts)

**Rank (Keywords column, keyword detail)**
- What it shows: Where your page appears in Google's organic results for this keyword. 1 is first.
- How it is counted: The best placed page of your domains among the organic results of the check, counted from the top. Ads and search features are not counted. Only checks at this location, device and language count. Beyond depth means your site was not in the results the check read.

**Best rank, Average rank**
- What it shows: The highest, or the mean, rank of this keyword in the chosen period.
- How it is counted: Over the checks in the period where the keyword was ranked. A check beyond depth is not counted as a number, and the count of such checks is shown beside it.

**Search volume**
- What it shows: How many times a month people search Google for this keyword.
- How it is counted: The data provider's estimate of average monthly searches over the latest twelve months, for the keyword's location and language. A keyword the provider does not know shows no value, not zero.

**Keyword difficulty**
- What it shows: How hard it is to reach the first results for this keyword.
- How it is counted: A score from 0 to 100 from the data provider, based on how strong the pages are that rank now. Higher is harder. The app shows the provider's value and does not recalculate it.

**CPC**
- What it shows: What advertisers pay on average for a click on this keyword.
- How it is counted: The provider's average cost per click in US dollars. It is an estimate.

**SEO visibility**
- What it shows: How visible your tracked keywords are in Google.
- How it is counted: Each keyword adds its search volume times the share of clicks its rank usually earns, as a percentage of the most it could earn at rank 1. Keywords beyond depth add nothing. It is an estimate, and it is not comparable with the AI visibility rate.

**Average position (Search Console data)**
- What it shows: The average place of your page for a query in Google, as Search Console reports it.
- How it is counted: Google's own average over the impressions in the period. It is not the rank of a tracked keyword and the two can differ.

### 10.5 Statistics

**Detectable change**
- What it shows: Whether a number moved by more than it normally moves by chance between two periods.
- How it is counted: The app compares the same prompts in both periods and estimates the usual variation. A change is marked detectable when its 95% range does not include zero. A smaller change is marked within normal variation. It says the change is likely real, not that it is large or important.

**Within normal variation**
- What it shows: That the change between two periods is too small to tell apart from chance.
- How it is counted: The 95% range of the change includes zero. It does not mean nothing changed.

**Not enough data (tooltip on a cell)**
- What it shows: That there are answers or checks, but too few to show a number.
- How it is counted: A rate needs at least 4 valid answers. The tooltip names how many there are.

## 11. Change log

| Date | Term | Old | New | Reason |
|---|---|---|---|---|
| 2026-11-16 | all | | first proposal | Created by the glossary research session |
| 2026-11-16 | Group (C1, C3) | Group or Topic open | Group decided | Owner chose Group for keywords and prompts (D1) |
| 2026-11-17 | Overview name (A3) | Navigation item "Overview", page title "AI visibility" | Navigation item and breadcrumb "AI visibility"; page title (h1 and tab title) "AI visibility overview" | Owner decision on the port review: the item names the area it opens, the title says what the page is |
| 2026-11-17 | Card titles (section 10.1) | Preview "Trend over time", "Answer outcomes", "Top and bottom groups", "Headline numbers", "Competitor gap"; catalog "Rates by platform over time", "Mentioned and cited" | The glossary titles everywhere (catalog, card heading, customize toolbar, Add card, aria labels, preview): "Rate by platform over time", "Outcome split by platform", "Strongest and weakest groups", "AI visibility rate (headline)", "Lost to competitor", "Run calendar" | Owner decision on the port review: one title for a card on every surface |
| 2026-11-17 | Compare with (P15) | "vs previous period" and "No comparison" | Adds "vs same period last year" and the words that follow each mode | The real Prompts screen already offers the year back; the glossary now knows the words |
| 2026-11-23 | Compare with (P15), Rate by platform over time, how it is counted | "With Compare on, a dashed vertical line separates the previous 28 days from the current 28 days" for every mode | The same text with the previous period; with "vs same period last year" the last sentence is "With Compare on, a second dashed line shows the same period last year, week for week." | The real card draws last year as a dashed line under the current weeks and has no boundary line for it; the preview does not draw it yet |
| 2026-11-26 | Link map (A11) | | Added as the name of the Internal links tab that draws the whole crawl as one graph | Owner approved the tab and its name on 2026-11-26 |
| 2026-11-26 | Website audit (A12), Issues (A13), Technical and On-page (A14), Issue (U13), Found by (U15) | | Added | Owner decision of 2026-11-26: a navigation group "Website audit" with Issues, Pages and Internal links; spec `docs/superpowers/specs/2026-11-26-issues-page-design.md` |
| 2026-11-26 | Check (U9b), Severity (U14) | | Added as proposals | The words of the Issues mock the owner saw and has not confirmed in words. "Check" gets a second sense, on the Issues page only |
