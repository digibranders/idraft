# App-wide glossary: proposal (Fable)

Scope: visible words only. Code, API and database names (engine, topic, country, taxonomy term, observation, panel)
stay as they are. Sources read: the brief, `en.json` in the port-real worktree, `aiov-info.js`, and
`docs/16-metrics-methodology.md`.

## 1. Principles

(1) One thing has one visible word on every screen, and one word names one thing; where a shared root is unavoidable
(position, visibility, share) the qualifier is part of the label and may not be dropped to save space. (2) Prefer the
word the user already reads in the tools they use daily (Google Search Console says Query and Position, SEO tools say
Keyword and Search volume), and prefer the word already most common in the real app when two candidates are equally
good, because every rename costs tests and user memory. (3) The word must translate: no idiom, no word whose usual
translation means something else (engine becomes "motor", source becomes "spring" or "origin"). (4) Storage and
statistics words (observation, panel, taxonomy, vocabulary, entity, workload) never reach the screen. (5) Every rate
ends in "rate", every part-of-a-whole ends in "share", and a label says what is counted (answers, prompts, citations).
(6) Sentence case everywhere: only product names (ChatGPT, Google AI Overview, Search Console) and the first word of
a label carry a capital.

## 2. Glossary

Column key: **Label** (singular / plural, casing, abbreviation), **Definition**, **Is not**, **Banned**, **Where**,
**Why**, **Translation**.

### 2.1 Where prompts are asked, and Google on the SEO side

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Platform / Platforms. "AI platform" on first use on a page and anywhere SEO and AI appear together. No abbreviation. | An AI product whose answers we collect: ChatGPT, Gemini, Google AI Mode, Google AI Overview. | Not the model version. Not Google Search on the Keywords side. Not our own app (never write "the idraft platform"). | Engine, AI engine, Surface, Product, LLM, Assistant, Chatbot | Filters, columns, settings page "Platforms", setup step, run coverage | Already 403 visible uses against 1 for Engine. "Engine" collides with "search engine" on the Keywords side, and Google AI Overview is not an engine. Peec, Semrush and Ahrefs users read "platform" for this. | Safe: Plattform, plateforme, plataforma. Engine would become Motor or moteur and read as "search engine". |
| Model / Models. Shown as the provider's own string (gpt-5). | The model version that produced one answer, recorded per answer. | Not the platform. One platform changes model over time. | Model version (allowed once in help text as a gloss), LLM, Engine | Prompt inspector, answer detail, change notes ("Model changed on ChatGPT") | Users need to see why answers shifted. It is a property of an answer, never a filter level above platform. | Safe. Keep the provider string untranslated. |
| Google AI Overview / Google AI Overviews. Always with "Google". No "AIO". | Google's AI summary at the top of a search results page. It is a platform in AI visibility and a search feature on a keyword. | Not the page called Overview. Not Google AI Mode. | AI Overview (without Google), AIO, SGE, Overview | Platform lists, Keywords filter and search features, info texts | The bare form collides with the Overview page. The prefix costs 7 characters and removes the collision in every language. | Use Google's official local name with the prefix (German: "Google Übersicht mit KI"). Never translate it as the word used for the Overview page. |
| Google AI Mode. No abbreviation. | Google's separate conversational search product. We ask it prompts. | Not Google AI Overview. Not Gemini. | AI Mode (without Google), Google AI | Platform lists | Product name, kept whole. | Keep as Google names it locally. |
| Search engine / Search engines | The classic search product a keyword position is checked on. Today only Google. | Not a platform. Google AI Overview and Google AI Mode are platforms even though Google runs them. | Engine (alone), Platform, SERP provider | Keywords settings, project settings, help text. The value shown is "Google". | It is the user's own word. It only stays unambiguous if "engine" is never used for AI. | Safe: Suchmaschine, moteur de recherche. |
| Search feature / Search features | A special block on a results page: Google AI Overview, featured snippet, local pack, and so on. | Not a platform, not a metric. | SERP feature (allowed in column headers for SEO users: "SERP features"), Rich result | Keywords filter, keyword detail | "SERP" is known to SEO managers and unknown to their clients. Long form in text, SERP form allowed in dense tables. | SERP stays untranslated in most markets. |

