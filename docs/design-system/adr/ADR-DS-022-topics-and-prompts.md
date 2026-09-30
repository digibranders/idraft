# ADR-DS-022: Topics first on the prompts page

Status: accepted, 2026-09-30. Extends [24-page-templates.md](../24-page-templates.md) section 9.5 and [11-navigation.md](../11-navigation.md).

## Context

The Prompt Explorer was specified as one flat table of prompts, with the topic as a column. A project tracks hundreds of prompts, and most questions start one level up: "how visible are we on pricing questions?" comes before "how visible are we on this one prompt?". A flat list of 250 rows answers the second question and makes the first one a filtering exercise.

The product owner's reference screen shows the other arrangement: topics as rows, the prompts of a topic grouped under it, and a drawer for the topic.

## Decision

1. The navigation item and the page are called "Topics & Prompts" (`/ai/prompts`). Its tabs are Topics (the default), Prompts, Panels and Versions.
2. The Topics tab has one row per topic that has prompts in scope. A chevron opens the topic in place and lists its prompts, most mentioned first, eight at most; "Show all" opens the topic drawer on its Prompts tab.
3. A topic's numbers are computed from its prompts and nothing else. The same holds for the entities in the topic drawer: a competitor's rate is prompt-weighted like the brand's own. Per engine, the rate is prompt-weighted (each prompt counts once, [17-statistical-methodology.md](../../17-statistical-methodology.md) section 4.1). Across engines it is the equal-weight average, labeled "avg of 3". No value is pooled without saying so.
4. The Topics tab also carries the search side of a topic: SEO visibility and Top 10 of its tracked keywords. The prompt filters do not apply to those two columns, and the interface says so.
5. "Top engine" names the engine with the highest mention rate for the row. It is a pointer, not a ranking of engines: the rates of all engines in scope are in its tooltip and in the drawer.
6. The Topics and Prompts tabs share the filter bar, the saved view and the metric strip, so a filter set on one tab holds on the other. Each table's search only finds rows; it is not a filter and does not change the strip.
7. The topic drawer is 440 px, like the prompt drawer. Tabs: Overview (three rates, a visibility trend against the most mentioned competitors, the rate per engine, the top prompts), Prompts, Competitors, Related.
8. A prompt opened from a topic keeps the topic as its list: J and K step through that topic's prompts, and the topic badge in the prompt drawer leads back.
9. The flat table stays, as the Prompts tab, for work across topics: sorting all prompts by one engine, bulk actions, the column chooser.
10. There is no separate "Topics" item in the sidebar. One place lists topics: this page. The sidebar has 14 items.

## Consequences

- Whether a change is detectable is judged on the counts of the engines in scope taken together (the unpaired interval of 17 section 6.2 on pooled counts). That is a test, not a displayed rate: the rates stay per engine or labeled averages. The paired bootstrap of 17 section 6.1 replaces it when the API computes the change.
- Where an engine does not have a metric (recommendation is not classified on AI Mode), its cells read "n/a" with the reason, and an average says how many engines took part ("avg of 2").

- The Topic Explorer of [20-frontend-specification.md](../../20-frontend-specification.md) section 5.11 no longer has a destination. Its search columns, SEO visibility and Top 10 per topic, are now columns of the Topics tab and a card in the topic drawer. Two things it had still need a home before the app is built: editing the taxonomy terms (proposed: Settings) and the pages that influence a topic. They are an open point in the review log.
- Topic rows have two lines (name, then category and prompt count), so they are taller than prompt rows.
- The strip gains a "Topics" item. With three engines in scope it has five items.
- "Show in Prompts" moves to the Prompts tab with the topic as a filter, which then also applies when the person returns to Topics.

## Revisit trigger

A project has so many topics that the Topics tab needs its own paging or grouping by category, or usage shows that people open the Prompts tab first.
