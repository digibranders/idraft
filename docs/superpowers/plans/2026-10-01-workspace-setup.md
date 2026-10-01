# Workspace Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a team set itself up in the app with no help from the API by hand: an operator creates the workspace, an owner or admin invites the team and gives each person a role and project access, and anyone allowed creates a project, names it, sets its time zone and check day, pauses or archives it, and renames the workspace.

**Architecture:** The screens of build-order step 1 (docs/29 section 1.1) on top of the web app foundation (`docs/superpowers/plans/2026-09-30-web-app-foundation.md`, merged on 2026-10-01). Three settings sections join the existing `SettingsFrame` under the groups "Project settings" and "Workspace settings"; a new-project page and an operator's new-workspace page are full pages. Every route they call exists in `backend/openapi/v1.json` today; the mocks answer them first so the screens are finished and tested without the API, and each task ends with a walk against the real API.

**Tech Stack:** As the foundation: Next.js 16.3, React 19.3, TypeScript 6 strict, Tailwind 4.3, Base UI 1.8, TanStack Query 5, react-hook-form 7 with zod 4, next-intl, openapi-fetch, MSW 2, Vitest 5, Playwright 1.63.

**Sources of truth.**

| Document | Decides |
|---|---|
| `docs/19-api-specification.md` sections 3.2 and 3.3 (rows marked 1) | Routes, permissions, fresh-session rules, errors: `409 duplicate`, `409 last_owner`, `409 invalid_state_transition`, `422 quota_exceeded`, `422 validation_failed` with `project_unknown`, `scope_not_allowed`, `timezone_unknown`, `429 rate_limited` |
| `docs/20-frontend-specification.md` sections 5.1 (step 1) and 5.19.1, 5.19.2, 5.19.5 | What each screen holds |
| `docs/design-system/11-navigation.md` section 5, `24-page-templates.md` T4 | Settings groups, routes, read-only state, danger zone |
| `docs/design-system/10-forms.md` sections 13, 19, 23 | Save bar, form-level problems, mapping server errors |
| `docs/design-system/16-drawers-dialogs-popovers.md` sections 3 and 4.5 | Dialog sizes, confirmations |
| `docs/24-security.md` section 3 | The role and permission matrix |
| `apps/web/design-preview/index.html` (`#/settings/...`) | The settings navigation with every group, and the workspace menu ("Create project", "Workspace settings") |

**Notes for the executor**

- Branch `frontend/workspace-setup` in the main checkout, from `main` e02c5b2. The backend session works in `.claude/worktrees/`; never edit `backend/`, `infra/` or `.github/`.
- Every task ends with the gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `NEXT_PUBLIC_API_MOCKING=off pnpm build`, `pnpm run preview`, and `pnpm e2e` once flows exist), an independent review on the Opus model, fixes, the gates again, and a commit. No attribution lines; nothing pushed.
- The house rules of the foundation hold: strict TypeScript, no literal strings in JSX, token utilities only, no en or em dash anywhere, `design-taste-frontend` before markup, write files with the Write and Edit tools.
- Build-order rule (docs/29 section 1.1): no deferred route gets a screen. Not in this plan: workspace delete and restore, leaving a workspace, project delete, invitation resend and decline, the invitation preview, `GET {W}/quotas`, the workspace logo upload, API keys, budgets.
- Fields that wait for backend step 4 (entities, on `backend/entities`): primary domain, default location and own brand in the new-project form and in project settings. They join in the entities plan; the form is built so they slot in without a rewrite.

## Scope

| Task | Result |
|---|---|
| 1 | Mocks for every route of this plan, with the API's rules, kept in a cookie so the server's mocks and the browser's agree |
| 2 | Settings groups by permission, and Project settings > General: name, slug, time zone, check day, language; pause, resume and archive |
| 3 | Workspace settings > General: name, slug, time zone |
| 4 | Workspace settings > Members and roles: the members table, role and project access changes, removal |
| 5 | Invitations: invite dialog, pending invitations, withdraw |
| 6 | New project (onboarding step 1) and its two entry points |
| 7 | New workspace for a platform operator |
| 8 | End-to-end and visual tests, docs, whole-branch review |

---

### Task 1: Mocks for workspace management