### 2.2 How keywords and prompts are organised

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Group / Groups | A named set of prompts or of keywords. The same word on both sides. | Not a tag. Not a cost grouping. Not a domain type. | Topic, Category, Cluster, Theme, Collection, List, Folder, Term, Segment | Keywords, Prompts, Overview select and cards, schedules | 257 visible uses against 5 for Topic. A user who files both keywords and prompts under "Pricing" should not learn two words. "Topic" also promises a subject, and real groups are often products, services or campaigns. | Safe: Gruppe, groupe, grupo. Topic and Cluster stay English in German and confuse clients. |
| Subgroup / Subgroups | A group inside another group. | Not a second kind of object. It behaves like a group. | Child group, Nested group, Sub-topic, Level | "Add subgroup", "includes subgroups", tree manager | Already in the app, self-explaining. | Untergruppe, sous-groupe. Safe. |
| Primary group | The one required group of a prompt, used so group numbers add up to the total. | Not the only group a prompt may sit in, if more are allowed later. | Main topic, Default group, Home group | Add and edit prompt dialogs, info texts that say "groups add up to the total" | The rule is invisible today and explains why the heat map sums to 100%. Only shown where the rule matters. | Safe. |
| Group row (not a visible label; the pattern name for design and docs) | A table row for a group that opens to show the prompts or keywords inside it. Visible controls: tab "Groups", toggle "By group" and "All prompts" or "All keywords", row action "Show prompts". | Not a separate page. | Accordion, Topic drawer, Parent row | Prompts and Keywords tables | The shape needs a name for specs, not for users. Users only see "Groups". | Nothing to translate. |
| Tag / Tags | A free label on a keyword. A keyword can have many. Tags do not form a tree and are not used for totals. | Not a group. No subtags. | Label, Keyword label | Keywords table, filter, bulk edit | 27 uses already. Users know tags from every other tool. The line is: groups structure reports, tags are for ad hoc filtering. | Tag is a common loanword. Where it is not, use the local word for label. |
| Group set / Group sets | A named family of groups that sorts items by one idea: Topics, Products, Services, Campaigns, Personas, Custom. Replaces "vocabulary". | Not a group. A group set contains groups. | Vocabulary, Taxonomy, Kind, Dimension, Facet | Settings page, renamed "Groups and tags". The "Groups and terms" selector in schedules becomes "Groups". | "Taxonomy", "vocabulary" and "term" are librarian words. The page needs three nouns at most: group set, group, tag. | Safe. "Term" is a false friend in German (Termin means appointment). |
| Group set type | What a group set is about, picked from a fixed list when it is created. Replaces "kind". | Not prompt type. | Kind, Vocabulary kind | Create group set dialog only | Needed in one dialog. Always written in full so it never reads as prompt type. | Safe. |
| Domain type / Domain types | The kind of website a citation points to: your site, competitor, review site, publisher, community, other. | Not a group. Users cannot file prompts under it. | Category, Source type, Source category | Citations cards and filters | Sits next to the Domains tab, so it uses the same noun. "Category" is free for nothing else and should stay unused. | Safe. |

### 2.3 Where

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Location / Locations | The place a keyword is checked from or a prompt is asked from. It can be a country or a city. | Not the language. Not the address of the user's business. | Country (as a label), Region, Market, Geo, Area | Every filter, column, top bar, add dialogs, settings on both sides | One label that is true for countries and cities. "Country" as a label becomes wrong the day a city is added, and it is already wrong on Keywords. | Use the word for "place" or "site of search", not the word for a shop address. German: Standort. French: Zone or Lieu, pick one. |
| Country / City (lower case inside sentences, never a column or filter label) | The two levels a location can have. | Not separate filters. | Nation, Town, Metro | Help text and search placeholder ("Search countries and cities"), and the note "AI answers are collected at country level" | Users need the words to understand the levels, and the app needs one label. | Safe. |
| All locations | The scope value that includes every location of the project. | Not "worldwide". We only cover the locations the project tracks. | All countries, Global, Worldwide, Everywhere | Scope pickers and filters | "Global" claims coverage we do not have. | Safe. |
| Language / Languages | The language a keyword is searched in or a prompt is written in. | Not the location. | Locale | Filters and columns | Listed because Location and Language are confused in imports. | Safe. |
| Device / Devices | Desktop or mobile, for keyword checks. | Not used for prompts. | Platform (never use platform for device) | Keywords | Guards the word Platform. | Safe. |

