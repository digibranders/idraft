# How SEO and AI-visibility tools name the same concepts

Research date: 2026-11-16. Method: WebSearch and WebFetch on public pages only (help centres, docs, feature pages, glossaries, blogs). No private project data was sent anywhere.

How to read this file:

- "Label" means the exact word the tool shows in its UI or docs, copied from a page I fetched.
- Short quotes are marked with quotation marks and carry the page URL. I kept to one short quote per tool and concept.
- "unverified" means the fact comes from memory, a search-result snippet, or a third-party page, not from the tool's own page.
- "not found" means I fetched the likely pages and the term did not appear. It does not prove the tool lacks the feature.
- Some pages are summarised by the fetch tool, not read in full. Treat exact label spelling as high confidence for short labels and medium confidence for definitions.

## 0. What was verified

Reached the tool's own help, docs or product pages and read them (14 tools):

| Tool | Main pages read |
|---|---|
| Profound | docs.tryprofound.com/getting-started/glossary ; docs.tryprofound.com/answer-engine-insights/about |
| Peec AI | docs.peec.ai/understanding-your-performance ; docs.peec.ai/setting-up-your-prompts ; docs.peec.ai/brand-insights ; docs.peec.ai/sidebar-navigation ; help.peec.ai tags article |
| Otterly.AI | help.otterly.ai/search-prompt-monitoring ; /insights-on-brand-reports ; /prompt-detail-analysis ; /add-prompts ; /how-otterlyai-collects-data |
| Semrush AI Visibility Toolkit | semrush.com/kb/1493-ai-visibility-toolkit ; /kb/1503-prompt-tracking ; /kb/1594-ai-seo-metrics |
| Semrush Position Tracking | semrush.com/kb/549-position-tracking-overview |
| Ahrefs Brand Radar | help.ahrefs.com/en/articles/15501968-ai-visibility-metrics ; ahrefs.com/academy/how-to-use-brand-radar/custom-prompts and /cited-domains |
| Ahrefs Rank Tracker | ahrefs.com/academy/how-to-use-ahrefs/rank-tracker/overview |
| AthenaHQ | docs.athenahq.ai/setting-up-prompts ; /guides/olympus ; /guides/sources |
| Scrunch | helpcenter.scrunchai.com glossary (article 11635909) and quick start (article 11696681) |
| Rankscale | rankscale.ai/resources/modules/diagnose/the-7-core-metrics and /how-to-read-your-rankscale-dashboard ; help.rankscale.ai finding-search-terms |
| SE Ranking (SE Visible) | visible.seranking.com/blog/how-se-visible-works/ |
| Sistrix | sistrix.com/ai ; /ai/prompt-monitoring ; /ai/prompt-research ; sistrix.com/?p=175568 (prompt tracker terms) ; sistrix.com/?p=177786 (AI Search Overview) |
| Google Search Console | support.google.com/webmasters/answer/7042828 and /answer/7576553 |
| Google Analytics 4 | support.google.com/analytics/answer/9143382 and /answer/9756891 |

Partly verified (vendor blog or marketing page only, or a secondary source; moz.com blocked the fetch tool) (5 tools):

| Tool | What I could read |
|---|---|
| Goodie | higoodie.com home page and one blog post. No help centre found. |
| Writesonic | One Writesonic blog guide (writesonic.com/blog/ai-brand-visibility-audit) and search snippets. No help centre found. |
| Moz Pro AI Visibility | Search-result snippets quoting moz.com/help/ai-research/ai-visibility, plus a sponsored article on thenextweb.com. |
| Similarweb AI Brand Visibility | Two Similarweb blog posts (aisearch.similarweb.com). No help centre found. |
| SE Ranking Rank Tracker | Search snippets from help.seranking.com and seranking.com blog. The Overview help page returned HTTP 403. |

Not covered: Sistrix classic Toolbox pages (only secondary German sources surfaced), Reddit, LinkedIn and Hacker News (see section 11).

## 1. What the prompts are asked on (platform, engine, model)

