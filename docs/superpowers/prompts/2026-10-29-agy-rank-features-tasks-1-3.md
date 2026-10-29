# Prompt for the coding agent: Rank features, tasks 1 to 3

You are a senior frontend engineer on idraft.ai (SEO and AI-search visibility). The web app is `apps/web` (Next.js 16, React 19, TypeScript strict, TanStack Query, nuqs, next-intl, MSW mocks, Vitest, Playwright). You work in this git worktree only: `/Users/a12345/Desktop/AI/idraft/.claude/worktrees/frontend-keywords-followups`, branch `frontend/keywords-followups`. Do not touch any other checkout.

## Mission

Implement Tasks 1, 2 and 3 of `docs/superpowers/plans/2026-10-29-rank-features-ui.md` (SERP features column and filters, AI Overview column and filter, target URL match marker), in that order. The plan is the specification. Read it completely first, then the documents it names under "Read first" (the rank columns plan `docs/superpowers/plans/2026-10-06-rank-columns-ui.md`, the executor rules in `docs/superpowers/plans/2026-10-01-keywords-ui.md`, and the design system documents it cites). The built visual mock is `apps/web/design-preview/` (open `index.html`); each task in the plan names its mock files. Where the mock, the design system documents and the API disagree, the design system documents and `backend/openapi/v1.json` win; the plan lists the known cases.

Owner defaults for the plan's open questions: ship the strip with counts only (not your concern in tasks 1 to 3); one column per SEO competitor (not yet); include the "SERP feature you own" chip (`featown`); Check now always at each keyword's daily depth; rank history fixed 90 days.

## Hard rules

- Backend, `backend/`, is read-only. Edit only `apps/web` and, for the plan's as-built notes, the plan file.
- No em dash and no en dash anywhere (code, comments, copy, docs, commit messages). Check with `LC_ALL=C grep -rnP "\xE2\x80[\x93\x94]" <changed files>`; it must print nothing.
- No attribution or co-author lines in commit messages. Short imperative subject, a body saying why. One commit per task at least.
- Do not push. Do not merge. Do not add dependencies; if one is needed, stop and report.
- Edit files with your file tools, not shell replace scripts.
- TypeScript strict, no `any`, explicit return types where the surrounding code has them, match the style and idioms of the neighbouring files. Use the house tokens and components (see `apps/web/src/components/app/` and `DESIGN_SYSTEM.md`); do not invent new visual styles.
- Test first for the pure logic, as the plan shows. Every task adds unit tests; e2e where the plan says so.

## Gates (run in `apps/web`, show real output excerpts at the end of each task)

`pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm test` (unit), `pnpm format:check` if the repo has it, `pnpm build`, and the e2e command the plan names. All must be green before you commit a task. Fix, then re-run, never skip.

## Reporting

After each task stop and report: commit hash and subject, files changed, tests added, gate outputs, anything you decided differently from the plan and why, and open risks. Then continue to the next task unless a gate fails and the fix would change behaviour outside the plan; in that case stop and ask.
