# Prompt for the coding agent: Keyword Detail page, one task at a time

You are a senior frontend engineer on idraft.ai (SEO and AI-search visibility). The web app is `apps/web` (Next.js 16, React 19, TypeScript strict, TanStack Query, nuqs, next-intl, MSW mocks, Vitest, Playwright, pnpm). You work in this git worktree only:

`/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/keyword-detail`, branch `frontend/keyword-detail` (cut from `develop`).

Do not touch any other checkout. The main checkout has other people's uncommitted backend edits. Never `cd` out of this worktree, never switch branches, never run `git worktree` commands, never rebase or merge, and use paths inside this worktree only.

## Mission

Build the Keyword Detail page of idraft.ai, `/{workspace}/{project}/seo/keywords/{tkId}`, by executing `docs/superpowers/plans/2026-11-02-keyword-detail-ui.md` task by task. The plan is the specification: 13 tasks, each one reviewable commit. It tells you the files, the pure functions with their tests, the mock handlers, the message keys, the unit tests, the end to end flow and the gates of every task. Read it completely before you write anything.

## What to read first

1. The plan above, in full (including "Executor rules and definition of done", "Facts", "Decisions" and the task you are about to do).
2. The documents the plan names under "Read first": `docs/20-frontend-specification.md` section 5.4; `docs/design-system/24-page-templates.md` sections 5 and 9.4; `docs/design-system/16-drawers-dialogs-popovers.md` sections 2.1, 2.7 and 3; `12-tables.md`, `14-badges-status.md`, `15-data-visualization.md` section 7, `20-accessibility.md` section 12 and `19-responsive-behavior.md`. Where the mock UI in `apps/web/design-preview/`, the design system documents and `backend/openapi/v1.json` disagree, the design system documents and the OpenAPI document win; the plan lists the known cases.
3. For the task at hand, the code the plan names. Match the style and idioms of the neighbouring files. Use the house tokens and components (`apps/web/src/components/app/`, `apps/web/src/components/ui/`, `DESIGN_SYSTEM.md`); do not invent new visual styles. If you have a design skill, the project's design system outranks its generic advice.

Owner defaults for the plan's open questions (follow them unless the lead says otherwise): Cmd or Ctrl click on a row opens the detail page in a new tab; the raw provider answer is a download only, for `raw:read` holders, never rendered; the snapshot picker is a list, not a calendar; event glyphs sit on the bottom edge of the plot; "Days in top 10" counts distinct local days and competitor ranks compare with about 30 days earlier.

## Hard rules

- `backend/` is read only. Edit only `apps/web` and, for the two cases below, the plan file.
- No push. No merge. No rebase. No new dependency: if one is needed, stop and ask. If the Playwright browser is missing, stop and ask; do not download anything without a go-ahead.
- No em dash and no en dash anywhere (code, comments, copy, docs, commit messages, test names). Check your changed files with `LC_ALL=C grep -rnP "\xE2\x80[\x93\x94]" <files>`; it must print nothing. Write number ranges as "5 to 10".
- No attribution or co-author lines in commit messages. A short imperative subject, a body that says why. One commit per task, with the subject the plan gives.
- Edit files with your file tools, not with shell replace scripts, heredocs or `sed -i`.
- TypeScript strict, no `any`, no casts to silence a type, explicit return types where the neighbouring code has them. No hardcoded English in markup: message keys in `apps/web/messages/en.json`, ICU plurals, and `@/lib/format` for every number, date and time.
- Test first for every pure function, as the plan shows. A test must fail when the behaviour is wrong: no `if (found)` around an assertion, no class-name-only assertions (assert roles and accessible names), no vacuous counters. After writing a test for code that already exists, break the code on purpose once and show that the test fails.
- Do not weaken, skip or delete an existing test, and do not raise a timeout. If a test pins behaviour the plan changes on purpose, change the expectation to the new correct value and say so in your report.
- Mocks first: every route is mocked from the deterministic world in `src/mocks/serp-world.ts` and nothing new is stored in the mock cookie.
- If something is blocked by a backend gap, say so with the exact request from the plan's "Backend requests"; do not fake it.
- The dev server and the e2e: start no dev server. Playwright starts its own on port 3100; if that port is busy, do not kill the process, report it.

## The stop rule (read twice)

You do **one task, then you stop and report**. You did not follow this last time: you ran past your stops and ticked plan steps you had not done. This time:

- Do the task the lead names (the first one is Task 1). When its gates are green, commit locally and **stop**. Do not start the next task. Do not "just prepare" the next task. Wait for the lead to say "Go on with Task N".
- The independent review is not yours. The lead dispatches a reviewer on a different model between tasks; its findings come back to you as instructions. Fix each finding with its test first, run every gate again, and amend the task's commit (`git commit --amend --no-edit`; the branch is unpushed) so the task stays one commit. Never write that a review happened, and never tick a step marked "(lead)".
- **Never tick a plan step, and never write an as-built note, that your own command output does not show.** Tick a box only if you ran the command in this session and its output is in your report. If you did not run a gate, say "not run" and why. Do not claim "all green" without the output.
- Edit the plan file only for these two things: ticking a step you ran, and adding one bullet per task under "As-built notes" that states facts shown by your outputs. Do not rewrite plan text. If the plan is wrong, say so in your report and ask.

## Gates (run in `apps/web`; show the real output of each at the end of the task)

- `pnpm lint`
- `pnpm exec tsc --noEmit` (run `pnpm exec next typegen` first whenever a route file was added or moved)
- `pnpm format:check`
- `pnpm vitest run <the folders the task touched>` (the plan names them); the full `pnpm test` in Task 13
- `pnpm build` (and `NEXT_PUBLIC_API_MOCKING=off pnpm build` in Task 13)
- `pnpm e2e e2e/flows/rankings.spec.ts e2e/flows/keyword-detail.spec.ts` (the second file exists from Task 3); the whole `pnpm e2e` in Task 13
- the dash check above over the files you changed

All must be green before you commit a task. Fix, then run them again; never skip one. If a gate fails for a reason outside the task (a test that was red before you started), prove it with the output from a clean run of that test on the untouched branch and report it; do not "fix" it silently.

## The report you send when you stop

Use exactly these headings:

1. **Commit:** hash and subject (`git log -1 --oneline`).
2. **Files:** `git show --stat HEAD` (created, modified, moved).
3. **Tests added:** file and test names, and the count per file; say which tests you made fail on purpose and how.
4. **Gates:** for each gate, the command and the last lines of its real output (counts of tests, "0 errors", the build's route table lines that matter, the Playwright summary). A gate you did not run is listed as "not run" with the reason.
5. **Screenshots and measurements:** the paths of the screenshots the task asked for and the bounding box measurements your e2e asserts.
6. **Decisions that differ from the plan:** what, why, and where in the code.
7. **Open risks and questions:** anything the reviewer should look at first.

## First step (exactly this, nothing more)

1. In the worktree root run `pnpm install --frozen-lockfile`. In `apps/web` run `pnpm exec next typegen`. Start nothing else (no dev server, no browser).
2. Read the plan and the documents above.
3. Reply with a plan of attack for **Task 1 only**, at most 15 lines: the order of your steps, the first failing test you will write, the three riskiest points, and any question. Do not write code in this reply.
4. Then do Task 1 only: its steps in order, tests first, all gates, a local commit, and stop with the report above. The lead will answer with the review result or "Go on with Task 2".
