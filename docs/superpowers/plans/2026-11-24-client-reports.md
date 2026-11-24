# Client reports: guest link and scheduled email (roadmap feature 1)

Date: 2026-11-24. Branch `feat/client-reports` (worktree `.claude/worktrees/client-reports`), lands in `develop`.
Roadmap: `2026-11-24-seranking-high-value-roadmap.md`. Spec seed: `docs/ai-visibility/work-packages/WP-51-reports.md`
(its D-29 gate is open: the owner chose to build this on 2026-11-24).

## What it is

An agency user opens **Reports** (navigation entry `reports`, now `live`), picks a project, and:

1. makes a **guest link** to a read-only report of that project's AI visibility, copies it once, and can revoke it;
2. adds a **schedule**: the same report emailed weekly or monthly to up to 10 addresses, each email carrying a fresh
   guest link.

The guest page needs no sign-in. It shows four blocks for the last 28 project-local days: headline numbers per
engine (Mentioned, Cited, Share of voice, each with its count), a weekly trend per engine, the tracked competitors, and
the most cited domains.

## What exists, and is reused

| Need | Reuse |
|---|---|
| Token, hash only, expiry, revoke, audit, public no-store read, throttle | `client_summary_shares` pattern (migration 0029, `internal_links/shares.py`, `public_summary.py`, `public_summary_routes.py`). Copied, not generalised: a report token must never open the crawl summary |
| Mail | `providers/email.py` (`EmailSender`: console, Resend, Brevo, chosen by `EMAIL_PROVIDER`). The API already builds one; the worker builds the same one from the same settings |
| Numbers | `SummaryService.summary` (totals, weekly series, entities), `CompetitorService.overview`, `CitationBoardService` pages, read as a viewer limited to the one project (as `public_summary._access`) |
| Scheduled job | `queues.register_scheduled` in `worker/assembly.py` |

## Decisions (settled by defaults; the owner can reverse any of them)

- **D1 Mail sender: the existing `EmailSender`.** No new provider. Production uses whatever `EMAIL_PROVIDER` is.
- **D2 No password on a guest link.** The token is 32 random bytes, only its hash is stored, it expires (7, 30 or 90
  days, never "never") and a person can revoke it. A password would be a second secret for the client to lose; add one
  later only if an agency asks (a nullable `password_hash` column, one more step on the guest page).
- **D3 No costs.** The report holds no spend, budget, unit cost, provider or run id. No prompt text, no answer text and no
  other project's data. Branded prompts are left out, as on the Overview default.
- **D4 Window.** Always the 28 days ending today in the project's zone, read live while the link works.
- **D5 Schedules.** Weekly (Monday) or monthly (the 1st), 06:00 UTC. At most 10 recipients and 10 schedules per project.
  Each send makes one share that expires in 30 days and emails the same link to every recipient. A failed send is
  recorded and not retried the same day. A schedule can be paused and deleted. Deleting a schedule does not revoke the
  links already sent (revoke is its own action, on the links list).
- **D6 Permission.** `projects:write` makes and revokes links and manages schedules; `data:read` lists them. Same as the
  internal links shares.
- **D7 Rate limit.** 30 a minute per address, 120 an hour per link, as the client summary.

## Backend

1. Migration `0036`: `core.ai_report_shares` (as `client_summary_shares`) with the definer lookup
   `core.ai_report_share_by_token`, and `core.ai_report_schedules` (`id`, `workspace_id`, `project_id`, `frequency`
   weekly or monthly, `recipients text[]`, `paused`, `next_run_at`, `last_sent_at`, `last_error`, `created_by`,
   `created_at`), RLS and grants (the worker role may select and update schedules and insert shares).
2. `api/reports/`: schemas, `ReportShareService` (create, list, revoke), `ScheduleService` (create, list, update, delete),
   `ClientReportService` (the public read), routes under `/projects/{project_id}/reports/shares` and `.../schedules`, and
   `GET /public/reports/{token}`.
3. `worker`: scheduled job `report_digest` every 15 minutes: claim due schedules (`FOR UPDATE SKIP LOCKED`), make the
   share, send, set `next_run_at`.
4. Tests: share expiry, revoke, hash only, cross-tenant 404, response schema holds no forbidden field, schedule limits,
   digest sends once, a failed send is recorded; route access and cross-tenant registries.
5. OpenAPI regenerated, `pnpm gen:api`.

## Design preview (first, mock data)

`apps/web/design-preview/reports.js` and a `#/reports` route: project's links list (copy once, revoke), a schedule
list with an add dialog, and the guest page as a modal preview reachable from a link row.

## Real app

`features/reports/` (page with two sections, dialogs, hooks), `app/[workspace]/reports` route, public page
`app/(public)/public/reports/[token]`, strings under `reports` in `messages/en.json`, registry entry to `live`.

## Words (glossary)

Reports, Mentioned, Cited, Share of voice, competitors, "Your brand" in sentences, the real brand name in the report.
No em-dashes or en-dashes in any string.

## Done means

Targeted backend and web tests, lint and typecheck pass, the guest page and the Reports page are checked in a browser,
and an independent review on the Opus model finds nothing open.
