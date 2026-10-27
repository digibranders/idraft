# Workspaces, Members, Invitations and Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with: gates green (`backend/check.sh`), an independent review on the Opus model, fixes, commit.

**Goal:** A signed-in user can work inside a workspace: create one, invite people, manage their roles, and create projects. Every route declares who may call it, and another workspace's data is never visible.

**Architecture:** Step 1 of the build order (`docs/29-phase-roadmap.md` section 1.1). One dependency resolves the caller's membership for the workspace in the path and checks project scope and the route permission; handlers then work inside `workspace_transaction`, so row-level security backs every query. Each area is a small package (`repository`, `service`, `routes`) next to the existing `idraft.api.auth`. No migration: every grant and policy needed already exists (doc 04 section 13.1).

**Tech stack:** FastAPI, Pydantic v2, SQLAlchemy 2 Core on asyncpg, PostgreSQL 18 row-level security, Redis (rate limits), pytest with Testcontainers.

---

## Scope

Built here (doc 19 sections 3.2.1, 3.2.2, 3.3):

| Method | Path | Access |
|---|---|---|
| GET | `/api/v1/workspaces` | authenticated |
| POST | `/api/v1/workspaces` | authenticated (verified email; platform operator while registration is by invitation) |
| GET | `{W}` | member |
| PATCH | `{W}` | `workspace:update` |
| GET | `{W}/members` | member |
| PATCH | `{W}/members/{user_id}` | `members:manage` fresh |
| DELETE | `{W}/members/{user_id}` | `members:manage` fresh |
| GET | `{W}/invitations` | `members:manage` |
| POST | `{W}/invitations` | `members:manage` |
| DELETE | `{W}/invitations/{invitation_id}` | `members:manage` |
| POST | `/api/v1/invitations/accept` | authenticated (invitee email, verified) |
| GET | `{W}/projects` | member |
| POST | `{W}/projects` | `projects:write` |
| GET | `{P}` | member |
| PATCH | `{P}` | `projects:write` |

Deferred to launch hardening or to the phase that needs it (added to doc 29 section 1.1): workspace delete and restore, leave workspace, invitation resend, decline and preview, `GET /roles`, quotas, audit log reads, project delete, project settings routes (arrive with the keyword system, which is the first reader), list filters other than project status, `If-Match` on PATCH, `primary_domain`, `default_location_id` and `own_entity` on a project (Phase 2 creates the tables they point at), `two_factor_enrollment_required`.

## Decisions

- **D1. Accept by token, not by id.** Doc 19 had `POST /api/v1/invitations/{invitation_id}/accept`. The invitee is not yet a member, so row-level security hides the invitation row; the only lookup the database offers is `auth.invitation_by_token(token_hash)`. The route becomes `POST /api/v1/invitations/accept` with `{ token }`, the token from the link `{origin}/invite#token=<token>`. Doc 19 is updated.
- **D2. Invitation cancel is built now**, although doc 29 listed it as deferred: an invitation sent to the wrong address must be revocable, and it is one UPDATE. Resend and decline stay deferred.
- **D3. Membership is read from the database on every workspace request**, never cached, so a removed member loses access at once and a cached session never widens membership (cross-tenant case XT-05). The query also requires the user not to be disabled and the workspace not to be `deleting`.
- **D4. Order of checks** (doc 19 section 2.2): session (401), membership (404), project scope (404), permission (403), fresh session (403), then the body (422). A dependency that raises runs before body validation, so another tenant's id never produces a 422.
- **D5. Who may create a workspace.** Verified email always. While `REGISTRATION=invited`, platform operators only (carried item F13): an invited client must not be able to open a second workspace and spend on it. `/me` gains `user.is_platform_operator` so the web app can hide the action.
- **D6. Owners.** Only an owner may grant `owner`, invite an owner, or change or remove an owner. The last owner cannot be demoted or removed (`409 last_owner`), checked under one lock per workspace (its row, `FOR NO KEY UPDATE`) that every membership change and every invitation takes first. Owners and admins always have every project (`project_ids` must be null for them).
- **D7. Project scope.** A member limited to some projects sees only those in lists and gets 404 for the others. Creating a project needs `projects:write` and an unrestricted membership: a restricted member could not see what they created.
- **D8. Slugs.** 3 to 40 characters, lower-case letters, digits and hyphens, starting and ending with a letter or digit. Reserved words are refused; the two lists are enums in the OpenAPI document (`ReservedWorkspaceSlug`, `ReservedProjectSlug`) so the web forms validate against the same values.
- **D9. Time zones are validated against PostgreSQL** (`pg_timezone_names`), because PostgreSQL computes the business dates.
- **D10. Audit.** Every change writes one row to `ops.audit_logs` in the same transaction, with the workspace, the actor, `before` and `after`. Actions: `workspace.created`, `workspace.updated`, `member.updated` (role or scope), `member.removed`, `invitation.created`, `invitation.cancelled`, `invitation.accepted`, `project.created`, `project.updated`.
- **D11. Every route declares its access** through a marked dependency (`public`, `authenticated`, `member`, a permission key, optionally `fresh`). `tests/api/test_route_access.py` walks `app.routes` and compares each route with a table in the test, so a new route without a declaration, or a changed one, fails.
- **D12. Invitation emails are limited** per hour to 20 per inviter, 50 per workspace and 3 per invited address. The email is plain text, and the workspace and inviter names are reduced to letters, digits, spaces, apostrophes and hyphens, because the message goes to a third party.

