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
6. **Wording.** Platform, Group, Location, Prompts (never Engine, Topic, Country, Topics and Prompts) in every visible
   string, in both the mock and the real app.

## Where the work is tracked

- Plan: `docs/superpowers/plans/2026-11-16-real-app-port-overview-and-prompts.md` (waves, packages, the preview change
  ledger).
- Backend requests for fields the real app does not have yet:
  `docs/ai-visibility/backend-requests-prompts-page.md` and `docs/ai-visibility/backend-requests-overview.md`.