### 2.4 Units: what we ask and what comes back

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Prompt / Prompts | The text we send to an AI platform, tracked over time. | Not a keyword. Not a fan-out query. | Query, Question (as a label), AI keyword, Search term | AI visibility everywhere | The category word in every competing tool, 404 visible uses. "Question" may appear in a help sentence ("the question we ask") and in the input placeholder, never as a label. | Kept as a loanword in most languages. |
| Keyword / Keywords | A search term whose Google position we track, per location, device and language. | Not a prompt. Not a Search Console query. | Search term, Term, Phrase, Query | SEO side | Standard. | Safe. |
| Query / Queries | A search that real people typed into Google, as reported by Google Search Console. | Not a keyword we track. Not a prompt. Not a fan-out query. | Search term | Performance pages only | It is Google's own label for that column, so users match it to Search Console. | Follow Google's local Search Console wording. |
| Fan-out query / Fan-out queries. Always both words. | A search an AI platform runs by itself while it builds an answer. | Not our prompt. Not a Search Console query. | Query (alone, on AI screens), Sub-query, Related search, Grounding query | Prompt detail, Overview card | "Query fan-out" is Google's published name and the term SEO people search for. The qualifier keeps it apart from Search Console queries. First use on a page carries the gloss "searches the AI runs to build its answer". | No natural equivalent. Keep "fan-out" in English with the gloss translated. |
| Answer / Answers | What one platform returned for one prompt at one location in one run. | Not a run. Not a prompt. | Response, Observation, Result, Output, Reply, Reading | Everywhere on the AI side | Plain word, already the base of "valid answers". | Safe: Antwort, réponse, respuesta. |
| Valid answer / Valid answers | An answer that was collected in full and can be counted. It is the base of every rate. | Not an answer that mentions you. A valid answer may mention nobody. | Good answer, Successful response, Usable answer | Info texts, coverage, tooltips | The denominator needs one fixed name. | "Valid" translates, avoid words that mean "correct". |
| Failed answer / Failed answers | An answer we could not collect or the platform refused. It is left out of every rate. | Not a miss for the brand. | Invalid answer, Error, Collection problem (allowed as the heading of the list) | Runs page, coverage | The opposite of valid needs a name so nobody reads a failure as "not mentioned". | Safe. |
| Run / Runs | One scheduled collection pass: all prompts or keyword checks that a schedule starts together. | Not a single answer or a single check. | Job, Batch, Crawl, Collection, Cycle, Wave | Runs page, calendar, "Run started" | In use and short. Works for both sides. | Needs care: German Durchlauf, French exécution, Spanish ejecución. Do not translate as "race". |
| Check / Checks. Verb allowed: "Check now". | One reading of a keyword's position at one location on one device. | Not a run. Not used for AI answers. | Read, Reading, Lookup, Scan, Crawl, Observation | Keywords (154 uses), "Check now" | The SEO unit, as Answer is the AI unit. "A keyword is read at every location" becomes "is checked at every location". | Safe: Prüfung, vérification. |
| Schedule / Schedules | The rule that says when runs happen and for which prompts or keywords. | Not a run. | Panel, Cadence, Frequency (allowed as a field name inside a schedule), Plan | Schedules page | "Panel" is a survey-statistics word. On screen say "the prompts on this schedule". | Safe. |
| Screenshot / Screenshots | A stored image of an AI answer as the platform showed it. | Not a snapshot. | Capture, Image, Snapshot | Answer detail | Common word. | Loanword in many languages. |
| Snapshot / Snapshots. Full form "Results page snapshot" in headings. | A stored copy of the Google results page from one check. | Not an image of an AI answer. | Screenshot, Archive, Cache, SERP copy | Keyword detail tab | Two stored things, two words, split by side. | Find a word different from the one for screenshot. German: Momentaufnahme. |
| Job type / Job types | A kind of paid collection work in Costs: SEO positions, AI prompts, Search Console sync. Replaces "workload". | Not a group. | Workload, Workload group, Scope and group (becomes "Scope and job type") | Costs and Budgets only | "Workload" means "amount of work" in plain English and translates that way. Budgets used "group" for it, which breaks the Group rule. | Safe. German Arbeitslast for workload would be wrong, which is the reason. |
| Started by | What started a run: Schedule, Manual, Backfill, Retry. Replaces "trigger". | Not the person. | Trigger, Origin, Source | Runs and Costs | Plain words. | Safe. |

### 2.5 Mentions, citations and sites

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Mention / Mentions. Verb: mentions, mentioned. | A brand's name appearing in the text of an answer. | Not a link. A mention needs no link. | Named, Naming, Reference, Appearance, Brand hit | All AI screens | One verb for one event. Today "named" and "mentioned" alternate in the same card. | Safe: Erwähnung, mention, mención. |
| Citation / Citations. Verb: cites, cited. | A page the answer links to or lists as one of its sources. Counted once per page per answer. | Not a mention. Not a quotation of your text. | Link (as a noun for this), Reference, Source, Backlink | All AI screens, page name "Citations" | The industry word, and the base of two metric names. "Link" stays free for internal link tracking on the SEO side. | False friend: French "citation" and German "Zitat" mean a quotation. Use the local word for "source reference" (German Quellenangabe) and test it with a native SEO. |
| Cited domain / Cited page | The website, or the single page, a citation points to. | Not a data source. | Source, Source domain, Reference | Citations tabs "Domains" and "Pages" | Removes the word Source from the AI side, so the nav needs one item, "Citations", with two tabs. | Safe. |
| Source (only in the form "Source: Google Analytics") | The provider a number comes from. | Not a cited website. Not how a keyword was added. | Used for cited sites; used for keyword origin | Footnotes on cards and exports | The word had three meanings. This is the one users expect under a chart. | Safe when used as "data source". |
| Added by | How a keyword entered the project: By hand, CSV import, Search Console, Discovery. Replaces the Keywords filter "Source". | Not the person who added it (that is "Added by user" in the audit log, if ever shown: use "Member" there). | Source, Origin | Keywords filter and column | Frees "source". | Safe. |
| Domain / Domains | A website identified by its registrable name (example.com). | Not a page. | Site and Website as labels (allowed in sentences: "your site") | Citations, competitors, settings | Data label is Domain, prose says "site". | Safe. |
| Page / Pages | One URL. | Not a domain. | URL as a label (allowed for the address field itself), Landing page unless it is one | Citations, Performance, Keywords ("Ranking page") | Clients say "page". | Safe. |
| Link / Links | A hyperlink between pages, as tracked by internal link tracking. | Not a citation. | (none on the SEO side) | Internal links area only | Keeps Link to one meaning. | Safe. |