| Tool | Label for the AI product | Notes and page |
|---|---|---|
| Profound | "Platform" (also called a model); category word "answer engine" | The glossary defines Platform as an answer engine and says it is also called a model. A "Platforms" tab splits metrics by platform. docs.tryprofound.com/getting-started/glossary |
| Peec AI | Filter is "Models"; prose says "AI platforms" | Overview filters are "Models, Country, and Topics". docs.peec.ai/understanding-your-performance. A KPI is named "Strongest/Weakest model". docs.peec.ai/brand-insights |
| Otterly.AI | "AI engines", "AI search engines" | "engine-by-engine detail" and a filter by engine. help.otterly.ai/search-prompt-monitoring and /prompt-detail-analysis |
| Semrush AI Visibility Toolkit | "Search engine" (campaign setting) with ChatGPT Search, Google AI Mode, Gemini as values; KB overview prose says "platforms" | semrush.com/kb/1503-prompt-tracking ; semrush.com/kb/1493-ai-visibility-toolkit |
| Semrush Position Tracking | "search engine" (Google, Bing, Baidu or ChatGPT) | Campaign settings, gear icon. semrush.com/kb/549-position-tracking-overview |
| Ahrefs Brand Radar | "AI tool" in the custom prompts guide; "platforms" in the cited domains guide; API says "data source" | A "check" is one prompt times one AI tool times one location. ahrefs.com/academy/how-to-use-brand-radar/custom-prompts |
| Ahrefs Rank Tracker | Not applicable (Google search). Devices are "mobile" and "desktop" tabs | ahrefs.com/academy/how-to-use-ahrefs/rank-tracker/overview |
| AthenaHQ | "Models" in the Olympus filters and schedules; prose also says "AI engines" | The Olympus page says it uses "models" rather than "platforms". docs.athenahq.ai/guides/olympus |
| Scrunch | "Platforms" ("AI platforms") | Prompts can be tagged by persona, topic and platform. Quick start: choose which AI platforms to monitor per prompt. helpcenter.scrunchai.com article 11696681 |
| Rankscale | "Engines" ("AI engines", "AI Search Engine") | Prompt setup: pick AI engines or "Select all". help.rankscale.ai finding-search-terms |
| SE Ranking (SE Visible) | "engines" | Four engines named in the product guide. visible.seranking.com/blog/how-se-visible-works/ |
| Sistrix | "Chatbot/model" in the prompt tracker terms; "AI Models" module in AI Search Overview; "Platforms" on the Prompt Monitoring page | sistrix.com/?p=175568 ; sistrix.com/?p=177786 ; sistrix.com/ai/prompt-monitoring |
| Goodie | "models" (partial) | Home page says it covers many AI models. higoodie.com |
| Writesonic | "AI engine" (partial) | Results split by AI engine in the blog guide. |
| Moz Pro | Not confirmed. Sponsored article says the tool tracks "ChatGPT and Gemini" | thenextweb.com/news/moz-pro-ai-visibility-chatgpt-gemini-tracking |
| Similarweb | "AI platforms" (partial, blog) | aisearch.similarweb.com/blog/what-is-ai-visibility/ |
| Google Search Console | Not an AI product. Search-type filter "Web", "Image" etc. is unverified | |
| GA4 | Traffic from AI tools sits in a default channel named "AI Assistant" | support.google.com/analytics/answer/9756891. It lists ChatGPT, Gemini, Deepseek, Copilot, Grok and excludes AI Overviews and AI Mode. A March 2026 Swydo guide says no AI channel exists, so GA4 changed or the guide is stale. Check your own property. |

## 2. How prompts or keywords are organised

"Opens onto prompts" means a topic or group is a clickable object that lists the prompts inside it.

| Tool | Grouping words | Does the group open onto its prompts? |
|---|---|---|
| Profound | "Topic" (group of related prompts, one theme, product or goal) and "Tag" (free-form second layer) | Likely, but not confirmed on a page. The glossary only says a topic is a group of related prompts. |
| Peec AI | "Topic" (folder-like, each prompt in exactly one) and "Tag" (many per prompt). System tags "Branding" and "Intent Type" | Yes in effect: topics contain prompts, and visibility can be read at topic level. docs.peec.ai/setting-up-your-prompts |
| Otterly.AI | "Tag" only ("Tags: labels for filtering and organizing prompts"). No topic object found | Not applicable. Bulk import cannot carry tags. help.otterly.ai/add-prompts |
| Semrush AI Visibility Toolkit | "Tags" (your own labels) and "Topics" (AI-generated groupings by semantic similarity) | Not confirmed. Prompt Research reports volume and difficulty "at the topic level". semrush.com/kb/1503-prompt-tracking, /kb/1594-ai-seo-metrics |
| Semrush Position Tracking | "Tags" on keywords; "Landscape" report | Tags report lists per-tag metrics. Not a topic. semrush.com/kb/549-position-tracking-overview |
| Ahrefs Brand Radar | "Tracked prompts", "report", "topic set"; advice to "group similar prompts" | No explicit group object found. "Dataset" filter switches to Tracked prompts. ahrefs.com/academy/how-to-use-brand-radar/custom-prompts |
| Ahrefs Rank Tracker | "tags" filter on keywords | Filter, not a container. |
| AthenaHQ | "Topic" (main grouping unit, drag prompts between topics) and "Tag" (cross-topic labels) | Yes. A Competitor Heatmap cell opens the matching Prompts page. docs.athenahq.ai/setting-up-prompts ; /guides/olympus |
| Scrunch | "Topic", "key topics", "persona", "tag" | Topics group prompts for reporting. Open behaviour not confirmed. |
| Rankscale | "Prompt group" (a cluster of tracked prompts per segment) and "tags" (required and extension tags); in Prompt Research a "cluster" and Core or Edge prompt labels | Visibility is scored per prompt group. rankscale.ai/resources/modules/diagnose/how-to-read-your-rankscale-dashboard |
| SE Ranking (SE Visible) | "Prompts grouped by topic", each "tagged by intent and funnel stage" | The Prompts view is the grouped list. |
| Sistrix | "Tag" (and automatic tag suggestions), "prompt sets"; Prompt Research groups prompts into "topics" with volume | Tags work as filters. sistrix.com/?p=175568 ; sistrix.com/ai/prompt-research |
| Goodie | "topic category" (segmentation list); "Trending Topic Intelligence" | Not confirmed. |
| Writesonic | "Topics and Prompts" (setup step name) | Not confirmed. |
| Moz Pro | Not found | |
| Similarweb | "Topics" chosen when creating a campaign; "Topics Summary" | Not confirmed. |
| SE Ranking Rank Tracker | "groups" and "tags" on keywords (snippet, unverified) | Filter by tag with And or Or. |
| Google Search Console | None. Dimensions are Queries, Pages, Countries, Devices, Search appearance, Dates | support.google.com/webmasters/answer/7576553 |

