# High value features from the SE Ranking review

Date: 2026-11-24. Source: a read of three SE Ranking AI Results Tracker pages (Competitors, Rankings, Sources) on
2026-11-24, plus the owner's decision to build the features that help SEO executives and specialists. Pages not opened:
Insights, Data Studio, Report Builder, Guest link, Marketing Plan. Check each against SE Ranking before copying it.

Each feature is its own plan, branch and session. They touch different areas, so they can run one after another without
sharing files. One session at a time writes code in a given set of files.

| # | Feature | For | Data it needs | State |
|---|---|---|---|---|
| 0 | Compare days (prompt page) | specialist | answers and answer detail, already served | built, branch `feat/prompt-day-compare`, uncommitted |
| 4 | Opportunities feed (Insights): untracked keywords with Google AI Overviews, sources that cite competitors but not you, new sources this month | specialist | rank checks, citations board, gap definitions | to plan |
| 1 | Client reports: guest link and scheduled email | executive | the Overview and Citations reads, a share token, a mail sender | to plan |
| 3 | Alerts: brand enters or leaves an answer, competitor appears, keyword drops | both | day-by-day answer facts (Compare days model), rank checks | to plan |
| 2 | "What changed this week" summary on the Overview | executive | the same counts as 4 and 3, worded | after 4 and 3 |
| 5 | Citation gaps as an outreach list with status (to do, in progress, done) | specialist | Citations gaps, domain types | after 4 |
| 7 | Link AI visibility to Search Console and page changes | specialist | `docs/15-seo-ai-correlation.md`, Page performance, internal links | after 1 to 5 |
| 6 | Google organic top 10 or 20 beside each answer, and the organic-to-AI overlap number | specialist | one more DataForSEO call per prompt per run | blocked on the owner's cost decision |

## Order

4, then 1, then 3, then 2 and 5, then 7. Feature 6 starts when the owner has priced it (extra call per prompt per
run; see `docs/ops/tracking-cost-datasheet.html`).

## Skipped on purpose

A backlink database, a site auditor and a general keyword research database: commodity features, costly to run, and
they pull focus from AI visibility.

## Open decisions

- Reports (1): the mail sender, whether a guest link needs a password, whether it shows costs.
- Alerts (3): channels (in the app, email, Slack), and how often.
- Organic results (6): price per prompt per run.
- Every feature: the mock in the design preview first, on `develop`, then the real app (the preview rule of 2026-11-16).