### 2.6 Measures

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| AI visibility (navigation group, lower case v) | The part of the app about AI answers. | Not a number. | AI Visibility (capital V), GEO, AEO, AI search, LLM tracking | Navigation, breadcrumbs, page titles | Sentence case rule. The area and the metric no longer share an identical label. | Safe. |
| SEO (navigation group) | The part of the app about Google search: keywords, performance, links. | Not a metric. | Search, Organic, Rankings | Navigation | Universal abbreviation. | Not translated. |
| AI visibility rate. Short form in tight columns: "Visibility". | The share of valid answers that mention your brand, cite your site, or both. | Not SEO visibility. Not share of voice. | AI Visibility (as a metric name), Visibility score, Presence, Coverage | Overview headline, tables | Every rate ends in "rate", so the reader knows it is a percentage of answers, and it differs from the nav group. | Safe. |
| SEO visibility | A score of how visible the tracked keywords are in Google, weighted by position (and by search volume where stated). | Not a share of answers. Not comparable with AI visibility rate. | Visibility (alone), Visibility index, Search visibility | SEO overview | Standard SEO term. The prefix is mandatory because the two numbers are built differently. | Safe. |
| Mention rate | The share of valid answers that mention your brand. | Not the count of mentions. | Brand mention rate, Mention frequency, Visibility | AI screens | Matches the doc. | Safe. |
| Citation rate | The share of valid answers that cite at least one page of your domain. | Not citation share. | Source citation rate, Domain citation rate, Link rate | AI screens | Shortest unambiguous form. Two longer names exist today. | See Citation. |
| Citation share | A domain's part of all citations in scope. For your domain it is "Your citation share". | Not citation rate: the base is citations, not answers. | Source share, Share of citations, Link share | Citations page and cards | One measure had two names (Citation share for you, Source share for others). | See Citation. |
| Share of voice. Abbreviation "SOV" allowed in column headers only. | Your part of the brand mentions among you and the tracked competitors. | Not mention rate: it changes when a competitor is added. On the SEO side write "SEO share of voice". | Voice share, Share of mentions, Mention share | Overview, competitors | Marketing users know it. | Often left in English. French "part de voix" is established. |
| Mention position. Card title "Average mention position". Short header "Mention pos.". Never just "Position" on an AI screen. | The order in which your brand is first mentioned in an answer, among tracked brands. 1 is first. | Not a Google position. Not a ranking inside a list. | Position (alone), Rank, AI rank, Mention order, Prominence | Overview, prompt tables | Competing tools call it position, so users look for that word. The qualifier keeps it apart from the SEO number. | Safe with the qualifier. |
| Position. "Best position", "Average position", "Top 3". Verb "rank" allowed in sentences. | Where your page appears in Google's results for a keyword. 1 is the top. | Not mention position. | Rank and Ranking as nouns for the number (allowed: "Rankings" is not used as a page name either), SERP position | Keywords, Performance | Google Search Console says position, and one noun is enough. "Best rank" becomes "Best position". | Safe. |
| Recommendation rate | The share of valid answers that recommend your brand, not only mention it. | Not sentiment. A positive mention is not always a recommendation. | Endorsement rate, Top pick rate | AI screens | Matches the doc. | Safe. |
| Sentiment. Values: Positive, Neutral, Negative, Mixed. | The tone of the text around a mention of your brand. | Not one score. Not a view on the whole answer. | Tone (allowed in the explaining sentence), Sentiment score, Favourability | AI screens | Standard word, always shown as four shares. | German prefers Tonalität or Stimmung. French "sentiment" is fine. |
| Outcome / Outcomes. Values: Mentioned and cited, Mentioned only, Cited only, Neither. | Which of four things happened to your brand in an answer. | Not a rate by itself. The four add up to all valid answers. | Named and linked, Named only, Unlinked mention, Result | Outcome split card, prompt rows | The values now use the two glossary verbs. "Unlinked mention" becomes the filter "Mentioned only". | Safe. |
| Intent. Values: Informational, Navigational, Commercial, Transactional, Local. | What the searcher or asker wants to do. Same word and values for keywords and prompts. | Not funnel stage. | Search intent (allowed once in help), Purpose, Goal | Filters and columns on both sides | Standard SEO term. | Safe. |
| Search volume. Short header "Volume". | Average searches per month for a keyword at a location, as estimated by the data provider. | Not clicks. Not impressions. Not available for prompts. | Vol., Monthly searches (allowed in the info text), Demand, Popularity | Keywords | Standard term. Never shown on a prompt, because no such number exists for prompts. | Safe. |
| Keyword difficulty. Abbreviation "KD" allowed in column headers. | The provider's score from 0 to 100 for how hard it is to reach the first page for a keyword. | Not our own calculation. Not a probability. | Difficulty (alone), Competition, SEO difficulty | Keywords | Standard term. | "KD" is understood by SEO users in most markets. |
| Impressions, Clicks, CPC | As Google Search Console and the data provider define them. | Not AI numbers. | Views, Visits (for clicks) | Performance, Keywords | Keep Google's words. | Follow Google's local wording. |