## 3. Where (location, country, region, market)

| Tool | Label | Notes |
|---|---|---|
| Profound | "Region" (the country a prompt is scoped to) | "Regions" tab. Glossary. |
| Peec AI | "Country" in filters; "Location" on the prompt | Plan limits countries per project. docs.peec.ai/setting-up-your-prompts |
| Otterly.AI | "country" chosen per prompt | Cannot be moved after creation, so a second market needs a second prompt. help.otterly.ai/add-prompts |
| Semrush AI Visibility Toolkit | "Location" and "language" per campaign | semrush.com/kb/1503-prompt-tracking |
| Semrush Position Tracking | "location" | Changing it deletes history. semrush.com/kb/549-position-tracking-overview |
| Ahrefs Brand Radar | "locations" in setup; API says "countries"; Looker connector says "market" | ahrefs.com/academy/how-to-use-brand-radar/custom-prompts. Looker and API wording came from a search snippet, unverified. |
| Ahrefs Rank Tracker | "Location" filter | |
| AthenaHQ | "Locations" (filter, schedule) and "Countries" (sources filter); the docs avoid "Regions" | docs.athenahq.ai/guides/sources |
| Scrunch | "country" among filters; quick start does not name a field | Unverified detail. |
| Rankscale | "Region" field on a prompt; "target country" and "language" in Prompt Research | help.rankscale.ai finding-search-terms |
| SE Ranking (SE Visible) | "location" (one location per project), "countries" (42) | visible.seranking.com/blog/how-se-visible-works/ |
| Sistrix | "Country" with language, chosen at project setup; "Countries" module in AI Search Overview | sistrix.com/?p=175568 |
| Goodie | "geography", "markets" | higoodie.com (partial) |
| Writesonic | Not found | |
| Moz Pro | "locale" in a brief template (sponsored article) | Unverified for the UI. |
| Similarweb | "region" ("a target region") when creating a campaign | aisearch.similarweb.com/blog/tracking-brand-mentions-in-ai/ |
| Google Search Console | "Countries" dimension | support.google.com/webmasters/answer/7576553 |
| GA4 | Not checked | |

## 4. The question we ask the AI product

| Tool | Label |
|---|---|
| Profound | "Prompt" ("A query Profound sends to answer engines on your behalf") per glossary. Note it uses "query" inside the definition. docs.tryprofound.com/getting-started/glossary |
| Peec AI | "Prompt" ("conversational queries" in prose) |
| Otterly.AI | "Search prompt" (nav "Search Prompts"), also "prompt" |
| Semrush AI Visibility Toolkit | "Prompt" (Prompt Tracking, Prompt Research) |
| Semrush Position Tracking | "keyword" |
| Ahrefs Brand Radar | "prompt" ("Tracked prompts"); API text also says "queries" (snippet, unverified) |
| Ahrefs Rank Tracker | "keyword" |
| AthenaHQ | "Prompt" |
| Scrunch | "Prompt" ("Unique Prompts" metric) |
| Rankscale | "Prompt" and "search term", declared the same: "search terms and prompts mean the same thing" (help centre) |
| SE Ranking (SE Visible) | "Prompt" |
| Sistrix | "Prompt" ("full natural-language questions") |
| Goodie | "prompt" |
| Writesonic | "prompt" |
| Moz Pro | "prompt"; separate "AI Research" for conversational prompts (sponsored article) |
| Similarweb | "prompt" ("Prompt Analysis") |
| Google Search Console | "Queries" (dimension) |

