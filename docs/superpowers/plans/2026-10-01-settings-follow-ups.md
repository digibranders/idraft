# Settings follow-ups

Branch `frontend/settings-follow-ups`, from `frontend/entities` (c22d7f1). It closes the open points the workspace setup plan left for a later settings plan (`2026-10-01-workspace-setup.md`, Open points), and carries the final step 4 contract work merged in from `frontend/entities`.

**Goal:** Settings that need no project, lists that are whole at any size, and the browser flows the workspace setup could not test yet.

**Architecture:** Workspace-level routes reuse the existing settings screens inside the workspace shell. Paged lists are read whole by one reader in `lib/api`, shared by the client queries and the server's project list. The e2e helpers age a mock session in place.

## Tasks

### Task 1: Settings outside any project

- `/{workspace}/settings/{profile,security,preferences,workspace,members}` (`src/app/[workspace]/settings`). The shell is the segment's layout; the settings navigation is the `(sections)` route group's layout, so `error.tsx` and `loading.tsx` keep the shell, as in a project. `settings` redirects to Profile.
- `SettingsFrame` takes `project: string | null`; without a project it leaves the Project settings group out and links with `workspaceSettingsPath`, which takes only the sections that exist outside a project (`WorkspaceSettingsSection`).
- `WorkspaceShell` takes `{ slug, name }` and an optional `page`, the breadcrumb's current item; Account settings always opens the workspace's own Profile, so a member who can open no project still reaches it. New project names itself in the breadcrumb.
- `WorkspaceGeneralScreen` takes `projectSlug: string | null`; a new workspace address keeps the person on the settings route they were on.

### Task 2: Lists past one page

- `readAllPages` (`src/lib/api/pages.ts`): offset pages of 200, at most 50. Each page after the first starts at the last item read, which the caller's `idOf` must find there; otherwise, or when `total` moved, an item came or went meanwhile and the list is read again from the start. A page with nothing new before `total` counts as a change too. Three changed readings in all fail with `ListChangedError`, and a list longer than 50 pages hold fails with `ListTooLongError`: never part of a list.
- `apiAllPagesQuery(path, idOf, init)` answers the pages as one page, under a key of its own (`pages: 'all'`). Members, invitations and the dialogs' project lists use it; the server's `projectsOfMembership` uses `readAllPages` directly.
- The member and invitation mocks page and validate `offset` and `limit`, through `offsetPaging` and `offsetPageOf` shared in `src/mocks/handlers/rules.ts`.

### Task 3: Browser flows

- "Confirm it is you": `ageSession` (e2e/support.ts) makes the mock session stale in the browser's cookie and in the mock worker's own cookie store, then reloads; an admin's role change asks for the password and then goes through.
- Every main page passes axe in the dark theme. `expectAccessible` waits for finite animations first, so a dialog fading in is not measured at part of its opacity.
- The visual set gains an admin's Members (invitations, two-factor column, row actions) and the workspace's own Profile. Baselines are still made in the pinned Playwright image.

## As built

- Commits: 5ff0279, b647989 (review fixes), 5052ba5, 0beb4da (paging and its review fixes), 8fd21fe (e2e), and the merges of `frontend/entities` (step 4 contract, f627d1c, 5173937, c5e9bd6).
- Reviews: one independent review per task. Findings fixed: error and loading states for the new routes, a typed section union, the New project crumb, a required account settings link, overlap paging and a refusal to answer part of a list.
- Checks at the last commit: lint, typecheck, 1652 unit tests, format, the build without mocks, the design preview and 46 e2e flows.
- Merge waits for the backend's `backend/entities` on main (this branch contains `frontend/entities`) and for the user's word.