### 2.7 Brands and tracking states

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Brand / Brands | A company or product name we look for in answers, with its aliases and domains. | Not a domain. Not always a competitor. | Entity, Company, Organisation | Settings page renamed "Brands and aliases", pickers | "Entity" is a database word. Every tracked name is a brand to the user. | Safe: Marke, marque, marca. |
| Your brand. In data labels show the real brand name instead. | The brand this project is about. | Not the agency's brand. | Own brand, Our brand, Own entity, Client brand, Primary brand | Info texts, empty states, legends | "Your" reads naturally and translates. In charts and tables the real name is better, because an agency user's own brand is not the client's. | Formal or informal "your" is a per-language decision, set once. |
| Your site / Your pages | The domains and pages that belong to your brand. | Not every domain in the project. | Own domain, Owned pages, Own pages, Own site | Citations, info texts | Same pattern as Your brand. | Safe. |
| Competitor / Competitors | A brand you compare yourself with. It counts in share of voice. | Not a watched brand. | Rival, Competing entity, Peer | Everywhere | Standard. | Safe. |
| Watched brand / Watched brands | A brand we follow in answers that does not count as a competitor or in share of voice. | Not a competitor. | Watched entity, Watchlist, Monitored | Brands settings, filters | "Watched" already exists. Only the noun changes. | Safe. |
| Tracked | Being collected on a schedule (a keyword, a prompt, a brand). | Not the same as "in the project": a paused item is in the project and not tracked. | Monitored, Active, Followed, Live | States, counts ("Tracked prompts") | One state word for all three objects. | Safe. |
| Not tracked | Seen in the data and not added to the project (a brand found in answers, a query from Search Console). | Not paused. | Untracked, Unknown, Discovered | Brand suggestions, query lists | Two plain words translate better than "untracked". | Safe. |
| Paused | Collection is stopped and can be resumed. History stays and the item stays in lists. | Not archived. | Disabled, Inactive, Stopped, On hold | Projects, schedules, prompts, keywords | In use. | Safe. |
| Archived | Removed from lists and reports, no collection, history kept, can be restored. | Not deleted. Not paused. | Hidden, Removed, Retired | Projects, prompts, keywords | In use. The three-way line is: paused stays visible, archived is hidden, deleted is gone. | Safe. |
| Project / Projects | One brand and its site, with its keywords, prompts, competitors and schedules. | Not a workspace. | Client, Site, Campaign, Property, Account | Everywhere | In use. An agency creates one project per client brand, and "Client" is not a level. | Safe. |
| Workspace / Workspaces | A team's account: its members and its projects. | Not a project. | Organisation, Team, Account, Agency | Sign-in, settings, switcher | In use, 60 or more strings. | Often kept in English. German Arbeitsbereich also works. |