## File structure

| File | Responsibility |
|---|---|
| `backend/src/idraft/api/access.py` | `AccessRule`, the `declare` marker, `public`, `route_access(route)` |
| `backend/src/idraft/api/audit.py` | `record(db, ...)`: one workspace audit row |
| `backend/src/idraft/api/pagination.py` | `OffsetParams`, `OffsetPageInfo`, `strict_query(*names)` |
| `backend/src/idraft/api/slugs.py` | Slug pattern and the two reserved lists |
| `backend/src/idraft/api/workspaces/access.py` | `WorkspaceAccess` |
| `backend/src/idraft/api/workspaces/dependencies.py` | `workspace_member`, `require_permission` |
| `backend/src/idraft/api/workspaces/repository.py` | SQL for workspaces, memberships, invitations |
| `backend/src/idraft/api/workspaces/service.py` | Workspace and member rules |
| `backend/src/idraft/api/workspaces/invitations.py` | Invitation rules and the invitation email |
| `backend/src/idraft/api/workspaces/routes.py` | The workspace, member and invitation routes |
| `backend/src/idraft/api/projects/{repository,service,routes}.py` | Projects |
| `backend/src/idraft/api/schemas/{workspaces,projects}.py` | Request and response models |
| `backend/src/idraft/db/tables.py` | Adds `core.projects`, `core.workspace_quotas`, `ops.audit_logs` |
| `backend/tests/api/test_route_access.py` | The access table |
| `backend/tests/api/workspaces/`, `backend/tests/api/projects/` | Route tests |
| `backend/tests/security/test_cross_tenant.py` | XT-01 to XT-05 for every workspace route, from `app.routes` |

## Tasks

### Task 1: Access layer

- [ ] Tests first (`tests/api/test_route_access.py`, `tests/api/workspaces/test_access.py` with probe routes): no cookie is 401; a non-member, a member of a `deleting` workspace and a disabled user get 404; a project outside the member's scope is 404 even without the permission; a member without the permission gets 403; a permission marked fresh without a fresh session gets `fresh_session_required`; every route of the app has a declared access and matches the table.
- [ ] `access.py`, `workspaces/access.py`; mark the existing session dependencies; add `public` to the auth and health routes that take no session.
- [ ] `pagination.py` with tests: defaults, bounds, unknown query parameter is `422 validation_failed` naming the parameter.
- [ ] `tables.py`: `projects`, `workspace_quotas`, `audit_logs`; `tests/db/test_tables.py` covers them. `audit.py` with a test that the row carries workspace, actor, request id, and that a row for another workspace is refused by the policy.
- [ ] New problems: `email_not_verified` (403), `last_owner` (409), `invalid_state_transition` (409), `invitation_expired` (410), `quota_exceeded` (422).
- [ ] Gates, Opus review, fixes, commit.

### Task 2: Workspaces

- [ ] Tests first: list shows only the caller's workspaces; create makes the caller owner, writes the quotas row and the audit row; unverified is 403 `email_not_verified`; not an operator while invited is 403; duplicate slug is 409 without leaking an id; reserved and malformed slugs are 422; unknown time zone is 422; PATCH needs `workspace:update`, records before and after; `/me` reports `is_platform_operator`.
- [ ] `slugs.py`, `schemas/workspaces.py`, `workspaces/repository.py`, `workspaces/service.py`, routes, wiring in `resources.py` and `main.py`; the reserved enums in the OpenAPI document.
- [ ] Gates, Opus review, fixes, commit.

### Task 3: Members

- [ ] Tests first: list (any member) with page info; role change and removal need `members:manage` and a fresh session; an admin cannot touch an owner or grant owner; the last owner cannot be demoted or removed, including two concurrent demotions of two owners; `project_ids` must be projects of the workspace and null for owner and admin; a removed member gets 404 on the next request; audit rows.
- [ ] Repository, service, routes.
- [ ] Gates, Opus review, fixes, commit.

