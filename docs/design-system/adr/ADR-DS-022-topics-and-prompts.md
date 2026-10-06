# ADR-DS-022: Topics first on the prompts page

Status: accepted, 2026-09-30. Extends [24-page-templates.md](../24-page-templates.md) section 9.5 and [11-navigation.md](../11-navigation.md).

## Context

The Prompt Explorer was specified as one flat table of prompts, with the topic as a column. A project tracks hundreds of prompts, and most questions start one level up: "how visible are we on pricing questions?" comes before "how visible are we on this one prompt?". A flat list of 250 rows answers the second question and makes the first one a filtering exercise.

The product owner's reference screen shows the other arrangement: topics as rows, the prompts of a topic grouped under it, and a drawer for the topic.

## Decision

1. The navigation item and the page are called "Topics & Prompts" (`/ai/prompts`). Its tabs are Topics (the default), Prompts, Panels and Versions.
2. The Topics tab has one row per topic that has prompts in scope. A chevron opens the topic in place and lists its prompts, most mentioned first, eight at most; "Show all" opens the topic drawer on its Prompts tab.
3. A topic's numbers are computed from its prompts and nothing else. The same holds for the entities in the topic drawer: a competitor's rate is prompt-weighted like the brand's own. Per engine, the rate is prompt-weighted (each prompt counts once, [17-statistical-methodology.md](../../17-statistical-methodology.md) section 4.1). Across engines it is the equal-weight average, labeled with the number of engines that took part ("avg of 4"). No value is pooled without saying so.
4. The Topics tab also carries the search side of a topic: SEO visibility and Top 10 of its tracked keywords. The prompt filters do not apply to those two columns, and the interface says so.
5. "Top engine" names the engine with the highest mention rate for the row. It is a pointer, not a ranking of engines: the rates of all engines in scope are in its tooltip and in the drawer.
6. The Topics and Prompts tabs share the filter bar, the saved view and the metric strip, so a filter set on one tab holds on the other. Each table's search only finds rows; it is not a filter and does not change the strip.
7. The topic drawer is 440 px, like the prompt drawer. Tabs: Overview (three rates, a visibility trend against the most mentioned competitors, the rate per engine, the top prompts), Prompts, Competitors, Related.
8. A prompt opened from a topic keeps the topic as its list: J and K step through that topic's prompts, and the topic badge in the prompt drawer leads back.
9. The flat table stays, as the Prompts tab, for work across topics: sorting all prompts by one engine, bulk actions, the column chooser.
10. There is no separate "Topics" item in the sidebar. One place lists topics: this page. The sidebar has 14 items. (Superseded by 16 destinations as built, with Runs and Costs added in the third section; see [11-navigation.md](../11-navigation.md) section 1.1. The decision itself, no Topics item, stands.)
11. AI Overview is the fourth engine on this page, after ChatGPT, Gemini and AI Mode ([14-badges-status.md](../14-badges-status.md) section 4), and it is the one engine that is not asked. It is read from the rank check of the prompt's linked keyword on the day of each run, and a check counts only when Google showed an AI Overview ([16-metrics-methodology.md](../../16-metrics-methodology.md) section 1, rule 5). Its unit is "AI Overviews" ("62 of 384 AI Overviews"); compact cells keep "obs", because an AI Overview seen at a check is one observation ([15-seo-ai-correlation.md](../../15-seo-ai-correlation.md) section 3). A prompt without one says why, because the two reasons call for different actions: "n/a" when no keyword is linked, "No AIO" when the linked keyword showed none. "Run now" and the panel sizing cover the asked engines only, and a prompt's Updated time is its last answer from an asked engine. The drawer names the linked keyword (a "Linked" badge in Related keywords, and the keyword and its rank on the AI Overview card, which quotes the overview instead of ranking the brand); a prompt without one offers "Link a keyword".
12. The strip is "Prompts" and one card per engine. An engine card shows the metric of the engine columns as its value, with its change, and the other headline rates on the line below ("Cited 21% · Share of voice 27%"; "SOV" below a strip width of 1,280 px). The counts behind all of them are in the card's tooltip. The Prompts card says how many topics the prompts span and nothing else: the filter chips already say which prompts they are.

## Consequences

- Whether a change is detectable is judged on the counts of the engines in scope taken together (the unpaired interval of 17 section 6.2 on pooled counts). That is a test, not a displayed rate: the rates stay per engine or labeled averages. The paired bootstrap of 17 section 6.1 replaces it when the API computes the change.
- Where an engine does not have a metric (recommendation is not classified on AI Mode), its cells read "n/a" with the reason, and an average says how many engines took part ("avg of 2").

- The Topic Explorer of [20-frontend-specification.md](../../20-frontend-specification.md) section 5.11 no longer has a destination. Its search columns, SEO visibility and Top 10 per topic, are now columns of the Topics tab and a card in the topic drawer. Two things it had still need a home before the app is built: editing the taxonomy terms (proposed: Settings) and the pages that influence a topic. They are an open point in the review log.
- Topic rows have two lines (name, then category and prompt count), so they are taller than prompt rows.
- The strip holds three to five items: Prompts and one card per engine. With four engines the logos show from a strip width of 1,152 px; below that the engine name stands alone, so no label is cut at 1,280 px.
- An engine card shows three rates and one visible denominator fewer than before: the counts moved from the card's last line to its tooltip. That trades rule 11 of the UI rules (a denominator beside every metric) for the product owner's request to see mention, citation and share of voice together. The table below the strip still shows counts beside every rate.
- AI Overview takes part in the equal-weight average and in the pooled test that decides whether a change is detectable, like any engine in scope. Its counts are small (four at most per prompt), so it rarely changes the verdict, but it can.
- The AI Overview numbers of this page are rank checks of keywords linked to prompts. They are a different population from the Overview's search cards, which count every tracked keyword at its latest check (411 with an AI Overview, 157 citing the site), so the two sets of numbers are different on purpose.
- The rule of decision 11 that ties an AI Overview observation to the rank check on a run day is a choice of this design. 11 and 16 say only that AI Overview observations are keyed to tracked keywords; the API has to agree on the unit before the app is built. It is an open point in the review log. The backend's preliminary view (2026-09-30, not yet a contract): anchor on the prompt's primary linked keyword; take the tracked keyword that matches the prompt's country and language on the project's default device, and the latest successful check of each day, so the cadence is the rank checks' (daily) and `n` will usually be larger than for the asked engines; return `mentioned`, `cited`, `n` (checks with an AI Overview), `checks` (all checks) and a `source_state` of `no_linked_keyword`, `not_tracked`, `no_surface` or `ok`. The page then needs a third empty reason, "not tracked" (the linked keyword has no tracked keyword for this market), and can show the presence rate (`n` of `checks`) in the tooltip. The preview keeps four checks at most per prompt until the contract is fixed.
- "Show in Prompts" moves to the Prompts tab with the topic as a filter, which then also applies when the person returns to Topics.

## Revisit trigger

A project has so many topics that the Topics tab needs its own paging or grouping by category, or usage shows that people open the Prompts tab first.