**Files:** modify `src/mocks/handlers/{index,projects}.ts`, create `src/mocks/handlers/workspaces.ts`, `src/mocks/handlers/members.ts`, `src/mocks/workspace-state.ts`, extend `src/mocks/fixtures.ts` (members of Digibranders are the fixture users; two pending invitations), tests in `src/mocks/handlers/handlers.test.ts`.

- [x] **Step 1:** A cookie `mock-workspace` (JSON, base64url) holds what this browser changed: created and edited projects, the workspace's name, slug and time zone, members' roles, project access and removals, sent and withdrawn invitations, and an operator's new workspace. Server and browser mocks read the same cookie, as `mock-name` does for the profile. Each handler answers with the fixture merged with the cookie and writes the new cookie.
- [x] **Step 2:** Handlers with the API's rules: `POST /workspaces` (operator only, `409 duplicate`, reserved slugs, `timezone_unknown`); `PATCH {W}` (`workspace:update`, `409 duplicate`); `GET {W}/members`, `PATCH` and `DELETE {W}/members/{user_id}` (`members:manage`, fresh session, only an owner grants or changes `owner`, `409 last_owner`, `project_unknown`, `scope_not_allowed`); `GET`, `POST {W}/invitations` (fresh for `owner` and `admin`, `409 duplicate` for a pending invitation or a member, the hourly limits) and `DELETE` (`409 invalid_state_transition`); `POST {W}/projects` (`projects:write`, `403` for a membership limited to some projects, `409 duplicate`, `422 quota_exceeded` at 10 projects, reserved slugs, `timezone_unknown`); `PATCH {P}` (`meta.warnings` with `timezone_change_applies_forward` when the zone changes).
- [x] **Step 3:** Tests: each route's success and each problem, the cookie round trip, and that the server mocks see a change the browser made.
- [x] **Step 4:** Opus review, fixes, gates, commit "Mock the workspace management routes".

Done differently, and why:

- The cookie holds base64url JSON checked against a zod schema (`mocks/workspace-state.ts`); a cookie of another shape is ignored, never trusted. `changesCookie` throws before the value passes 3,800 bytes, since a browser drops a larger cookie without a word. MSW already decodes request cookies, so nothing decodes them twice (a `%` in a saved name or project name no longer wipes the state).
- The rules follow the backend where it is more precise than doc 19: `scope_not_allowed` for owner and admin only; a project list is uuids, at most 500, stored once each and sorted; leaving the archive takes a slot of the plan (`422 quota_exceeded`); the plan is checked before the slug on create; an empty change is a 422; `null` on a member that refuses it is `null_not_allowed`; the fresh-session check comes before the owner-only check on invitations; when someone stops managing members, the invitations they sent are withdrawn (all of them; an owner who stops being one loses their owner invitations); `default_language_code` is two lower-case letters; `deep_check_weekday` 0 is Sunday; invitation addresses are kept as typed (trimmed, NFC) and compared without case.
- Time zones (`lib/format/time-zone.ts`): the API's pattern, a zone the runtime can format, and the API's table of renamed zones (`Asia/Calcutta` is stored as `Asia/Kolkata`); the list for pickers uses the current names. Slugs (`lib/slugs/slug.ts`): the API's pattern, its two reserved lists from the generated enums, and the hyphenated uuid form.
- The fixture's two pending invitations are dated relative to the start of the mocks, so they never expire during a session or a test run. A workspace an operator creates here has its owner only; its members cannot be changed, and its invitations are its own.

### Task 2: Settings groups and Project settings > General

**Files:** modify `src/features/account/settings-frame.tsx` (or move the frame to `features/settings`), create `src/features/project-settings/*`, route `src/app/[workspace]/[project]/settings/general/page.tsx`, messages `settings.*`, `projectSettings.*`.

