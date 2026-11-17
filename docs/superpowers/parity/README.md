# Mock and real app parity

The static design preview (`apps/web/design-preview`) is the source of truth for how the Prompts page and the AI
visibility Overview look and behave. The real app (`apps/web/src`) must match it, and stay matched. This folder holds
one register per screen:

- `prompts-page-parity.md` (IDs `PR-<area>-<nn>`)
- `overview-parity.md` (IDs `OV-<area>-<nn>`)

Each register describes exactly one preview state (a commit, plus any uncommitted files), row by row, with the exact
strings, the mock source, the owning package and how to verify. The real-app status column starts as `todo` and is set
to `done <commit>` or `differs <reason>` by the package that ports the row, and ticked by its reviewer.

## Rules

1. **A mock change is a register change.** Whoever changes the preview for these two screens adds or edits the rows in
   the same commit and says in the commit message which IDs changed. A preview change without a register row is
   unfinished.
2. **A real-app change that differs from the mock is a register change.** Mark the row `differs` with the reason (for
   example the API has three platforms), and if the owner agrees, change the mock too so they stay equal.
3. **Reviewers tick rows, not files.** A package is not reviewed until every row assigned to it has a status and, for
   `done`, a test or a side-by-side check named in its last column.
4. **Re-sync.** Before the real app is released, a last pass lists every preview commit made after the register's
   header commit (`git log <header commit>..develop -- apps/web/design-preview`) and ports or records each one.
5. **Sample values never ship.** Rows under "Mock shortcuts that must NOT be ported" stay out of the real app; the real
   app shows "not collected yet" or n/a until the backend provides the value.
6. **Wording.** Every visible word follows `docs/glossary/final-list.md` (Platform, Group, Location, Prompts, and the rest
   of the list; never Engine, Topic, Country as a field label, Topics and Prompts), in both the mock and the real app.
   A word changes in `docs/glossary/terms.md` first. The test `src/lib/glossary/glossary-words.test.ts` fails when a
   banned word appears in `messages/en.json` or in the layout catalog.

## Owner decisions recorded against the registers (2026-11-16)

- Overview empty cards: follow the mock. Every card keeps its place and smallest height in every scope and says why it
  has nothing. The spec text about hiding cards and an "N cards not drawn" note is superseded; update the spec.
- Platform order everywhere: ChatGPT, Gemini, AI Mode, AI Overview (real app order; AI Overview last, not available
  until the API has it).
- Terminology: decided 2026-11-16 in `docs/glossary/` (Group by the owner, the rest by taking the research session's
  recommendations; D18 and D20 stay open; D17 was decided 2026-11-17: share of voice is the brand's mentions over all
  tracked-brand mentions, always shown as "x of y brand mentions"). The application pass has run: the real app (`en.json`, the layout
  catalog, the tests), the mock (`apps/web/design-preview`) and these registers use the glossary words.
- Where the real app already behaves better than the mock (loading and error states, URL state for filters, keyboard
  access to popovers), keep the real behaviour and mark the row `differs real is better`.

## Where the work is tracked

- Plan: `docs/superpowers/plans/2026-11-16-real-app-port-overview-and-prompts.md` (waves, packages, the preview change
  ledger).
- Shared code of the two screens (features cannot import each other): the pure Prompts facts (position, sentiment,
  brands, cited links, volume, intent) in `apps/web/src/lib/prompt-facts/` (the read hook stays in
  `features/prompts/facts/`, whose `index.ts` re-exports the lib), and the change icon `DeltaIcon` in
  `apps/web/src/components/app/metric/delta-icon.tsx`. The Overview opens a prompt through `drillHref('prompt', ...)`
  (`features/ai-overview/drilldown/drill-links.ts`) and the `inspect` key of `lib/inspector/placement.ts`.
- Backend requests for fields the real app does not have yet:
  `docs/ai-visibility/backend-requests-prompts-page.md` and `docs/ai-visibility/backend-requests-overview.md`.
