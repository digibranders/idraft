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
| a | "{n} keywords show a Google AI Overview and are not tracked as prompts" | `GET tracked-keywords?filter[aio_state]=present_not_cited,present_cited` (one page of 200) matched by normalized text against `GET prompts` (one page of 200). No read says "not tracked as a prompt" | Prompts page, action **Start tracking** (the page, not a pre-filled dialog) |
| b | "{n} prompts where a competitor is cited and your site is not" | `GET ai/citation-gaps` `meta.gaps`, the Citations gap definition, first three tracked competitors, last 4 runs | Citations, `/ai/citations/gaps` |
| c | "{n} cited domains cite your tracked competitors, last 28 days" | `GET ai/sources/domains?filter[domain_role_in]=third_party&include=cited_with`, rows whose `cited_with.entity_id` is a tracked competitor | Citations, Cited pages with `owner=third` (approximate: the page lists pages, not this set of domains) |
| d | "{n} new cited domains this month" | `GET ai/sources/changes?kind=new&limit=1`, third-party domains, `page.total`, window first of the month to today | Citations, Cited pages (approximate: it has no "new" view) |

The Citations page has no Domains tab, so c and d link to the nearest view; request 26 asks for the exact one.

Shortcuts, each in code with a `shortcut:` comment and in `backend-requests-open.md`:

- a: a client match of at most 200 keywords against at most 200 prompts, exact text; the server should count it (request 25).
- b: the brief asks for domains, the gap read counts prompts (request 26).
- c: counted in the 200 most cited third-party domains; shown as "{n}+" when the read has more.
- d: `page.total` counts one row per domain and role, here third-party only (request 26).

## States

Loading: one skeleton row per line, and the box waits for the platforms before it decides a line is idle. Each line
loads and fails alone, with its own message and Try again; if the competitors cannot be read, lines b and c fail
together and Try again reads them again. A line at zero is left out while another has a count. The box says "Nothing to
act on" only when every line is settled, none failed and none is unknown (a count cut at its page size that found
nothing, or prompts cut at 200, is unknown and blocks it). Refetch keeps the last counts.

## Steps

1. Design preview (`apps/web/design-preview/aiov-insights.js`, mock data, hooked into `aiov.js`).
2. Real app: `features/ai-overview/insights/` (model, reads hook, box component, tests), strings in `messages/en.json`.
3. Targeted tests, lint, typecheck. Independent review on the Opus model.
