# AI visibility: owner requirements (running list)

This file records what the owner has asked for, in order, so no plan or session loses it. The master plan must
cover every item. When the owner adds one, it is appended here first.

Dates are 2026-11-12 unless stated.

## Scope and delivery

R-01. Build the ENTIRE AI visibility feature, every part, web and backend: pages, tabs, tables, drawers,
inspectors, dialogs, toggles, menus, charts, empty and error states, and everything the specs plan or mention,
including the features and data extracted from the Nuwtonic review.

R-02. Write one full implementation plan (Opus) for end to end implementation, structured so work can fan out
across as many sessions, worktrees and subagents as is practical, using Sonnet or Haiku for implementation and
review. Decide per feature whether one session does backend and web together or separate sessions do each.

R-03. The owner wants one clear progress view: one list of all tasks and their status, because several sessions
at once are hard to follow. One tracker, always current.

R-04. Aim to have the feature built today, with efficient, accurate, high quality work in everything.

## Quality bar

R-05. UI must be professional and sleek, at the level of the Keywords and Prompts pages already built, on every
new page.

## Overview dashboard

R-06. An Overview dashboard page with all the summaries, charts and graphs, creative and professional.

R-07. It must be a GREATER version of the dashboard in the approved design preview (apps/web/design-preview),
with the same FULL customization as the preview (customize mode, card catalog, move and options, presets, save
and discard, per-user and shared layouts).

R-08. It must be better than the Nuwtonic dashboard: sleek, professional, clean, creative, with all the charts the
data can honestly support. Check Nuwtonic again for chart references if useful, and think of more.

R-09. Topics overall performance BY ENGINE: the owner wants to see how each topic performs overall, per engine
(ChatGPT, Gemini, Google AI Mode), as a first class view: on the Overview, on the Topics tab, and in the topic
drawer, with comparison across engines, trend over time, and drill-down to the prompts behind it.

## Drawers (prompt inspector and topic drawer)

R-11. Review the prompt inspector and the topic drawer completely: every tab, every card, every detail and every
chart inside them, against the specs (docs/11, docs/16, docs/19, docs/design-system, the topics and prompts
preview parity spec, the gap analysis) and the Nuwtonic notes (Prompt Run, Fan-outs, Citations, Dashboard). Build
everything that can be added: for the prompt inspector the header strip, Latest per engine, History with the
confidence band, Citations (sources behind the answer), Competitors, Fan-out (queries and who is cited), Stats
with intervals, Versions and the prompt's runs; for the topic drawer Overview, Prompts, per-engine performance,
Competitors, Related topics and the SEO view of the topic. Each tab gets its charts, empty, loading and error
states, keyboard behaviour and phone layout. The inventory rows WB-PI-nn and WB-TD-nn in
docs/ai-visibility/inventory/web.md are the starting list; the plan must make every row that is not DROP a task.

## Prompts management

R-10. Upgrade the Add prompts and Import prompts dialogs, which need a lot of improvement (paste, CSV import,
generate from keywords, suggestions inbox, quality of the whole add flow).

## Constraints already decided by the owner

- Panels run twice a week (Monday and Thursday). Restoring a version is not a change kind. The prompt type comes
  from a server rule at create, with a person override in the Add dialog and on PATCH.
- The 20-a-day manual run cap stays as it is. gzip and other ops work belong to a separate ops session.
- Page-level AI readiness (GEO checks) is NOT opened by the owner yet. It is listed in the specs, so the plan
  schedules it as an optional late wave.
- The AI answer schedules stay paused until the owner resumes them; any real provider spend needs the owner's
  yes and a budget set first.
- Codex cannot be used for review; Sonnet reviews.
- The web client (apps/web/src/lib/api/schema.ts) is regenerated with `pnpm gen:api` right after any backend
  OpenAPI change, because the release check `schema.test.ts` fails when it is stale.