Related internal term: the sub-searches an AI engine runs while answering. Profound says "query fanout" (glossary); Peec has a "Fanouts" page under Results (docs.peec.ai/sidebar-navigation); Surfer, LLMPulse and Keyword.com say "fan-out" (search snippets, unverified).

## 5. Metrics on a brand in an answer

Brand named in the answer text, a link or cited page, share of voice, visibility score or rate, sentiment, position, recommendation.

| Tool | Brand named | Link or cited page | Share of voice | Visibility | Sentiment | Position |
|---|---|---|---|---|---|---|
| Profound | "Mention" | "Citation" | "Share of Voice" (mentions over all mentions) | "Visibility Score" (responses with your brand over responses naming any brand) | "Sentiment" | "Average Position" |
| Peec AI | "mentions" (descriptive) | "Sources", "Links", "citation" | "Share of Voice" | "Visibility" (percent of AI responses where the brand appears) | "Sentiment" (0 to 100) | "Position" (lower is better) |
| Otterly.AI | "Brand Mentions", "Brand Coverage" (share of responses naming you) | "Domain Citations", "Domain Coverage" | "Share of Voice" | "Brand Coverage" (no "visibility" metric name seen; a "Brand Visibility Index" quadrant exists) | "Brand Sentiment Score" | "Brand Position" (in insights page) |
| Semrush AI Visibility Toolkit | "Mentions" (count of prompts whose answers include you) | "Cited Pages", "Sources" | "Share of Voice" (Brand Performance) | "AI Visibility" (0 to 100 benchmark) | "Overall Sentiment" | "Average Position" (Prompt Tracking, AI Mode response area counts as position 1) |
| Semrush Position Tracking | n/a | n/a | "Share of Voice" (Business tier) | "Visibility" (CTR based) | n/a | "Average Position" (unranked counts as 100) |
| Ahrefs Brand Radar | "Mentions" (once per response) | "Citations" (per page, and per domain); "Found in" for retrieved but uncited pages | "AI Share of Voice" (share of impressions) | Umbrella "AI Visibility" over four metrics, plus "Impressions" | not found on the fetched page | not found |
| Ahrefs Rank Tracker | n/a | n/a | not found | not found | n/a | "Position" |
| AthenaHQ | "mention rate" | "Attributed Citations", "Citation %" | "Share of voice" | No score term found; "Mention and citation rates" instead. The docs do not define a "visibility score" | "Brand traits" (docs avoid the word sentiment) | "Position" |
| Scrunch | "Presence" (UI label "Mentions Rate") | "Citations Rate", "Citations Share of Voice" | "Share of Voice" (normalised competitive presence) | "Presence" is the headline word | "Sentiment Score" (UI "Sentiment Average") | "Position Score" (UI "Position Average", 0 to 100) |
| Rankscale | "Mentions" | "Citations", "Share of Citations" | "Share of Voice" | "Visibility Score" (0 to 100), "Detection Rate" | "Sentiment" | "Position" (strong 1 to 3, mid 4 to 6, weak 7 plus) |
| SE Ranking (SE Visible) | "mentions" (linked and unlinked counted separately) | "citations", "Sources" | "share of voice" | "Visibility" | "net sentiment" (minus 100 to plus 100) | "average position" |
| Sistrix | "Mentions" | "Sources", "citations" | not found | "AI Visibility Index" | "Sentiment analysis" (positive, neutral, critical) | not found |
| Goodie | "mentions" | "citations" | "share of voice" | not found | "sentiment" | "rankings" / "ranking position" |
| Writesonic | "mentions" | "Pages Cited", "Citations Overview" | "share-of-voice" | "Visibility score" | "sentiment" | "position" on a leaderboard |
| Moz Pro | "Mentions" | not found | "Share of Mentions" (percent of tracked prompts naming each brand) | not found | not found | "where your brand appears in each response" |
| Similarweb | "Mentions", "Brand Mention Share" (its AI share of voice) | "Citations", "Cited URLs" | "AI share of voice" | "Brand Visibility %" | "Sentiment Score" | not found |
| Google Search Console | n/a | n/a | n/a | "Impressions" | n/a | "Position" (average position) |

Recommendation: no tool I read uses "recommendation" as a metric label. Goodie and Scrunch mention it only in prose ("recommended"). Semrush uses "recommendations" for AI-generated fix suggestions (not a brand metric). Scrunch and Similarweb describe being "recommended", but not as a UI label.

One short quote worth keeping: Profound's glossary defines Visibility Score by responses and Share of Voice by mentions, so the same tool counts two different units (docs.tryprofound.com/getting-started/glossary).

## 6. The websites an answer cites: "source" or "citation"?