### 2.8 Types, comparison and data states

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Prompt type. Values: Branded, Non-branded. Never "Type" alone. | Whether the prompt text contains your brand name. | Not group set type. Not intent. | Type (alone), Brand filter, Brand prompts | Prompts filter and column | Bare "Type" is the most reused word in any app. | Safe. |
| Branded | A prompt or keyword whose text contains your brand name. Branded prompts are left out of rates by default. | Not "mentions your brand in the answer". | Brand prompt, Navigational | Filters on both sides | Same word and rule for keywords and prompts. | Safe. |
| Non-branded | A prompt or keyword without your brand name in its text. | Not "answer without your brand". | Unbranded, Generic, Organic | Filters | "Unbranded" suggests a product without a logo. | Safe. |
| Period | The date range the numbers cover. | Not a run. | Window, Date range, Timeframe, Interval | Date control, info texts | One word for the time scope. "Window" stays in code and in Costs is replaced too. | Safe. |
| Compare with (control). Value: "Previous period". | Shows the change against the period of equal length just before the chosen one. | Not a comparison with a competitor. | Compare period, Compare to, vs last period, Benchmark | Top bar | A control label starts with a verb. The value names what is compared. | Safe. |
| Detectable change | A change large enough that it is unlikely to be chance. | Not "big" or "important". | Significant, Statistically significant, Real change, Confirmed | Change chips, key changes | "Significant" is read as "important". "Detectable" says only what the test says. | Needs care: German nachweisbare Änderung, French changement détectable. |
| Within normal variation | A change small enough to be the usual movement between runs. | Not "no change". | Not significant, Noise, Stable, Flat | Change chips | Honest and plain. | Safe. |
| Provisional (chip, replaces "interim test") | A change tested with a simpler method because the full one is not possible yet. Treat it with caution. | Not a detectable change. | Interim test, Unpaired, Preliminary test | Change chips | "Interim test" explains the method, not what the user should do. | Safe. |
| Not enough data | There are answers or checks, and too few to show a number. | Not zero. Not "not collected yet". | Insufficient data, Too few valid answers (allowed as the tooltip reason), Low sample | Cells, cards | Plainer, and one label with the reason in the tooltip. | Safe. |
| Not collected yet | No run has happened for this scope yet. | Not a failure. | No data, Pending, Empty, Waiting | Cells, cards, new projects | Tells the user that waiting fixes it. | Safe. |
| n/a (lower case, tooltip "Not available for this platform" or the fitting reason) | The measure cannot exist here, for example fan-out queries on a platform that does not show them. | Not "not enough data". | N/A, Not applicable (as the cell text), a blank cell | Table cells only | Three empty states, three texts. A blank cell is never used. | Use the local short form. Spell out in the tooltip. |
| Sample data (badge) | Invented numbers shown until the real ones exist. | Not an estimate. | Demo data, Mock, Placeholder, Example | Badge on any card that shows them | A badge, so it is seen on the card. It does not belong inside info text. | Safe. |
| Estimate (badge or suffix "est.") | A number supplied by a data provider as an estimate (search volume, CPC, keyword difficulty). | Not sample data. | Approx., Projected | Keywords | Separates "provider guessed" from "we invented for the demo". | Safe. |

### 2.9 Page names

| Label | Definition | Is not | Banned synonyms | Where | Why | Translation |
|---|---|---|---|---|---|---|
| Overview | The first page of an area: "SEO overview" and "AI visibility overview" in titles and breadcrumbs, "Overview" in the nav under its group. | Not Google AI Overview. | Dashboard, Home, Summary | Navigation | The page titles never read "AI Overview", because the group name is "AI visibility". | In German the page is Übersicht and Google's feature is "Übersicht mit KI", so the Google prefix rule matters more there. |
| Citations (page). Tabs: Domains, Pages. | The page about what AI answers cite. | Not two pages. | Sources (as a nav item or page) | AI visibility navigation | Citations and Sources showed the same data from two doors. | See Citation. |
| Prompts, Keywords, Runs, Schedules, Costs, Platforms | Page names equal the plural of their glossary term. | | Rankings, Engines, Topics, Panels | Navigation | A page is named after the thing it lists. | Safe. |

Term count: 85 rows.

## 3. Info ("i") texts

Rules used: "mention" and "cite" are the only two verbs; "valid answers" is the only base; no figure that changes
with the data. Fixed rule numbers (such as the lead rule under Lost to competitor) are part of the definition and stay.
"Sample data until ..." sentences are removed from the texts and shown as the Sample data badge.

**AI visibility rate**
- What it shows: How often AI answers mention your brand or cite your site.
- How it is counted: The share of valid answers that mention your brand, cite a page of your site, or both. It equals
  100% minus the answers that do neither. Each prompt counts equally, however many answers it has. Branded prompts are
  left out unless you include them.

**Mention rate**
- What it shows: How often AI answers mention your brand.
- How it is counted: The share of valid answers whose text contains your brand name or one of its aliases. Each prompt
  counts equally. A citation without the brand name in the text is not a mention.

**Citation rate**
- What it shows: How often AI answers cite your site.
- How it is counted: The share of valid answers that cite at least one page of your domains. Several citations in one
  answer count once. A mention without a citation does not count.

**Share of voice**
- What it shows: How much of the brand talk in answers is about you, compared with your competitors.
- How it is counted: Only answers that mention you or a tracked competitor are used. In each of them the brands
  mentioned share that answer equally, and your share is averaged over those answers. It depends on which competitors
  are tracked: adding one lowers every other share. Watched brands do not count.