- [x] **Step 1:** `SettingsNav` lists "Your account", then "Project settings" (General) and "Workspace settings" (General, Members and roles), in that order. Every member sees every section; a section the person may not change renders read-only with one `Banner` naming the missing permission (24 T4 states). `/settings` still opens Profile.
- [x] **Step 2:** General form with the `SaveBar`: name, slug (changing it moves the page to the new address after the save, and the switcher follows), time zone (searchable list of IANA zones, the browser's first), deep check weekday, default language. `PATCH {P}`; `409 duplicate` on slug; `timezone_unknown` on the zone; the `timezone_change_applies_forward` warning is a `Banner` after the save ("New business dates use the new time zone; past dates keep theirs").
- [x] **Step 3:** Status section: "Pause tracking" or "Resume tracking", and a danger zone with "Archive project" (an `AlertDialog`; an archived project leaves the list and its pages answer as before until the API changes that). No delete: deferred.
- [x] **Step 4:** Tests (each mutation's success and problem, read-only state for an analyst, the slug move), against the real API, Opus review, fixes, gates, commit "Add project settings: general and status".

### Task 3: Workspace settings > General

**Files:** `src/features/workspace-settings/general-*.tsx`, route `settings/workspace/page.tsx`.

- [x] **Step 1:** Name, slug and time zone through the `SaveBar` (`PATCH {W}`); a new slug moves every open page to the new address; `409 duplicate` on slug. Read-only with a `Banner` without `workspace:update`. The logo waits for an upload route.
- [x] **Step 2:** Tests, real API, Opus review, gates, commit "Add workspace settings: general".

### Task 4: Members and roles

**Files:** `src/features/workspace-settings/members-*.tsx`, route `settings/members/page.tsx`.

- [x] **Step 1:** Members table (32 px rows, 12-tables row anatomy): name and email, role, project access ("All projects" or "n projects"), two-factor, last active (both blank when the API sends null), and a row menu. Every member sees the table; the menu is there with `members:manage`.
- [x] **Step 2:** "Change role" and "Project access" in one dialog (role radio list with each role's description from 24 section 3; access "All projects" or a checklist of the workspace's projects). Only an owner sees `owner` as a choice and can change an owner. `PATCH` through `withFreshSession`; `409 last_owner` and `scope_not_allowed` as the dialog's alert.
- [x] **Step 3:** "Remove from workspace" (`AlertDialog`, `destructive-solid`), fresh session, `409 last_owner`. Removing oneself is not offered (leaving is deferred).
- [x] **Step 4:** Tests, real API, Opus review, gates, commit "Add members and roles".

### Task 5: Invitations

**Files:** `src/features/workspace-settings/invitations-*.tsx`.

- [x] **Step 1:** "Invite people" (dialog, 560 px): email, role, project access; fresh session when the role is owner or admin; `409 duplicate` on the email field ("already a member or invited"); the hourly limits as the dialog's alert with the wait. The invitation link is emailed by the API; the dialog never shows it.
- [x] **Step 2:** Pending invitations under the members (email, role, access, invited by, expires), with "Withdraw" (`AlertDialog`). `409 invalid_state_transition` refreshes the list and says it was already used or expired.
- [x] **Step 3:** Tests, real API, Opus review, gates, commit "Add invitations".

Done differently in Tasks 2 to 5, and why:

- One commit for Tasks 2 to 5: the settings navigation lists all three groups, so its first commit needs the sections it links to. Tasks 3 to 5 had one Opus review together, after Task 2's own.
- `SettingsFrame` moved to `features/settings` (it owns every group). `Banner` (`components/app/status/banner.tsx`) is new: tone, placement, lead, at most two actions, a live role only for one that appears during the session. `TimeZoneCombobox` (`components/app/forms`) lists the runtime's zones by their current names, the browser's first, with today's abbreviation. Languages (`lib/format/language.ts`) are a list of 20 two-letter codes named through `Intl.DisplayNames`, plus the project's own code when the API holds another. The project fields shared by settings and the new-project form are `lib/projects/fields.ts`.
- Saves follow the profile form: only the fields that changed are sent, `form.reset` with the saved values (no `keepDirtyValues`: react-hook-form keeps stale `dirtyFields` with it, and the real API may return the same row), a polite announcement, `router.refresh()` so the shell shows the new name, and `router.replace` to the new address when the slug changed. A failure of the whole form takes focus. A second Enter during a save is ignored in the form's `onSubmit` (the mutation's state lags a render). The time-zone warning (`timezone_change_applies_forward`) is announced with the save and shown as a `Banner`; a save that also moves the page keeps only the announcement.
- Project status: pause and resume run at once; archive asks (`ConfirmDialog`) and then opens the workspace's list, since the project layout answers 404 for an archived project. A member who may not change the project sees its values and its tracking state read-only, with one `Banner`.
- Members: 40 px rows; the menu has "Change role and access" and "Remove from workspace" (not on one's own row: leaving is deferred); an owner's row is disabled for an admin with the reason. The dialog sends only what changed (an unchanged project list is not judged again by the API), counts projects the member keeps that the list no longer shows (archived or deleted), and refreshes the page after a change to one's own role. Project restriction has a UI already, although doc 24 section 3.1 places it in Phase 12: the API has it, and an agency needs it for client access from the start.
- Removals and withdrawals hand focus to the section's heading through the new `finalFocus` of `ConfirmDialog`, since the row and its button are gone. A member or invitation that someone else removed meanwhile (`404`, or `409 invalid_state_transition`) closes the dialog with a toast and refreshes the list. A change to a member refreshes the invitations too: the API withdraws what someone sent when they stop managing members.
- Invitations are a section of their own under Members and roles, for `members:manage` only (the API lists them to those members alone). Inviting an owner or admin asks "Confirm it is you" when the session is not fresh.
- Not done: the real-API walkthrough of Tasks 2 to 5 is done once for the branch in Task 8. A second refusal after "Confirm it is you" is passed through by `withFreshSession` and the dialogs treat it as a cancel; telling the two apart is an open point for the fresh-session helper.

### Task 6: New project

**Files:** route `src/app/[workspace]/onboarding/page.tsx`, `src/features/onboarding/*`, modify `features/projects/project-list.tsx`, `components/app/shell/project-switcher.tsx`, `features/shell/project-shell.tsx`.

- [ ] **Step 1:** Full page in the workspace shell, "New project", step 1 of the wizard of 20 section 5.1 only: name, slug (suggested from the name until edited, checked against `ReservedProjectSlug`), time zone (the browser's), default language, deep check weekday. "Create project" (`lg`) creates it and opens the project. `409 duplicate` on slug, `422 quota_exceeded` as a form alert with the limit, `403` for a member limited to some projects (the entry points are absent for them).
- [ ] **Step 2:** Entry points, absent without `projects:write` or with a restricted membership: "New project" in the workspace page header, "Create project" at the foot of the project switcher. The empty list's creator sentence links to it.
- [ ] **Step 3:** Tests, real API, Opus review, gates, commit "Add the new project page".

### Task 7: New workspace for an operator

**Files:** route `src/app/(auth)/new/page.tsx` (`new` is a reserved workspace slug), `src/features/session/*`.

- [ ] **Step 1:** For `user.is_platform_operator`: the home screen without a workspace offers "Create workspace", and the account menu has it too. The page asks for name, slug and time zone (`POST /workspaces`); the operator becomes owner and lands on the new workspace. `409 duplicate`, `429 rate_limited` (5 a day), `403 email_not_verified`. Anyone else gets the 404 page.
- [ ] **Step 2:** Tests, real API (the walkthrough account is an operator only if the backend seed makes it one; otherwise mocks only, and say so), Opus review, gates, commit "Add workspace creation for operators".

### Task 8: End-to-end, visual, documents, review

- [ ] **Step 1:** Playwright flows: an owner invites a member and withdraws the invitation, changes a role through the re-authentication dialog, creates a project and lands on it, renames the workspace and follows the new slug; an analyst sees read-only settings; axe on every new page in both themes. Visual specs for the new pages.
- [ ] **Step 2:** Docs: 20 sections 3.2 and 5.19 as built, 11 section 5 (which groups exist), the review log, the open points below.
- [ ] **Step 3:** Whole-branch Opus review, fixes, gates; tell the user the branch is ready; merge on their word.

---

## Open points

| Point | Who | Needed by |
|---|---|---|
| Is the walkthrough account an operator in the backend seed, or can the seed make one? | backend session | Task 7 |
| An account route that needs no project (Account settings from the workspace page goes to the first project's settings) | frontend, settings plan | later |
| Primary domain, default location and own brand in the new-project form | backend step 4 | the entities plan |
