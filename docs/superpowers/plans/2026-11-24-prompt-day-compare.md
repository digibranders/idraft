# Prompt day compare (full page)

Date: 2026-11-24. Branch `feat/prompt-day-compare`, worktree `.claude/worktrees/day-compare`.

## What it is

The prompt full page `/ai/prompts/[promptId]` (listed in `docs/design-system/16-drawers-dialogs-popovers.md` section 1.1, a
404 stub until now) opens with one section, **Compare days**: one platform at a time, one column per answer day (the last
four days with a valid answer). Each column lists the brands the answer named in order, the sites it cited, and what
changed since the column before (brands that entered, brands that left). A one-line reading says whether the own brand
was named and cited that day.

The History tab of the prompt inspector gets a **Compare days** link to the page, for the platform its chart shows.

Chosen with the owner on 2026-11-24: full page, not a dialog (a dialog never holds tables or browsing, doc 16 section 1.1).

## Data: no backend change

Everything is already stored and served:

- the answers list `GET {P}/ai/observations?filter[prompt_id]=...` (one valid answer per day is picked in the browser);
- `GET {P}/ai/observations/{id}` for each picked answer: `mentions` (name, role, `mention_order`, status) and
  `citations` (host, `domain_role`, `citation_index`).

Four detail reads at most, each cached by the existing `observationQuery` key, so opening an answer in the inspector
afterwards costs nothing.

Not built: the Google top 10 per day that the design preview showed. The backend collects no organic results for a prompt
itself (only for its linked keyword), so a column would invent them. Open point for the AI analytics plan.

## Tasks

1. `day-compare-model.ts` and its test: pick the answers, build a column from a detail, the changes, the reading.
2. `day-compare-screen.tsx` (+ `use-day-columns.ts`, `day-columns.tsx`): header, platform select in the address
   (`?engine=`), columns, empty, loading and error states. Words in `messages/en.json` under `prompts.dayCompare`.
3. Route: replace the stub `app/[workspace]/[project]/ai/prompts/[promptId]/page.tsx`; export from the feature index.
4. History tab link; the glossary check.
5. Targeted checks (lint, typecheck, tests of the files touched), then an independent review.
