# Terminology brief: inventory and problem (shared by all proposal agents)

Product (described generically): a web app for SEO teams and agencies that combines two things in one project.
1. SEO: tracked keywords with daily search rankings per country/location, device and language; page performance from
   Google Search Console; internal link tracking; competitor positions.
2. AI visibility: the app asks a set of questions ("prompts") to AI answer products (ChatGPT, Gemini, Google AI Mode,
   Google AI Overview, and more later) on a schedule, stores each answer, and measures how often the user's brand is
   named, how often the brand's website is linked or cited, share of voice against tracked competitors, order of
   mention, sentiment, recommendation, which websites the answers cite, fan-out searches, and trends over time.
Users: SEO managers, agency account managers and their clients. English UI, other languages later (so words must
translate cleanly). House style: plain concrete English, no jargon where a common word works, no em-dashes.

## The problem
The same concept has different visible names on different screens, and the same word sometimes means two things.
The owner wants ONE final glossary: each term, its definition and its info ("i" button) text defined once.
Where a word is used in the code or API (engine, topic, country, taxonomy term) it does not have to match the visible
word; the glossary governs VISIBLE words only. The app keeps all visible words in one message file so a rename is a
text change.

## Conflicts found (real app, design preview, docs)

### C1. What the prompts are asked on
- "Platform" 290+113 visible uses in the real app (Overview, Prompts, Citations, Settings page title "Platforms",
  setup step "Select AI platforms", filter "Platform", column "Platform" in run coverage).
- "Engine": the design preview Prompts mock (select "Engine", filter "Engines", "Engine gap", settings "Engines"),
  specs and docs (about 700 uses in numbered docs, 1400 in AI docs), code identifiers, the Overview "by engine" card
  keys, workload names. The real app had it renamed to Platform on 2026-11-16 (provisional).