| Tool | Main word | Detail |
|---|---|---|
| Profound | "Citation" | The glossary has no entry for "Source". A "Citations" tab and "Citation Categories" exist. A "Domain" is the site behind a citation. |
| Peec AI | "Sources" (nav group "Sources" with Gap analysis, Domains, URLs) | Also "Links" and "citation". Docs separate retrieved from cited. docs.peec.ai/sidebar-navigation |
| Otterly.AI | "Citations" | The Citations report lists pages. "Domain Sources" appears as a metric label. help.otterly.ai/insights-on-brand-reports |
| Semrush AI Visibility Toolkit | "Sources" (a tab) and "Cited Pages" | semrush.com/kb/1503-prompt-tracking |
| Ahrefs Brand Radar | "Citations", "Cited Domains", "Cited Pages" | "Found in" covers retrieved pages that were not cited. help.ahrefs.com/en/articles/15501968-ai-visibility-metrics |
| AthenaHQ | "Sources" (page), with "Citation %" and "Attributed Citations" | docs.athenahq.ai/guides/sources |
| Scrunch | "Citations" (tab) | Page level. |
| Rankscale | "Citations" (tab) | |
| SE Ranking (SE Visible) | "Sources" (view) with a "Gap score" | |
| Sistrix | "Sources" ("the websites AI uses as references"; viewed as URLs, hostnames, domains) | A source may shape an answer even when not cited. sistrix.com/?p=175568 |
| Goodie | "citations" | |
| Writesonic | "Citations" ("Citations Overview", "Pages Cited") | |
| Moz Pro | not found | |
| Similarweb | "Citation Analysis", "Cited URLs" | |

Both words are in use. Tools that use both give them different jobs: Peec, Ahrefs and Sistrix treat "source" or "found in" as the wider set (pages the AI read) and "citation" or "link" as the narrower, visible set. Scrunch, Otterly and Profound lead with "citation".

## 7. Competitor, brand, entity, tracked, own brand

| Tool | Competitor word | Own brand word | Notes |
|---|---|---|---|
| Profound | "competitors" | "your brand" | Competition citation category. |
| Peec AI | "competitors" | "your brand"; settings page "Brands" | Competitors are brands inside the same Brands list. docs.peec.ai/sidebar-navigation |
| Otterly.AI | "Competitors" (column, ranking) | "brand", "Brand Coverage" | The workspace unit is a "brand report". |
| Semrush AI Visibility Toolkit | "competitors" | "brand", "domain" (Brand Performance domain) | |
| Ahrefs Brand Radar | "competitors" | "brand"; setup uses "brand and competitor entities" | The docs call them "entities", and results depend on how they are set up. |
| AthenaHQ | "competitors" | not found | |
| Scrunch | "competitors"; "Competitive Presence" | "your brand"; "AI Context" tab for brand context | helpcenter.scrunchai.com article 11696681 |
| Rankscale | "competitors" | "Brand" | |
| SE Ranking (SE Visible) | "Competitors" (tab, auto-suggested) | "Brands" in Settings, "brand" | |
| Sistrix | "Competitor" (up to nine) | "domain or brand", "entity" | Also "Entities & Competitors" and "Entity Environment". |
| Goodie | "direct and indirect competitors" | "brand" | |
| Writesonic | "direct and indirect" competitors | "brand" | |
| Moz Pro | "competitors" (up to three) | "your brand" | |
| Similarweb | "competitors" | "brand", "domain" | |

"Tracked" shows up mainly as "Tracked prompts" (Ahrefs) and "tracked competitors". Nobody I read labels the own brand "primary" or "owned" except citation-category words ("Owned" in Profound, "Owned domains" in AthenaHQ).

## 8. Unit of collection (run, check, scan, snapshot, response, answer)

| Tool | Words |
|---|---|
| Profound | "Execution" (one prompt on one platform) produces a "Response". "Run" is not defined for prompts. |
| Peec AI | "Chats" (a nav page, "All chats") |
| Otterly.AI | "Run" ("Each column is one run", "Run Date"), "response" |
| Semrush AI Visibility Toolkit | "daily tracking"; no unit noun found. Site audit uses "AI Search Checks" for pages |
| Ahrefs Brand Radar | "check" (one prompt times one AI tool times one location), "AI responses" |
| AthenaHQ | "Responses Analyzed", "schedule", "Run schedule now", "Stream Data" |
| Scrunch | "Responses" ("Total Responses") |
| Rankscale | "runs" (Detection Rate counts runs), "run frequency" |
| SE Ranking (SE Visible) | "answers", "checks run daily" |
| Sistrix | "prompt updates" (a billing unit per model per cycle), "prompt responses" |
| Goodie | "run" in prose ("AI answers also vary between runs") |
| Writesonic | "tracked AI answers" |
| Similarweb | "AI responses" |
| Google Search Console | not applicable; "Impressions" are the unit |