**Average mention position**
- What it shows: How early your brand is mentioned in an answer, compared with the other tracked brands.
- How it is counted: In each answer that mentions you, the tracked brands are put in the order of their first mention,
  and 1 means you came first. The value is the average over those answers, so lower is better. Brands you do not track
  are skipped, and answers that do not mention you are left out.

**Recommendation rate**
- What it shows: How often AI answers recommend your brand, not only mention it.
- How it is counted: The share of valid answers in which your brand is suggested as a choice. An answer that does not
  mention you counts as not recommending you. Answers whose recommendation could not be judged are left out.

**Sentiment**
- What it shows: The tone AI uses when it mentions your brand.
- How it is counted: Each mention of your brand is judged positive, neutral, negative or mixed from the text around
  it. The four shares add up to all judged mentions and are never merged into one score. Answers that do not mention
  you are left out.

**Outcome split**
- What it shows: What happens to your brand in the answers: mentioned, cited, both or neither.
- How it is counted: Every valid answer falls into exactly one of four outcomes: mentioned and cited, mentioned only,
  cited only, neither. The four shares add up to 100%. Mentioned only means your brand is in the text and none of your
  pages is cited.

**Citation share by domain**
- What it shows: Which websites AI answers cite most, and how large a part of all citations each one gets.
- How it is counted: A page counts once for each answer that cites it, even if the answer cites it several times.
  Pages are added up by domain, and each domain's share is its part of all citations in scope. Your domains are
  marked.

**Top group by platform heat map** (proposed card title: "Groups by platform")
- What it shows: How each group of prompts performs on each platform.
- How it is counted: Each cell is the chosen rate for the prompts of that group on that platform. Every prompt has one
  primary group, so the groups add up to the total. A hatched cell has too few valid answers and shows no rate.

**Lost to competitor**
- What it shows: The prompts where a competitor is mentioned more often than you, and the prompts where you are
  mentioned more often than them.
- How it is counted: Counted in prompts, over the platforms in scope. A brand leads a prompt when it is mentioned in
  at least 2 more answers than the other and the prompt has at least 4 valid answers. A smaller difference counts as
  equal, because it is mostly chance.

**Search ranking position (SEO)** (label: "Position")
- What it shows: Where your page appears in Google's results for a keyword. 1 is the top result.
- How it is counted: Read from the Google results page at the keyword's location, device and language on each check.
  The best placed page of your domains is used. Ads are not counted. A keyword with no page of yours in the results we
  read shows "Not in results".

**Search volume**
- What it shows: How many times a month people search for this keyword at this location.
- How it is counted: The data provider's estimate of average monthly searches over the latest twelve months, for the
  keyword's location and language. It is an estimate, it is the same for every device, and a keyword the provider does
  not know shows no value, not zero.

**Keyword difficulty**
- What it shows: How hard it is to reach Google's first page for this keyword.
- How it is counted: A score from 0 to 100 supplied by the data provider, where higher is harder. It reflects how
  strong the pages are that rank now. We show the provider's value and do not recalculate it.

**Detectable change**
- What it shows: Whether a number moved more than it normally moves by chance between two periods.
- How it is counted: The change is compared with the usual variation between runs of the same prompts. It is marked
  detectable when its 95% range does not include zero. A smaller change is marked "within normal variation". It says
  the change is likely real, not that it is large or important.

## 4. Choices where I was torn

1. **Platform or Engine.** Pick: Platform. Against: every spec and doc says engine (about 2,100 uses), the code says
   engine, so staff will keep saying it and bugs will be reported in two vocabularies. Also "platform" is what
   software companies call their own product.
2. **Group or Topic for prompts.** Pick: Group on both sides. Against: Peec and Profound say "topic", so a user moving
   from them looks for Topics. And keyword groups allow many per keyword while prompts have one primary group, so the
   same word hides a different rule.
3. **Mention position, Mention order or plain Position.** Pick: Mention position, qualifier mandatory. Against: a
   narrow column will tempt someone to shorten it to "Position", and then the same word means two scales in one app.
   "Mention order" can never be confused, at the price of an unfamiliar name.
4. **Position or Rank on the SEO side.** Pick: Position. Against: the product category is "rank tracking", users say
   "we rank 4th", and "Best rank" is shorter than "Best position".
5. **Location as the only label, or Country where only countries exist.** Pick: Location only. Against: on AI screens
   every value is a country today, and a label "Location" makes users expect cities that cannot be picked.
6. **AI visibility rate or AI Visibility for the headline number.** Pick: AI visibility rate. Against: it is the
   product's headline word, shorter is stronger on a card, and competing tools call it "Visibility" or "Visibility
   score".
7. **Remove "Source" from the AI side.** Pick: Cited domain and Cited page, with one Citations page. Against:
   "sources" is the word ChatGPT and Google themselves show to end users under an answer, so it is the most natural
   word for a client.