- "Search engine": the Keywords side uses Google as the engine (column "Google"). Docs say search engine.
- "Model": a sub-level. An answer records which model version answered (Prompts inspector: "Answer model changed on
  ChatGPT: gpt-4o to gpt-5"). Model is NOT the same as platform.
- "AI Overview" is both a Google SERP feature (Keywords filter "AI Overview", SERP feature) and a platform in the AI
  visibility screens, and "Overview" is also the name of the AI visibility home page and of the SEO project home.
- Platforms in scope: ChatGPT, Gemini, Google AI Mode, Google AI Overview (read from rank checks, not asked).

### C2. How prompts and keywords are organised
- Real app: "Group" on Keywords (a keyword can be in several groups; group names are paths like Services/Audits up to
  10 levels, "Add subgroup", tree manager), on Prompts (column "Group", tab "Groups", "includes subgroups"), on the
  AI Overview (select "Group", cards "by group"), in Budgets ("Scope and group", here the group is a cost workload
  group, a different meaning), in Schedules ("Groups and terms" selector).
- Design preview Prompts mock and the older specs: "Topic" (tab "Topics", column "Topic", "Topic drawer", "Topics and
  prompts"). Preview Overview and Keywords mock: "Group".
- Settings "Taxonomy": vocabularies with kinds Topics, Clusters, Products, Services, Markets, Campaigns, Personas,
  Tags, Custom; each vocabulary has "terms". Keywords and prompts are "filed under" terms. The visible "Group" is the
  topic-kind vocabulary. Separately Keywords has "Tags" (free labels, many per keyword).
- Shape: two levels, a row for the group that opens onto the prompts inside it (accordion). Spec D4: every prompt has
  exactly one required primary group so group values add up to the total; a project may have a flat list or a tree
  (parent and child, up to 3 levels allowed, 2 drawn today). Keywords can be in several groups (not one).
- Other organisers in the code: category (citation source types: own site, competitors, review sites, publishers,
  community), cluster (a taxonomy kind), theme (UI colour theme only), market (taxonomy kind).

### C3. Where
- Real app Keywords: "Country" (add dialog, filter, column, scope picker "All countries") AND "Location" (project
  settings, import, row name "{keyword}, {location}", a filter, "No data at this location"). Location can be a
  country or a city (search placeholder "Search countries and cities").
- Real app Prompts and Overview: top bar "Location: {country}", column "Location", but the add-prompt dialog says
  "Country" and the platform settings say "Countries of ChatGPT". AI answers are collected at country level only today.
- Design preview: "Location" in the top bar and the Prompts mock; "Country" in Keywords and Performance mocks.
- "Region" and "Market" are not used visibly (market is a taxonomy kind).

### C4. Units
- Prompt (the question text we ask the AI product, 250 prompts per project in the mock) vs "Query" (used for the
  fan-out searches the AI product itself runs; also Search Console queries in the Performance mock) vs "Question"
  (used in a few help texts and the prompt placeholder) vs "Keyword" (SEO term, tracked per country, device).
- "Answer" (what a platform returned for a prompt on a day; "valid answers" is the denominator of every rate) vs
  "response" (docs, 4 visible uses) vs "observation" (docs about 560 uses, 6 visible uses in common strings; an
  answer or a rank check as stored) vs "run" (a scheduled collection pass; "Runs" page; "Run started") vs "check"
  (a rank check; 154 visible uses; "Check now") vs "read" ("A keyword is read at every location").
- "Panel": the fixed set of prompts a schedule asks (docs 660 uses, "weekly collection run calendar" in UI); the
  preview Prompts page has "Panels" in code comments.
- "Screenshot" (a stored image of an answer), "Snapshot" (the SERP snapshots tab of a keyword).

### C5. Measures (visible names in the preview and app, defined in the metrics doc)
AI Visibility (rate of valid answers that mention or cite the brand; 100% minus "neither"); Mention rate; Citation
rate ("Source citation rate" in the senior's sheet, "Domain Citation Rate" in docs); Share of voice (SOV in column
headers); Average mention position ("order of brands named in an answer, among tracked brands, 1 is first") vs
Position/Rank on the SEO side ("rank", "position", "Best rank", "Top 3", "Avg position" for Search Console);
Recommendation rate; Sentiment (four shares: positive, neutral, negative, mixed); Citation share; Source share;
Unlinked mention / "named only"; Four outcomes (named and linked, named only, cited only, neither); Fan-out queries;
Referral traffic (GA4 sessions from AI platforms); Volume ("Search volume" in docs), KD ("Keyword difficulty"), CPC,
Intent (informational, navigational, commercial, transactional, local), Funnel stage, Impressions, Clicks.
Statistical words: "detectable change" vs "within normal variation" vs "interim test"; "Insufficient data" vs "too few
valid answers" vs "n/a" vs "not collected yet"; "Compare with" previous period (28 days) ; "Prompt-weighted";
"Branded" prompts (contain the brand name, excluded by default) vs "non-branded".

### C6. People and sites
- Own brand: "Your brand", "Own brand", "own domain", "your site", "owned pages", "Own pages". Competitors vs
  "Watched" entities vs "Entities and aliases" (settings page). Brand vs Entity vs Competitor.
- "Source" means two things: the website an AI answer cites (Citations > "Sources" page, "Source share") and how a
  keyword entered the app (filter "Source: Added by hand, CSV import, Search Console, Discovery").
- Navigation has both "Citations" and "Sources" items; Citations has tabs Domains and Pages; citation "units"
  (distinct URL per answer). "Link", "cited", "citation", "reference", "mention".
- Tracked vs not tracked vs watched vs archived vs paused. "Project" vs "Workspace" vs "Client". Navigation groups:
  "SEO" and "AI Visibility".
- Costs area: "Workload" (a kind of paid job: SEO rank, AI prompts, Search Console sync), "Trigger" (Schedule, Manual,
  Backfill, Retry), "Window", "Tasks", "Budget" with "Scope and group".

## Counts in the real app (visible text, en.json, after removing variables)
Platform 290, Platforms 113; Group 168, Groups 89; Topic 2, Topics 3 (import and taxonomy only); Location 36, Locations
14; Country 22, Countries 16; Prompt 152, Prompts 252; Keyword 109, Keywords 108; Query 15 (all fan-out), Queries 15;
Tags 27; Vocabulary 24; Engine 1. No visible string is hard-coded in the components (all keys); test files that name
the words: Platform 38, Group 44, Prompts 119, Location 13, Country 20; end-to-end files: Group 9, Platform 6.

## Existing info ("i" button) format
Two parts. "What it shows": one sentence definition. "How it is counted": the method and what it leaves out; no
changing numbers inside the text. Example (Share of voice): what: "How much of the brand talk in answers is about you,
compared with your competitors." how: "Your mentions divided by all mentions of you and the tracked competitors. It
depends on which competitors are tracked: adding one lowers every other share."