"Snapshot" and "scan" are rare. Otterly says it "scans each response" for mentions, but as a verb. No tool I read uses "snapshot" as a collection unit.

## 9. Search side

| Tool | Keyword word | Position | Volume | Difficulty | Intent | Clicks and impressions | Notes |
|---|---|---|---|---|---|---|---|
| Google Search Console | "Queries" | "Position" (average position) | no | no | no | "Clicks", "Impressions", "CTR" | support.google.com/webmasters/answer/7042828. Position is the topmost position per query, averaged. |
| Semrush Position Tracking | "keywords" | "Average Position"; "Positions" | via keyword filters | not on this page | "search intent" column | no | "Visibility" is CTR based. "Estimated Traffic". |
| Ahrefs Rank Tracker | "tracked keywords" | "Position", "Positions" filter, "Position History" | not on page | not on page | not on page | no | Filters by tag, location, SERP features. |
| SE Ranking Rank Tracker | keywords (groups, tags) | "Average position", "% In Top 10" | keyword tool | "Keyword Difficulty" | "search intent" | no | "Search Visibility", "Traffic Forecast". Snippet based, unverified. |
| Sistrix classic | keyword sets (unverified) | rankings | volume weighted | not checked | not checked | no | "Visibility Index" weights volume and click probability (secondary sources, unverified). |
| Moz Pro AI Research | prompts | n/a | "monthly volume" | "keyword difficulty" | "intent" | no | Search metrics applied to prompts. thenextweb.com sponsored article |
| Semrush Prompt Research | prompts | n/a | "AI Topic Volume" | "Topic Difficulty" | "user intent" | no | semrush.com/kb/1594-ai-seo-metrics |
| Sistrix Prompt Research | prompts | n/a | "search volume" per topic | not found | intent label, journey stage, persona | no | Page says it is still in development. |
| Otterly.AI | prompts | n/a | "Intent Volume" | no | no | no | help.otterly.ai/search-prompt-monitoring |
| Peec AI | prompts | n/a | no | no | "Intent Type" (Informational, Commercial, Transactional) | no | Auto system tag. |
| Rankscale | prompts | n/a | no ("Estimated Intent Relevance" is not search volume) | no | intent | no | help.rankscale.ai finding-search-terms |
| Ahrefs Brand Radar | prompts | n/a | "Impressions" (Google search volume of the matching keyword) | no | no | "Impressions" | The only AI metric defined from classic search volume. |

Search Console words that the AI tools borrow: "Position", "Impressions" (Ahrefs), "Visibility" (Semrush Position Tracking and every AI tool), "Queries" (partly).

## 10. Name of the home page for AI visibility

| Tool | Name |
|---|---|
| Profound | "Answer Engine Insights" (under Analytics) |
| Peec AI | "Overview" (nav Home, Overview). Docs title: "Overview Dashboard" |
| Otterly.AI | "brand report" (overview), with a "Prompts" tab |
| Semrush AI Visibility Toolkit | "Visibility Overview" |
| Semrush Position Tracking | "Overview" tab and "Landscape" report |
| Ahrefs Brand Radar | "Overview" |
| Ahrefs Rank Tracker | "Overview" |
| AthenaHQ | "Olympus" ("main analytics page") |
| Scrunch | "Dashboard" (quick start) |
| Rankscale | "Dashboard" with five tabs: Visibility, Mentions, Citations, Sentiment, Position. Help centre says "Brand Dashboard" |
| SE Ranking (SE Visible) | "Dashboard" |
| Sistrix | "AI Search, Overview" |
| Goodie | not found ("Visibility Monitoring" is the feature name) |
| Writesonic | "Overview Dashboard" ("Overview Page") |
| Moz Pro | "AI Visibility" (dashboard inside Moz Pro) |
| Similarweb | "Brand Overview" (inside AI Brand Visibility) |
| Google Search Console | "Performance" (report), with an Overview page |

## 11. What users call it

Honest limit first: Reddit blocked the fetch tool, and neither LinkedIn nor Hacker News threads came back from several searches. I found no forum thread I can cite. Everything below is surveys, agency and vendor articles, and tool documentation. Vendor material is shaped by what the vendor sells. Treat all of it as directional.

### 11.1 "AI visibility" vs "AI search visibility" vs "GEO" vs "AEO"

