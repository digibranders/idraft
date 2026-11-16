# App-wide glossary: proposal (Opus)

Scope: visible words only. Code names (engine, topic, observation, panel, taxonomy term, entity) stay as they are.

## 1. Principles

1. **One thing, one word, on every screen.** If two screens show the same data, they use the same label, the same
   casing and the same verb. A user who learns a word on Overview must find it unchanged on Prompts and Citations.
2. **One word, one meaning.** A word that already carries a meaning in the product (Overview, Source, Group, Position)
   is not reused for a second thing. Where the market forces a clash (Google's "AI Overview"), the clashing word is
   always qualified.
3. **Use the word SEO teams already say.** Rank, keyword, search volume, competitor, share of voice are industry words
   that users type into other tools. Internal words (observation, panel, entity, vocabulary, workload) stay in code.
4. **SEO words and AI words stay apart when the measures differ.** A rank on Google and an order of mention in an AI
   answer are different numbers with different scales; they get different names so nobody compares them.
5. **Words must translate.** No abbreviations that only work in English (SOV, KD, n/a), no idioms, no word that
   needs English capitalisation to mean something different (Overview vs overview).
6. **Sentence case for every label**, except product and platform names (ChatGPT, Google AI Mode) and the two
   navigation group names, which are names of product areas.

## 2. Glossary

Columns: **Label** (singular / plural, casing, abbreviation) · **Definition** · **Not** · **Banned in visible text** ·
**Where** · **Why** · **Translation note**.

### 2.1 What prompts are asked on

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **Platform** / Platforms | An AI answer product the app asks prompts on or reads answers from: ChatGPT, Gemini, Google AI Mode, Google AI Overview. | Not the model version, not a search engine, not a company (Google runs three platforms). | Engine, AI engine, Surface, Product, LLM, Assistant | AI Visibility area, filters, columns, settings page "Platforms", setup step "Choose AI platforms" | Already 400 visible uses; users say "which platforms do you track". "Engine" clashes with "search engine" on the SEO side, and "Product" clashes with the taxonomy type Products. | Translates as "platform" in most European languages (plateforme, Plattform, piattaforma). Safe. |
| **Model** / Models | The model version that produced an answer on a platform, for example gpt-5. Shown as "Model: gpt-5". | Not a platform. One platform changes models over time. | Engine version, LLM | Prompts inspector, answer detail, change log ("Model changed on ChatGPT: gpt-4o to gpt-5") | It is the vendor's own word for the thing. Kept as a sub-level so a model change reads as an event, not as a new platform. | "Model" is a loanword in most languages; fine. |
| **Google AI Overview** (platform name) | Google's AI summary at the top of a results page, treated as a platform. Read from rank checks of keywords, not asked as a prompt. | Not the Overview page. Not Google AI Mode. | AIO, "AI Overview" without "Google" on AI Visibility screens | AI Visibility platform lists, filters, columns | Always carrying "Google" removes the clash with the page name Overview (see 2.10). Google itself uses "AI Overviews"; the singular reads better in a list of platforms. | Keep the English product name untranslated, as Google does in most locales. |
| **AI Overview** (results page feature) | The same Google feature as one of the result types on a keyword's results page. | Not a platform in this context; it is a result type next to Featured snippet. | AIO | Keywords filter "Result type", keyword detail, SERP snapshot | In a list of Google result types "Google" is redundant; every item is Google's. | Same as above. |
| **Google AI Mode** | Google's conversational AI search mode, asked prompts like ChatGPT. | Not Google AI Overview, not Gemini. | AI Mode alone in mixed lists | Platform lists | Google's own name. | Keep untranslated. |
| **Search engine** / Search engines | Where keywords are ranked. Today always Google. Column header "Search engine", value "Google". Hidden when a project has only Google. | Not a platform. | Engine (alone), Platform (on SEO screens) | Keywords, keyword detail, add-keyword dialog | Users say "search engine". Showing a column titled "Google" mixes a header with a value. | "Moteur de recherche", "Suchmaschine": natural everywhere. |

### 2.2 How keywords and prompts are organised

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **Group** / Groups | A named set of keywords or prompts, used to filter, report and roll up numbers. A row for the group opens onto the items in it. | Not a tag. Not a cost group in Budgets (see "Job type"). | Topic, Cluster, Category, Theme, Collection, List, Folder | Keywords, Prompts, Overview cards "by group", Schedules, Reports | 260 visible uses already; plain; works for both keywords and prompts, so a user who groups keywords "Services/Audits" can mirror it for prompts. "Topic" suggests meaning, but users put campaigns and clients in groups too. | "Groupe", "Gruppe", "grupo": safe. |
| **Subgroup** / Subgroups | A group inside another group. Shown as a path "Services / Audits". | Not a tag. | Child group, Subtopic, Nested group | Group manager, "Add subgroup", "includes subgroups" | Self-explaining from Group. | Compounds well (sous-groupe, Untergruppe). |
| Group rule difference | Keywords may be in several groups. Each prompt has exactly one group, so prompt groups add up to the total. | | | Shown as one helper line in the prompt group picker: "A prompt is in one group, so group numbers add up to the total." | Same word, different rule: the rule is stated where it bites instead of inventing a second word. | |
| **Tag** / Tags | A free label on a keyword or prompt. An item can have many tags. Tags do not add up to a total. | Not a group: no tree, no roll-up guarantee. | Label (for this), Keyword tag | Keyword rows, filters, bulk edit | Users know tags from every tool. Kept apart from Group because the counting rule differs. | "Tag" is a loanword in German and Dutch; French uses "étiquette". Fine. |
| **Labels** (settings page) | The settings page where the project's label sets are managed. Replaces "Taxonomy". | | Taxonomy, Vocabulary, Classification | Settings navigation | "Taxonomy" is a librarian's word. "Labels" says what you do there. | "Libellés", "Etiketten": fine. |
| **Label set** / Label sets | One named list of labels, for example Products, Personas, Campaigns, Markets. Groups and Tags are two built-in label sets. | Not a group itself. | Vocabulary, Dimension, Facet | Labels page | Says what it is. The two built-ins keep their own names everywhere else. | Two plain words; translates literally. |
| **Label** / Labels | One value in a label set, for example "Enterprise" in Personas. Keywords and prompts are "labelled" with it. | | Term, Value, "filed under" | Labels page, filters "Persona: Enterprise" | "Term" means "keyword" to SEO users; a clash. | Fine. |
| **Type** (of a label set) | What a label set is for: Group, Tag, Product, Service, Market, Campaign, Persona, Custom. | Not "prompt type". | Kind | Labels page, one select | "Kind" is unusual in UI English; "Type" is plain. | Fine. |
| **Category** (of a cited website) | What kind of website a citation goes to: Your site, Competitor, Review site, Publisher, Community, Other. | Not a group. | Domain type, Source type, Role | Citations, Overview card "Citation share by category" | Only organiser that is set by the app, not the user, so it gets its own word. | "Catégorie": safe. |
| Theme | Only the light or dark colour setting. | Never an organiser. | | User menu | | |

### 2.3 Where

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **Location** / Locations | Where a keyword is ranked or a prompt is asked: a country or a city. | Not a market, not a language. | Region, Market, Geo, Country (as a field name) | Every field, column, filter and picker on both sides; top bar "Location: Germany" | A location can be a city on the SEO side; one field name for both sides lets one filter work across the project. | "Emplacement" in French sounds like a seat; use "lieu" or "zone" in French. Flag for the translator. |
| **Country** / Countries | Used only as a value level, never as a field name: "Country level", search placeholder "Search countries and cities". | | | Location picker, helper "AI answers are collected at country level" | Lets the picker say what level a value is without renaming the field. | Fine. |
| **City** / Cities | A location below country, for local rankings. | | Town, Metro | Location picker | | Fine. |
| **All locations** | Scope that includes every location of the project. | | All countries, Worldwide, Global | Scope pickers, top bar | Matches the field name. "Worldwide" suggests a separate global location. | Fine. |
| Market | Only as the name of a built-in label set type. | Never a place field. | | Labels page | Agencies use "market" for business segments too, so it stays a label. | |

### 2.4 Units of work and data

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **Prompt** / Prompts | A question the app asks AI platforms on a schedule. | Not a keyword, not a fan-out search. | Query, Question (as a label), Search | AI Visibility area | Industry word (Peec, Profound, Semrush AI all say prompt). "Question" may appear in placeholder help ("Write it as a customer would ask it"). | "Prompt" is a loanword in German and French tech usage; safe. |
| **Keyword** / Keywords | A search term tracked for its Google rank per location, device and language. | Not a prompt. | Term, Query (for tracked keywords) | SEO area | Industry word. | Fine. |
| **Fan-out search** / Fan-out searches | A web search a platform runs by itself while building an answer. Only ChatGPT shows them today. | Not a prompt, not a Search Console query. | Fan-out query, Sub-query, Query (alone) | Overview card, prompt detail | "Query" is kept for Search Console. "Search" says what happened in plain words. | "Fan-out" will not translate; translators should render "searches the platform runs itself". Flag. |
| **Query** / Queries | A search term from Google Search Console. | Not a tracked keyword. | | Page performance only | Google's own word in Search Console, which users read daily. | Fine. |
| **Answer** / Answers | What one platform returned to one prompt, in one location, on one day. | Not a run. | Response, Observation, Result, Reply | Every AI screen and info text | Plain and already the denominator word of every rate. | Fine. |
| **Valid answer** / Valid answers | An answer that came back complete and could be read. Every AI rate is out of valid answers. | A failed answer is not a miss for the brand. | Usable answer, Good answer | Info texts, counts, tooltips | Short; says what counts. | "Valid" is a false friend in some languages only mildly; translate as "usable". |
| **Failed answer** / Failed answers | An answer the app tried to collect and did not get. Counted as a collection problem. | Not "Neither". | Error, Missing answer | Runs, calendar, tooltips | Gives the excluded part of the denominator a name (missing today). | Fine. |
| **Run** / Runs | One collection pass that asks a set of prompts (or checks a set of keywords) at a set time. Page "Runs". | Not a single answer or check. | Job, Batch, Collection (as a noun) | Runs page, calendar, "Run started" | Already the page name. | "Exécution", "Durchlauf". Fine. |
| **Check** / Checks | One rank reading of one keyword in one location and device. "Check now" starts one. | Not an answer. | Read, Observation, Scan, Lookup | Keywords, keyword detail, Costs | 150 visible uses; SEO tools say "check". | Fine. |
| **Schedule** / Schedules | When prompts or keywords are asked or checked, and which ones. | | Panel, Cadence, Calendar (as the noun for this) | Settings, run calendar heading "Run calendar" | "Panel" is a survey term users do not know. | Fine. |
| **Screenshot** / Screenshots | A stored image of an AI answer as the platform showed it. | Not a results page snapshot. | Capture, Image | Answer detail | Plain. | Fine. |
| **Results page snapshot** / snapshots | The stored Google results page of a keyword check. Tab "Results pages". | Not a screenshot of an AI answer. | SERP snapshot, Snapshot (alone) | Keyword detail | "SERP" is jargon to clients; "snapshot" alone is vague. | Fine. |

### 2.5 Brands and sites

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **Your brand** | The brand this project is for. In settings, its record is labelled "Your brand". | | Own brand, Own domain, Our brand, Client brand | Everywhere | Direct address, warm and short. | Translators use the polite or familiar "your" per locale house style. |
| **Your site** | The website or websites of your brand. | | Own site, Own domain, Owned pages | Citations, outcome texts | Same pattern as Your brand. | Fine. |
| **Your pages** | Pages on your site. Card "Your pages cited". | | Owned pages, Own pages | Citations | Same pattern. | Fine. |
| **Brand** / Brands | Any company or product name the app looks for in answers: your brand, competitors, watched brands. Settings page "Brands and names". | | Entity, Organisation | Settings, filters | "Entity" is a data model word. | Fine. |
| **Competitor** / Competitors | A brand you compete with, counted in share of voice and comparisons. | | Rival, Peer | Competitors page, cards | Industry word. | Fine. |
| **Watched brand** / Watched brands | A brand followed in answers without counting as a competitor (no share of voice). | Not a competitor. | Watched entity, Tracked entity | Brands and names, filters | Keeps "watched" but drops "entity". | "Observed" in some languages; fine. |
| **Other names** | Other spellings of a brand that count as a mention. | | Aliases, Variants, Synonyms | Brands and names | "Alias" is technical. | Fine. |
| **Workspace** | Your team's account: people, billing, projects. | | Account, Organisation, Agency, Team (as noun for this) | Workspace settings, invitations | Already used 50+ times. | Fine. |
| **Project** / Projects | One brand and site you track, with its keywords and prompts. | Not a client. | Site, Property, Client | Everywhere | Already used. | Fine. |
| Client | Not a product term. Allowed only in example text ("Typical for a client"). | | | Role help text, placeholders | Agencies call projects clients, but in-house teams do not. | |

### 2.6 What is counted

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **Mention** / Mentions; verb **mention** | Your brand's name appears in an answer. | Not a citation. | Named (as a label), Reference, Brand hit | Every AI screen | Industry word, and the metric name "Mention rate" already uses it. One verb for labels and prose. | Fine. |
| **Citation** / Citations; verb **cite** | An answer links to a page. One citation = one page in one answer, however often it repeats. | Not a mention. | Link (as the counted thing), Reference, Source citation | Citations page, metrics | Matches the platforms' own UI ("Sources" in ChatGPT shows citations) and the metric "Citation rate". "Link" is allowed in prose to explain: "links to a page". | "Citation" is a false friend in French (also "quote"). Translator note: "a link to a source". |
| **Cited website** / Cited websites, short **Source** | A website (domain) that answers cite. Tab "Domains" on the Citations page is renamed "Websites". | Not how a keyword was added. | Domain (as tab name), Reference | Citations, competitor drawer | Clients know "website"; "domain" is fine as the column value. | Fine. |
| **Added from** | How a keyword entered the project: By hand, CSV import, Search Console, Discovery. | Not a cited source. | Source (for this) | Keywords filter and column | Frees "Source" for cited websites. | Fine. |
| **Intent** | Why someone searches or asks: Informational, Navigational, Commercial, Transactional, Local. | | Search intent (fine in help), Purpose | Keywords, Prompts | Industry word. | Fine. |
| **Funnel stage** | Where the searcher is in buying: Awareness, Consideration, Decision. | Not intent. | Stage alone | Prompts | | Fine. |
| **Branded** / **Non-branded** | A prompt that contains your brand's name, or one that does not. Branded prompts are left out of AI numbers by default. | | Brand prompt, Navigational | Prompts filter, scope chip "Non-branded only" | Industry words. | Translators may need "with the brand name". |
| **Tracked** | Being counted: a keyword or prompt that is checked or asked on its schedule; a competitor that is counted. | | Active, Monitored | Everywhere | | Fine. |
| **Paused** | Tracked item or project whose checks and runs are stopped and can resume. History stays. | Not archived. | Inactive, Stopped, Disabled | Projects, schedules, items | | Fine. |
| **Archived** | Removed from views and counts, history kept, can be restored. | Not deleted, not paused. | Hidden, Deleted | Projects, keywords, prompts | | Fine. |
| Not tracked | A brand found in answers that is not a competitor or watched brand. | | Untracked entity, Candidate | Brands found in answers | | Fine. |

### 2.7 Measures

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **AI visibility** | Share of valid answers that mention or cite your brand. | Not SEO visibility. | Visibility score, AIV | AI Overview page headline, Prompts, Reports | Name of the product area and its headline number. | Fine. |
| **SEO visibility** | Search-volume-weighted estimate of the clicks your keyword ranks would earn. | Not AI visibility. | Visibility (alone on SEO screens) | SEO Overview | Always prefixed so the two never sit unlabelled side by side. | Fine. |
| **Mention rate** | Share of valid answers that mention your brand. | | Brand mention rate | AI screens | | Fine. |
| **Citation rate** | Share of valid answers that cite a page of your site. | Not citation share. | Domain citation rate, Source citation rate | AI screens | Shorter; pairs with Mention rate. | Fine. |
| **Share of voice** | Your share of mentions among you and your competitors. | Not citation share. | SOV, Voice share | AI and SEO (SEO version labelled "SEO share of voice") | Industry term; abbreviation does not translate. | Translators keep a phrase ("part de voix" exists). |
| **Citation share** | A website's share of all citations in scope. | Not citation rate. | Source share, Domain share | Citations, Overview | One name for the same formula, whether the website is yours or not. | Fine. |
| **Mention position** (card "Average mention position") | Where your brand comes in the order of tracked brands mentioned in an answer. 1 is first. | Not a Google rank. | Rank, Position (alone), AI rank | AI screens | Keeps "rank" for Google. | Fine. |
| **Rank** / Ranks | Your page's place in Google results for a keyword. "Best rank", "Top 3", "Average rank". | Not a mention position, not Search Console position. | Position (on tracked keywords) | Keywords, SEO Overview | Rank-tracker word. | Fine. |
| **Average position** | Google Search Console's own average place. | Not a tracked rank. | Avg rank | Page performance | Google's label; users compare it with Search Console. | Fine. |
| **Recommendation rate** | Share of valid answers that recommend your brand. | Not mention rate. | Endorsement | AI screens | | Fine. |
| **Sentiment** | The tone of answers that mention your brand, as four shares: Positive, Neutral, Negative, Mixed. | Never one score. | Tone (as label; fine in prose), Score | AI screens | Industry word. | Fine. |
| **Outcome** / Outcomes; card "Outcome split" | The four things that happen to your brand in one answer: Mentioned and cited, Mentioned only, Cited only, Neither. | | Named and linked, Named only, Unlinked mention | Overview card, filters | Same verbs as the metric names, so the split visibly adds up to the rates. | Fine. |
| **Search volume**, short **Volume** in column headers | Average monthly Google searches, provider estimate. | | SV, Searches | Keywords | Short form is a real word. | Fine. |
| **Keyword difficulty**, short **Difficulty** in column headers | How hard a keyword is to rank for, 0 to 100, provider estimate. | | KD | Keywords | "KD" is not understood by clients and does not translate. | Fine. |
| **CPC** | Average cost per click advertisers pay. | | | Keywords | The one abbreviation kept: Google Ads itself uses it in every language. | Keep. |
| **Referral visits** | Visits to your site from AI platforms, from Google Analytics. | | Referral traffic, Sessions | Overview card | "Visits" is plainer than sessions. | Fine. |

### 2.8 Time, comparison and data states

| Label | Definition | Not | Banned | Where | Why | Translation note |
|---|---|---|---|---|---|---|
| **Compare with** (control) / **Previous period** | Shows the previous period of equal length next to the current one. | | Compare period, Benchmark, Baseline | Top bar | | Fine. |
| **Clear change** | A change larger than normal week-to-week variation. | | Detectable change, Significant, Statistically significant | Deltas, Key changes | "Detectable" is statistics jargon; "significant" means "important" to clients. | Fine. |
| **Within normal variation** | A change too small to tell from noise. | Not "no change". | Not significant, Noise | Delta tooltips | Says what it means. | Fine. |
| **Early estimate** | A comparison made with a quick method that may understate uncertainty. | | Interim test | Delta tooltips | Plain. | Fine. |
| **Not enough data** | Too few valid answers (or checks) to show a number. Tooltip gives the count and the minimum. | Not zero. | Insufficient data, Too few valid answers, n/a, N/A, "-" alone | Every cell and card | One phrase everywhere; n/a does not translate. | Fine. |
| **Not collected yet** | The data has never been collected for this item. | Not "Not enough data". | Pending, No data yet | Cells, cards | Different cause, different fix. | Fine. |
| **Sample data** | Demonstration numbers shown until the real feature or connection exists. | | Demo, Placeholder, Mock | Badges on cards | | Fine. |
| **Job type** | A kind of paid work in Costs: Rank checks, AI prompts, Search Console sync. | Not a group. | Workload | Costs, Budgets "Scope and job type" | Removes the second meaning of "group". | Fine. |
| **Started by** | What started a run: Schedule, Manual, Backfill, Retry. | | Trigger | Runs, Costs | Plain. | Fine. |

### 2.9 Page and navigation names

| Label | Definition | Why |
|---|---|---|
| Navigation groups **SEO** and **AI Visibility** | The two product areas. | Area names; title case allowed (principle 6). |
| **Overview** (nav item in both groups) | Home page of each area. Page title and breadcrumb: "SEO: Overview", "AI Visibility: Overview" (the existing `{group}: {item}` pattern). | Users expect "Overview" as a home. The clash with Google AI Overview is solved on the feature side: the feature always carries "Google" on AI screens. |
| **Citations** | One page for everything cited: tabs Websites and Pages. | "Citations" and "Sources" as two nav items show the same data twice. Fold the Sources page into Citations. |
| **Brands and names** (settings) | Replaces "Entities and aliases". | Plain words. |
| **Labels** (settings) | Replaces "Taxonomy". | See 2.2. |

Term count: 84 rows across sections 2.1 to 2.9 (one is a rule note, "Group rule difference", not a term).

## 3. Info ("i") texts

**AI visibility**
- What it shows: How often AI answers mention or cite your brand.
- How it is counted: The share of valid answers that mention your brand, cite a page of your site, or both. It equals 100% minus the answers that do neither. Each prompt counts once, however many answers it has. Branded prompts are left out unless you include them.

**Mention rate**
- What it shows: How often AI answers mention your brand.
- How it is counted: The share of valid answers that mention your brand by name or by one of its other names. Each prompt counts once. Failed answers are left out.

**Citation rate**
- What it shows: How often AI answers cite a page of your site.
- How it is counted: The share of valid answers with at least one citation to your site. A mention without a link does not count. Each prompt counts once.

**Share of voice**
- What it shows: How much of the brand talk in answers is about you, compared with your competitors.
- How it is counted: In each answer that mentions at least one tracked brand, the mentioned brands share that answer equally. The shares are then averaged over those answers, so all tracked brands add up to 100%. Watched brands are not counted. Adding a competitor lowers every other share.

**Average mention position**
- What it shows: How early your brand is mentioned in an answer.
- How it is counted: The order of your brand's first mention among the tracked brands in the answer, averaged over the answers that mention you. 1 means mentioned first, and lower is better. It is not a Google rank.

**Recommendation rate**
- What it shows: How often AI answers recommend your brand.
- How it is counted: The share of valid answers that recommend your brand. An answer that does not mention your brand counts as not recommending it. Each prompt counts once.

**Sentiment**
- What it shows: The tone AI answers use when they mention your brand.
- How it is counted: Each mention is classed as positive, neutral, negative or mixed. The card shows the four shares of the classed mentions and never one score. Answers that do not mention your brand are left out.

**Outcome split**
- What it shows: What happens to your brand in each answer.
- How it is counted: Each valid answer is mentioned and cited, mentioned only, cited only, or neither. The four shares add up to 100% of valid answers. Mentioned only means your brand is named and none of your pages is cited.

**Citation share by website**
- What it shows: Which websites AI answers cite, and how much of all citations each one gets.
- How it is counted: A page counts once in each answer that cites it, however often the link repeats. Each website's share is its citations divided by all citations in scope. Websites are grouped by category: your site, competitors, review sites, publishers, community and other.

**Top group by platform** (heat map)
- What it shows: How each group of prompts does on each platform.
- How it is counted: Each cell is the chosen measure for the group's prompts on that platform. Every prompt is in one group, so the groups add up to the total. A hatched cell has too few valid answers to show a rate.

**Lost to competitor**
- What it shows: The prompts where a competitor is mentioned more often than you, and the prompts where you lead.
- How it is counted: Counted in prompts, over the platforms in scope. A brand leads a prompt when it is mentioned in clearly more answers than the other; a smaller gap counts as equal. Prompts with too few valid answers are left out.

**Rank** (SEO)
- What it shows: Where your page appears in Google results for this keyword.
- How it is counted: The place of your highest page among the results on the checked page, counting from the top. 1 is first. Only checks in this location, device and language count. Not ranked means your site was not found in the results checked.

**Search volume**
- What it shows: How many times a month people search Google for this keyword.
- How it is counted: The provider's average monthly searches over the last twelve months, for this location and language. It is an estimate, and it is the same for every project that tracks the keyword.

**Keyword difficulty**
- What it shows: How hard it is to reach the top results for this keyword.
- How it is counted: A score from 0 to 100 from the data provider, based on the strength of the pages that rank now. Higher is harder. The app does not recalculate it.

**Clear change**
- What it shows: Whether a change between two periods is larger than normal week-to-week variation.
- How it is counted: The app compares the same prompts in both periods and estimates how much the number moves by chance. A change is clear only when it is outside that range. Otherwise it is marked within normal variation, even if the arrow points up or down.

Note: the thresholds now written as numbers in the preview texts ("at least 4 valid answers", "2 more answers") are fixed rules, not changing data, so they may stay. I wrote "too few" and "clearly more" above so the text stays true if the rule changes; the tooltip on a hatched cell gives the exact count. The owner can put the fixed numbers back if he prefers precision.

## 4. Choices where I was torn

1. **Platform vs Engine.** Pick: Platform. Against: every spec and the code say engine, so writers will keep typing it, and "AI engine" is used by some competitors.
2. **Page name Overview vs a new name ("Summary", "Dashboard") for the AI home.** Pick: keep Overview, qualify the Google feature. Against: "Google AI Overview" on the Overview page still sits close; a new user may search for the feature under the page.
3. **Group vs Topic for prompts.** Pick: Group. Against: "Topic" describes prompts better and the specs use it; a group of prompts about one subject is a topic in users' heads.
4. **One word for keyword groups and prompt groups despite different rules** (many groups vs exactly one). Pick: same word, rule stated in the picker. Against: a user who learns "a keyword can be in several groups" will assume the same for prompts and be surprised the picker allows one.
5. **Taxonomy rename to Labels / Label set / Label.** Pick: rename. Against: "label" is close to "tag", and a power user may not see why Tags are a label set yet appear separately.
6. **Mention / cite vs named / linked.** Pick: mention and cite everywhere, prose too. Against: "named" and "linked" are plainer for clients, and the preview texts already use them.
7. **Fan-out search vs fan-out query.** Pick: search. Against: the industry (Google's own docs) says "query fan-out", and current strings say query.
8. **Results page snapshot vs SERP snapshot.** Pick: Results page. Against: every SEO user knows SERP, and it is shorter in a tab.
9. **Clear change vs detectable change.** Pick: Clear change. Against: "clear" can sound like a judgment of importance; "detectable" is more honest about what the test says.
10. **Location as field name everywhere vs Country on the AI side** (AI is country only). Pick: Location. Against: on the AI side every value is a country, so "Location" is vaguer than it needs to be.
11. **Rank vs Position for tracked keywords.** Pick: Rank. Against: Search Console and Google say position, and users copy numbers between the two.
12. **Fold Sources into Citations.** Pick: fold. Against: if the Sources page has a different job (source gaps, outreach targets), folding hides it; then name it for the job ("Citation gaps"), not "Sources".
13. **Sentence case "AI visibility" for the measure vs "AI Visibility" for the area.** Pick: area title case, measure sentence case. Against: two casings of the same two words on one screen look like a mistake.

## 5. The five choices that matter most

1. **Mention position vs Rank.** Risk if the other: users compare an AI "rank 2" with a Google "rank 2" and draw wrong conclusions in client reports.
2. **Platform (not Engine) on all AI screens, Search engine on SEO.** Risk if the other: "engine" means Google on one tab and ChatGPT on the next, and every filter needs a second look.
3. **Group as the one organiser word for keywords and prompts, Tag kept separate.** Risk if the other: "Topic" on prompts and "Group" on keywords means two settings pages and no shared reporting language for agencies.
4. **"Not enough data" and "Not collected yet" as the only two empty states.** Risk if the other: n/a, insufficient data and blank cells keep reading as zero, which is the misread that loses client trust.
5. **Source means a cited website only; keyword origin is "Added from".** Risk if the other: a filter "Source: Search Console" on Keywords and "Sources" in Citations keep users guessing which source is meant.

## 6. What the brief gets wrong or leaves out

- **No name for a failed answer.** Every rate excludes it, but users only see "valid answers". Added "Failed answer".
- **No name for the AI Overview denominator.** Google AI Overview rates count only checks where an AI Overview showed; the share of checks that showed one needs a visible name. Proposal: "AI Overview shown" (as a rate: "Shown in" with the help "Share of checks where Google showed an AI Overview").
- **No visible name for a method or competitor-set change.** Share of voice breaks when a competitor is added; the chart needs a marker. Proposal: "Counting changed" marker with the date and reason.
- **"Budgets: Scope and group"** is a third meaning of group, listed in C2 but not in the terms to settle. Renamed to "Job type".
- **"Prompt-weighted" is visible** in the competitor drawer. It should not be: say "Each prompt counts once".
- **"Panel" leaks into one info text** ("schedule of their panel"); replace with "their schedule".
- **Discover and Matrix** nav items are not in the brief; their visible names should be checked against this list (Matrix in particular is not a plain word).
- **Language** is not listed as a term, yet keyword and prompt scope includes it. It needs one label ("Language") and must never be folded into Location.
- **Device** (Desktop, Mobile) is missing from the brief; it is part of every keyword row name.
- **The brief says the Overview AI card counts topics with a prompt in two topics counting twice** (doc 16 section 4 breakdown table), while spec D4 says one primary group. Doc 16 must be updated to D4, or the heat map info text is false.