### Task 4: Invitations

- [ ] Tests first: create sends one email with a fragment link and stores only the hash; duplicate pending invitation and existing member are 409; an expired pending invitation can be replaced; only an owner invites an owner; rate limits; list shows `expired` for a stale pending row; cancel; accept by token (wrong email, unknown, cancelled: 400 `invalid_token`; expired: 410; unverified: 403; success creates the membership with role and project scope, marks the invitation accepted, is safe to repeat; two concurrent accepts create one membership); registration with the token followed by accept joins the workspace.
- [ ] `workspaces/invitations.py`, routes.
- [ ] Gates, Opus review, fixes, commit.

### Task 5: Projects

- [ ] Tests first: list is limited to the member's scope and to `active,paused` by default, `filter[status_in]` widens it; create needs `projects:write` and an unrestricted membership, respects `max_projects` (422 `quota_exceeded` with `limit` and `used`) including under concurrency, duplicate slug in the workspace is 409 while the same slug in another workspace is fine; get and patch honour scope; patch records before and after, sets `updated_at`, warns on a time zone change.
- [ ] `schemas/projects.py`, `projects/` package, wiring.
- [ ] Gates, Opus review, fixes, commit.

### Task 6: Cross-tenant suite, document, docs

- [ ] `tests/security/test_cross_tenant.py`: routes from `app.routes`; workspaces A and B with colliding slugs for projects; XT-01, XT-02 (checksum of tenant tables unchanged), XT-03, XT-04, XT-05.
- [ ] Regenerate `backend/openapi/v1.json`.
- [ ] Docs: 19 (accept route, what is deferred), 24 (enforcement text), 29 section 1.1 (deferred list), 31 (ticks), `review-log.md`, `backend/README.md`.
- [ ] Whole-branch Opus review, fixes, image smoke test, commit.

## Execution notes

Decisions made while building, each the result of a task review (all on the Opus model):

- **Unknown query parameters** are refused by the `public` and session dependencies, after the session check, not by an application-level dependency: an anonymous caller of a protected route gets 401 whatever the query says.
- **The access label** of a route reports every requirement (each permission, `fresh`), so dropping one of two changes the table.
- **A suspended workspace** can be read and not changed (`403 workspace_suspended`).
- **Time zones** are `UTC` or `Area/Location`; legacy names browsers report are stored by their current name. This matters here: a browser in India reports `Asia/Calcutta`.
- **Row locks are `FOR NO KEY UPDATE`**, so a change to a workspace or project neither waits for nor blocks inserts that reference it.
- **Workspace creation is limited** to 5 per user per day.
- **More words are reserved as workspace slugs**, and a slug cannot look like a uuid.
- **Membership changes take one lock per workspace.** Locking the owner rows deadlocked when an owner was promoted while another change waited.
- **`two_factor_enabled` and `last_active_at`** are shown to those who manage members and to the member themself.
- **Pending invitations a member sent are withdrawn** when they are removed or demoted below admin.
- **An empty project scope** is a member of no project.
- **What an invitation grants is judged again when it is accepted**: the sender must still be a member in good standing who could grant that role. Inviting an owner or admin needs a fresh session.
- **Accepting returns the workspace** as well as the membership, so the web app knows where to send the user.
- **The invitation email** opens with a sentence of ours and shows the workspace, the inviter, the invited address and the role as labelled lines.
- **An email address has one spelling**: it is normalised (NFC) when it is read from a request.
- **A request that waits for a lock** gives up after 3 seconds and is answered `409 conflict`; a statement that runs into its timeout is `503 query_timeout`. Both were 500 before.
- **The project limit counts active and paused projects.** Archiving frees a slot and reviving needs one, so a workspace at its limit has a way out while delete is not built.
- **"Not limited to some projects"** is a declared requirement of the create route (`projects:write every-project`), checked before the body.
- **Final review.** An email address is normalised before its length is checked (composing can lengthen it). The workspace allowance counts only what is created, and the three invitation allowances are counted together or not at all (one Lua script), so running into one never uses up another. A partial update's fields that refuse null are not nullable in the API document (`Patch` in `schemas/common.py`). Invitations withdrawn by a demotion or removal are recorded, and an owner's invitations for the owner role are withdrawn when they stop being an owner. Path parameters come from a known set, and the cross-tenant suite checks the project scope on every route that names a project.
- **Confirmation review.** Normalising is slow on long runs of accents, and ran on the whole input: nothing longer than four times an address is normalised now. An error body's optional members have no default in the API document, so a generated client types them as optional. The profile update follows the same null rules as the others. A withdrawal caused by a demotion or removal says so in its audit entry and leaves expired invitations alone.