| Evidence | Strength | What it says | URL |
|---|---|---|---|
| Fractl survey, 343 US marketing decision-makers, July 2026, run by an agency | One solid survey | Words used internally: SEO 81%, "AI search optimization" 48%, GEO 19%, "LLM optimization" 15%, AEO 10%. Words they would search to hire an agency: "AI search optimization" 46%, SEO 24%, GEO 12%, AEO 3%. "AI visibility" was not reported as a label | ppc.land/marketers-still-call-it-seo-as-81-reject-geo-pitch-fractl-finds/ |
| Koozai survey, 160 self-described marketers, Aug to Sep 2026 | One small survey | Agency search wording: "AI search" 37%, GEO 13%, AEO 6%. Awareness: AI Search Optimisation 74%, GEO 43%, AEO 33% (from a search snippet of the same research). "AI visibility" had no figure | koozai.com/blog/digital-pr/research-geo-aeo-or-ai-search-optimisation/amp/ |
| Rankability demand study, Google Keyword Planner, June 2022 to May 2026 | One study | GEO had about twice the search demand of AEO. "AI visibility" and LLMO not reported | rankability.com/blog/ai-search-statistics/ |
| Search Engine Land survey on naming (Aleyda Solis, 2024) | One, snippet only | 18% said "GEO". Unverified, I did not open the page | searchengineland.com/ai-search-optimization-survey-2024 |
| eMarketer FAQ | One article | Says GEO, AEO, GSO, LLMO and AIO are all in use for overlapping work | emarketer.com/content/faq-on-geo-aeo--where-ai-search-seo-overlap-2026 |
| Product names | Many (6 of the tools I read) | "AI visibility" is the product word at Semrush (AI Visibility Toolkit), Moz (AI Visibility), SE Ranking (SE Visible), Sistrix (AI Visibility), Ahrefs (AI visibility metrics), Similarweb (AI Brand Visibility) | URLs in section 0 |
| "GEO" in tool vocabulary | Some (3) | Rankscale ("GEO workflow"), Otterly ("GEO Audit"), Writesonic (GEO tracker) | help.otterly.ai/insights-on-brand-reports ; rankscale.ai/resources/modules/introduction/the-rankscale-workflow |
| "AEO" in tool vocabulary | Some (2 to 3) | Goodie ("AEO platform"), Profound ("Answer Engine Insights"), a HubSpot product named "AEO" (search listing) | higoodie.com ; hubspot.com/products/aeo |
| "AI search visibility" | A few | Used as a topic phrase by Semrush and SE Ranking blogs, but not as a product or metric name | seranking.com/blog/analysis-of-search-visibility-with-se-ranking/ |

Reading: "AI visibility" is the product and metric word; "GEO" and "AEO" are the discipline words; neither has won. Surveyed marketers still mostly say "SEO" or "AI search optimization". "AI search visibility" is rare as a label.

### 11.2 "prompts" vs "queries"

- Many: 13 of the 14 AI tools I read call the tracked item a "prompt". Only Rankscale says "search term" too, and it says they mean the same thing (help.rankscale.ai finding-search-terms).
- Some: "query" is the word for the model's hidden sub-searches ("query fanout" at Profound, "Fanouts" at Peec). Surfer, LLMPulse and Keyword.com use "fan-out" (search snippets, unverified).
- Profound defines a prompt using the word "query", so the words blur in prose (docs.tryprofound.com/getting-started/glossary).
- Forum evidence: none found.

### 11.3 "mentions" vs "citations"

- Many agency and vendor articles split them the same way: a mention is the brand name in the text with no link; a citation is a linked or listed source. Examples: AirOps (airops.com/blog/difference-mentions-citations, dated 4 Aug 2026), TrueRanker, Techmagnate, Senso (search listings, unverified).
- The same articles quote a Seer Interactive finding that 58% of AI brand mentions carried no citation link (as reported by AirOps).
- Tools do not all follow it. Sistrix says visibility can come from source citations "even without a named mention". Scrunch and Sistrix treat citations as source use that may be unlinked. Semrush's "Mentions" is a count of prompts, not name occurrences.
- Strength: many sources agree on the split, all vendor written. No practitioner poll.

### 11.4 "platforms" vs "engines" vs "models"

- No survey. Only tool vocabulary: "platform" (Profound, Scrunch, Sistrix, Similarweb), "engine" (Otterly, Rankscale, SE Visible, Peec prose), "model" (Peec filter, AthenaHQ, Sistrix module), "AI tool" (Ahrefs).
- Profound's glossary says a platform is also called a model, and an answer engine is the service. That is a documented overlap, not a preference.
- Strength: some (tool docs only).

### 11.5 "topics" vs "groups"

