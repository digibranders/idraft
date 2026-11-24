# Opportunities feed on the AI visibility Overview (roadmap feature 4)

Date: 2026-11-24. Branch `feat/opportunities-feed` (worktree `.claude/worktrees/opportunities`), lands in `develop`.
Roadmap: `2026-11-24-seranking-high-value-roadmap.md`.

## What it is

A box named **Insights** between the scope bar and the card grid of AI > Overview. One line per finding: a count, a
sentence, and a link to the screen that holds the work. It is a fixed box, not a layout card, so it needs no catalog
entry (the catalog lives in the backend). It does not clash with the `ai.opportunities` card (prompt counts by
condition); a line here points at the page, not at a prompt list.

## The four lines, and what already serves them

| Line | Words (glossary) | Read that exists | Link |
|---|---|---|---|
| a | "{n} keywords show a Google AI Overview and are not tracked as prompts" | `GET keywords?filter[aio_state]=present_not_cited,present_cited` (rows, `limit` 200) matched by text against `GET ai/prompts`. No read says "not tracked as a prompt" | Prompts, action **Start tracking** |
| b | "{n} prompts where a competitor is cited and your site is not" | `GET ai/citations/gaps` `meta.gaps` (the Citations gap definition: cited on an engine for a competitor, not for you) | Citations, Gaps tab |
| c | "{n} cited domains that cite your tracked competitors" | `GET ai/sources/domains?filter[domain_role_in]=third_party&include=cited_with`, rows whose `cited_with.entity_id` is a tracked competitor | Citations, Domains tab |
| d | "{n} new cited domains this month" | `GET ai/sources/changes?kind=new&limit=1`, `page.total`, window first of the month to today | Citations, Domains tab |

Shortcuts, each in code with a `shortcut:` comment and in `backend-requests-open.md`:

- a: a client match of at most 200 keywords against the prompt texts; the server should count it (request 25).
- b: the brief asks for domains, the gap read counts prompts. A domain count needs a brand filter on `sources/domains` (request 26).
- c: counted in the 200 most cited domains; shown as "{n}+" when the read has more.
- d: `page.total` counts one row per domain and role (the same limit as `use-new-sources.ts`).

## States

Loading: one skeleton row per line. Each line loads and fails alone: a failed line shows "Could not load" with Retry,
the others stay. Empty (all four lines at zero): "Nothing to act on this month" with the scope reason. A line at zero is
left out while another has a count. Refetch keeps the last counts.

## Steps

1. Design preview (`apps/web/design-preview/aiov-insights.js`, mock data, hooked into `aiov.js`).
2. Real app: `features/ai-overview/insights/` (model, reads hook, box component, tests), strings in `messages/en.json`.
3. Targeted tests, lint, typecheck. Independent review on the Opus model.