8. **Fan-out query or Fan-out search.** Pick: Fan-out query. Against: "query" also names Search Console queries, and
   "search" is plainer for clients. I kept "query" because "query fan-out" is the term users look up.
9. **Keep Overview as the page name.** Pick: keep, and always write "Google AI Overview". Against: one missing
   "Google" anywhere brings the collision back. Renaming the page "Summary" would make the collision impossible.
10. **Brand or Entity in settings.** Pick: Brand. Against: some tracked names are people, events or generic product
    types, and "brand" is a stretch for those.
11. **Job type or Workload.** Pick: Job type. Against: it only appears in Costs, few users see it, and the rename buys
    little for the test changes it needs.
12. **Not enough data or Insufficient data.** Pick: Not enough data. Against: "Insufficient data" is the established
    label in analytics tools and is already in the app.
13. **Group set for vocabulary.** Pick: Group set. Against: it is an invented compound. "Grouping" or keeping
    "Taxonomy" as the page title for expert users are both defensible.
14. **Your brand or Own brand.** Pick: Your brand, with the real brand name in data labels. Against: for an agency
    account manager the brand is the client's, and exported reports read by the client's boss say "your" to the wrong
    person. Real names in exports solve it only where a name fits.

## 5. The five choices that matter most to users

1. **Platform (not Engine).** If the owner picks Engine, the Keywords side can no longer say "search engine" without
   users reading it as an AI product, and Google AI Overview becomes an "engine" that nobody can open.
2. **Group for both keywords and prompts (not Topic on one side).** If Topic is kept for prompts, users who organise
   one client by the same names on both sides must learn two words and two settings pages for one idea.
3. **Mention and Citation as the only two verbs (not named, linked, source, reference).** If the mix stays, users
   cannot tell whether "named and linked" and "mentioned and cited" are different numbers, and support has to explain
   it per card.
4. **Position for Google, Mention position for AI, never bare on AI screens.** If both are called Position or Rank, a
   client reads "position 2" in an AI report as a Google result and reports it upward as an SEO win.
5. **Location as the single label.** If Country and Location both stay, filters set on one screen appear not to carry
   over to the next, and city tracking on keywords looks like a bug in a "Country" column.

## 6. What I think is wrong or missing in the brief

1. **Share of voice has two formulas.** The existing info text says "your mentions divided by all mentions of you and
   the tracked competitors" (a count share). The metrics doc, section 5, defines an equal split inside each answer,
   averaged over answers, and lists the count share as a separate export metric. My info text follows the doc. The
   owner must confirm which one the app computes before the text ships.
2. **Do groups add up or not.** Spec D4 and the heat map text say every prompt has one primary group, so groups sum to
   the total. The metrics doc, section 4, says a prompt in two topics counts in both and values do not sum. "Primary
   group" in the glossary assumes D4 is the rule.
3. **Recommendation rate base.** The doc uses "valid answers where recommendation was classified or brand not
   mentioned", and the preview text says "valid answers". My text follows the doc.
4. **"Lost to competitor" names half of the card.** The card also shows where you lead. A truer title is "You and
   competitors, prompt by prompt" or "Leads and losses". Not decided here because the brief fixes the name.
5. **No name for a failed answer.** "Valid answer" has no visible opposite. I added "Failed answer".
6. **No name for the time scope.** "Window", "period", "28 days" and "date range" all appear. I added "Period".
7. **No name for the level below project home pages.** Two pages are both called Overview. I resolved it with the
   group name in titles, and it deserves an explicit decision.
8. **"Markets" as a group set type** collides with Location in users' minds (a market is usually a country). Rename
   that type "Segments" or drop it.
9. **Budgets "Scope and group"** uses Group for a cost grouping. It is the one place where Group has a second meaning
   in the real app today. It becomes "Scope and job type".
10. **Prompt and keyword groups follow different rules** (one primary group against many groups). The shared word is
    right, and the add dialogs must state the rule, or users will expect keyword group totals to add up.
11. **Missing concepts with no row in the brief:** Device, Language, Estimate (provider numbers against sample data),
    Search feature, "Not in results" (the keyword state for no position found), and Alias (another spelling of a brand
    name, used on the Brands and aliases page).
12. **Referral traffic** is listed as a measure and has no agreed label. Proposed: "AI referral visits", defined as
    sessions that Google Analytics attributes to AI platforms, with the note that Google AI Overview and Google AI
    Mode visits cannot be separated from Google organic.
13. **Structured rank, prominence and first-mention rate** exist in the metrics doc and have no visible names yet.
    When they ship, "rank" must not be used: propose "List position" (place in a numbered list inside an answer),
    "First-mention rate", and no visible name for prominence until it has a user-facing purpose.
14. **Counts for Position and Rank** are missing from the brief's count table, so the cost of choice 4 above is not
    known.