- "Topic" is the dominant tool word (Profound, Peec, AthenaHQ, Scrunch, SE Visible, Semrush, Sistrix, Similarweb, Goodie, Writesonic). "Prompt group" is rare (Rankscale; Peec's own docs call the topic filter a "prompt group").
- Semrush separates user "tags" from auto-generated "topics". AthenaHQ also auto-assigns topics, then lets you edit them.
- No user evidence. Strength: many tools, no users.

## 12. Patterns and consensus

Counts are among the tools I read (about 14 AI tools).

| # | Concept | Most common word | Rare words | Words tools avoid or split on |
|---|---|---|---|---|
| 1 | Thing prompts run on | "platform" and "model" tie in UI labels; "engine" leads in prose (Otterly, Rankscale, SE Visible) | "AI tool" (Ahrefs), "search engine" (Semrush campaign) | "LLM" is almost never a UI label, since AI Overviews and AI Mode are not plain LLMs. "Source" is avoided here because it means cited websites |
| 2 | Organising prompts | "topic" (about 10 tools) plus a separate "tag" | "prompt group" (Rankscale), "cluster", "prompt set" (Sistrix), "folder" (only in Peec docs prose, not a UI label) | "category" is used only for intent or citation classes. Tools split "topic" (a container) from "tag" (a label). Whether a topic opens onto prompts is rarely stated |
| 3 | Where | "country" and "location" tie; "region" at Profound and Rankscale | "market" (Goodie, Ahrefs connector), "locale" (Moz brief) | "geo" is used in marketing text, not labels. Otterly fixes country per prompt, which no one else documents |
| 4 | Question we ask | "prompt" (13 of 14) | "search term" (Rankscale, also "prompt") | "query" and "keyword" are kept for classic search and for model sub-searches |
| 5 | Brand named, links, scores | "mentions" and "citations"; "Share of Voice"; "Sentiment"; "Position" (average position) | "Presence" (Scrunch), "Coverage" (Otterly), "Share of Mentions" (Moz), "Brand traits" (AthenaHQ), "Detection Rate", "Trust Gap" (Rankscale) | "Recommendation" as a metric: nobody. "Rank" is avoided for AI answers; Similarweb says there is no position seven. "Visibility" means three different formulas across Profound, SE Visible and Peec |
| 6 | Websites an answer cites | "citation" (Profound, Otterly, Ahrefs, Scrunch, Rankscale, Goodie, Writesonic, Similarweb) beats "source" (Peec, Semrush, Athena, SE Visible, Sistrix) by a small margin | "link" (Peec "Links"), "Found in" (Ahrefs), "Cited Pages" | "reference" is not used as a label. "Source" is split between "all pages used" and "pages shown" |
| 7 | Competitor and brand | "competitors" (everyone) | "entity" (Ahrefs, Sistrix), "tracked brand" | "own brand": no consistent label. "Tracked" appears only for prompts. "Entity" is used mostly by tools with an SEO or schema history |
| 8 | Unit of collection | "response" (Profound, Scrunch, Athena, Ahrefs, Similarweb) | "execution" (Profound), "chat" (Peec), "run" (Otterly, Rankscale), "check" (Ahrefs, SE Visible), "prompt update" (Sistrix) | "snapshot" and "scan" are not used as nouns. "Run" is avoided in the Profound glossary |
| 9 | Search side | GSC and Semrush: "Impressions", "Clicks", "Position" (average position), "Visibility" | "Share of Voice" in classic tracking (Semrush Business tier) | Many AI tools borrow volume, difficulty and intent, but each redefines them (Ahrefs Impressions, Semrush "AI Topic Volume", Otterly "Intent Volume") |
| 10 | Home page | "Overview" (Peec, Semrush AIVT, Ahrefs, Sistrix, Writesonic, Similarweb) and "Dashboard" (Scrunch, Rankscale, SE Visible, Writesonic) | "Olympus" (Athena), "Answer Engine Insights" (Profound), "brand report" (Otterly) | "Visibility" as a page name only on Semrush's "Visibility Overview". "Home" is a nav group, not a page, in Peec |

### Five clearest findings

1. The tracked question is "prompt" in 13 of 14 AI tools; "keyword" and "query" are kept for classic search.
2. The two core outcome words are "mentions" (brand named) and "citations" (page linked), and "Share of Voice" is the common competitive metric.
3. "Topic" is the standard container and "tag" the standard label; "group" and "folder" are rare.
4. The AI platform has no settled word: "platform", "model" and "engine" tie, so any choice is defensible if used consistently.
5. "Overview" and "Dashboard" name the home page almost everywhere; "AI visibility" is the product word while GEO and AEO remain contested discipline words.

### Cautions

- "Visibility" is defined three ways: percent of responses naming the brand (Profound, Peec), position weighted score (SE Visible), and composite index (Sistrix, Rankscale). Do not compare numbers across tools.
- Several fetches were summarised by the fetch tool. Spot check any label before putting it in a design.
- Semrush's own pages disagree on data update frequency (daily, weekly, monthly). Not relevant to naming.
- Some plan, price and engine-list details conflict between sources (Goodie, Moz, Sistrix). They were not needed for naming and are left out.
