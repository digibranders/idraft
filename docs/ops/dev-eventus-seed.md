# Seed Eventus Security AI prompt tracking (development database only)

One command makes the Eventus Security AI prompt tracking project in your development database from
`fixtures/ai-prompts/eventus-security.json`: the project, the brand and its 8 competitors, 29 topics, the
ChatGPT and Gemini engines in India, the UAE and Saudi Arabia, and 72 prompts. It makes no answers, and it
leaves its AI answer schedules paused.

The seed only creates what is missing. It never overwrites a value a person set (a project, entity, prompt,
engine or topic), and it reports each difference it finds instead of fixing it. The one thing it undoes on
purpose is a resumed AI answer schedule: it pauses it again, so nothing spends by itself.

All commands run from `backend/`.

## Before you run it (once)

### Step 0: migrate the development database

The dev database (the container `idraft-dev-postgres-1`, `127.0.0.1:54329`) is on revision 0017. AI prompt
tracking needs 0018 and later (the `ai` schema). Apply them from a checkout that has those migrations:

```bash
uv run --env-file .env.migrator python -m idraft.db.migrate
```

This is the command `backend/README.md` gives for the dev stack. It runs as the `migrator` role and takes an
advisory lock, so a second run waits. It changes the development database, so run it yourself, when the
other sessions that use that database are not in the middle of a test.

### Step 1: create the workspace `digibranders` in the app

The development database has no workspace `digibranders`. The seed never creates a user or a workspace: you
create it in the app, with your own account.

1. Start the API and the web app as `backend/README.md` describes, and sign in at `http://localhost:3000`.
2. Create a workspace named `Digibranders` and check its slug on the workspace settings page. If the slug is
   not `digibranders`, pass `--workspace <slug>` to the seed.

The seed acts as the most recently created active owner of that workspace, so that owner must exist. Every
audit entry it writes names that owner as the actor and `python -m idraft.cli seed-eventus` as the user agent.

### Step 2: load the three countries

The seed never creates a location. It needs India, the UAE and Saudi Arabia as active countries. Copy the
worker settings once (`cp .env.worker.example .env.worker`), then load them with the saved list that holds
exactly those three:

```bash
uv run --env-file .env.worker python -m idraft.worker.sync_locations \
  --from-file tests/fixtures/dataforseo/locations-india-gulf.json
```

The ids are the Google Ads geo target ids that DataForSEO uses: India 2356, United Arab Emirates 2784 and
Saudi Arabia 2682. With DataForSEO credentials in `.env.worker` you can load the full free list instead (no
`--from-file`), which is the better source. Without credentials and without `--from-file` the command prints
`No DataForSEO credentials, so there is nothing to sync.` and exits 1.

What it prints depends on how many other locations your database has active (not India, the UAE or Saudi
Arabia). The sync writes the three, then counts the active locations that DataForSEO maps. A list shorter
than half of that count is not trusted and deactivates nothing (`_DEACTIVATE_FROM_SHARE` in
`collectors/locations.py`), so the cut is at more than 3 other active locations:

| Other active locations | It prints | What it did |
|---|---|---|
| 0 (an empty database, or one with India only) | `3 locations, 0 skipped, 0 deactivated` | Nothing to deactivate. |
| 1 to 3 | `3 locations, 0 skipped, N deactivated`, N above 0 | The three-country list was trusted and switched those N off. They are deactivated, not deleted. |
| 4 or more, for example the 8 non-India locations of the 9 test locations that `backend/README.md` loads from `tests/fixtures/dataforseo/locations.json` | `3 locations, 0 skipped, 0 deactivated (deactivation skipped: the list was not trusted)` | The three are active and every other location stays as it was. This is the normal output on a database loaded from that file, and it needs no action. |

If N is above 0, switch the others back on with the full sync (no `--from-file`; it needs DataForSEO
credentials). Without credentials, and only if the others were the 9 test locations, load that file and then
the three-country file again:

```bash
uv run --env-file .env.worker python -m idraft.worker.sync_locations \
  --from-file tests/fixtures/dataforseo/locations.json
uv run --env-file .env.worker python -m idraft.worker.sync_locations \
  --from-file tests/fixtures/dataforseo/locations-india-gulf.json
```

The first load makes the 9 active and, as its list is long enough to be trusted, deactivates the UAE and Saudi
Arabia and any other mapped location outside the 9 (it prints `N deactivated`). The second load writes the UAE
and Saudi Arabia active again, finds 11 active, reads 3 as under half and deactivates nothing. So the end state
is the 9 test locations plus the UAE and Saudi Arabia, all active. Keep that order: loaded the other way round,
the 9-location list deactivates the UAE and Saudi Arabia. A location outside the 9 that the first load
deactivated stays off; only the full sync brings it back. You can also load the two files in this order on a
fresh database to keep the 9 test locations as well.

## The command

```bash
uv run --env-file .env python -m idraft.cli seed-eventus
```

Options: `--workspace SLUG` (default `digibranders`) and `--fixture PATH` (default the repository's
`fixtures/ai-prompts/eventus-security.json`). It reads `backend/.env`, so it connects as `app_api`, under
row-level security, as the API does.

### What it prints

The first run on an empty workspace:

```text
Workspace digibranders (<workspace id>), project eventus-security (<project id>): created.
Entities: 9 made, 0 aliases and 0 domains added, 9 roles given.
Topics: 29 terms made.
Engines turned on: chatgpt_web, gemini_web. Engines widened: none.
WARNING: AI schedules paused: 2. The seed pauses every active AI answer schedule of the project so nothing spends by itself. They stay paused until a person resumes them in the app, and resuming them starts weekly spend.
Prompts: 72 made, 0 found, 0 archived, 0 differing from the fixture.
Active prompts in the workspace: 72 of 150.
No answers were made: they come from a run (docs/ops/dev-eventus-seed.md).
```

A line that starts with `WARNING` needs a person. Besides the schedule warning above:

| Warning | Meaning |
|---|---|
| `<engine> was turned off by a person, so the seed left it off.` | The engine had been configured and turned off, and the seed does not turn it back on. Prompts for countries it does not run in will not be answered by it. Turn it on in the app if you want it. |
| `found prompts that differ from the fixture: N.` | N prompts already existed with another intent, funnel stage, type, importance, branded flag or topics. They were left as they are. |
| `found prompts that are archived: N.` | N prompts already existed and are archived. They stay archived. |
| `found competitors whose ambiguity or hints differ from the fixture: <names>.` | These competitors already existed with another ambiguity flag or other disambiguation hints. They were left as they are: the fixture's values apply only to a competitor the seed makes. Change them in the app if you want the fixture's. |
| `<host> was added to <entity>, and another entity of a project that names it claims it too.` | The domain was added, as the API allows. Check it in the app. |

Exit codes: 0 when it is done, 1 when it refused or stopped (a message on standard error says why; see "If it
stops"), and 2 when the settings (a variable in `backend/.env`) or the command line arguments are invalid.

## Running it again

Safe at any time. A second run prints `already there`, zeros, `AI schedules paused: 0.` and
`Prompts: 0 made, 72 found, 0 archived, 0 differing from the fixture.`, and writes nothing: no row and no
audit entry.

What it does when something is already there:

- **Project:** a field that is empty (no default location, say) is filled from the fixture. A field that has
  another value stops the seed with a message; nothing is overwritten.
- **Engines:** an engine that was never configured is turned on at the fixture's countries. One that is on
  gains the fixture's countries it lacks and never loses one. One a person turned off stays off.
- **Prompts:** only the missing ones are made. A prompt is found by its text, language and country (as the
  API finds duplicates, archived ones included) and is not touched: its importance, topics and archive state
  stay as the person set them. A fixture text that changes is a new prompt; the old one stays, so archive it
  in the app.
- **Topics:** a term is found by its path, or by its name among its siblings, and is reused as it is. Missing
  terms are made. Nothing is renamed or removed.
- **Entities:** missing aliases and domains are added and a missing role is given. A role that is not the
  fixture's, or that a person removed, stops the seed before any entity is written. The ambiguity flag and
  hints of an existing entity are never written: the fixture's apply only to a competitor the seed makes, and
  a found competitor that differs is named in a `WARNING` line.
- **Schedules:** every active AI answer schedule of the project (the `ai_prompt` workload) is paused again, so
  a schedule you resumed is paused by the next run. Other schedules, such as rank checks, are not touched.
  Resume it after the seed, not before.

What you added stays: extra prompts, competitors, aliases, domains and topics.

## How it keeps away from the live server

It refuses unless all three facts hold, and one is enough to refuse. The check runs before the fixture is
read and before any database connection is opened.

1. `APP_ENV` is `local`. The server's env files say `production`.
2. The host of `DATABASE_URL` is `localhost`, `127.0.0.1` or `::1`.
3. The host of `APP_ORIGIN` is `localhost`, `127.0.0.1` or `::1`. The server's is `https://app.idraft.ai`.

The server's project Eventus Security lives in another PostgreSQL on another machine, so the seed cannot
reach it from a development env file. Never point a local env file at an SSH tunnel to another database: a
tunnel looks like `127.0.0.1` and the seed cannot tell.

It is also safe in what it writes. It goes through the services the API routes use (permissions, quotas,
locks and audit entries are the API's own), it is create-only as described above, every AI answer schedule is
paused in the same transaction that turns the engines on, and it makes no answer, run or task.

## Getting answers in development

There is no fake AI provider for the dev worker. Answers come from DataForSEO and cost real money. One bulk
run of the 72 prompts on the two engines is 72 x 2 = 144 answers, about 0.17 USD at the standard queue price
(0.0012 USD each).

**Do not do this without the owner's yes.** It needs DataForSEO credentials and the dev object store in
`.env.worker` ("Collecting real data locally" and "Providers and raw storage" in `backend/README.md`), and
the budget must be set first: step A of [ai-first-run.md](ai-first-run.md) gives the budget statement. Run
it against the development database, with the ids the seed printed, and check it before the run.

The request, the cost check, the answers it can give and why not to send it twice are in
[ai-first-run.md](ai-first-run.md), "Asking many prompts at once". In short: start the worker
(`uv run --env-file .env.worker python -m idraft.worker`), then send `POST {P}/ai/runs` with the ids of
the project's prompts, where `{P}` is `/api/v1/workspaces/<workspace id>/projects/<project id>`. From the
browser console of a signed in app page:

```js
const P = '/api/v1/workspaces/<workspace id>/projects/<project id>';
const list = await (await fetch(`${P}/prompts?limit=200`)).json();
const run = await fetch(`${P}/ai/runs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    prompt_ids: list.data.map((p) => p.prompt_id),
    engine_codes: ['chatgpt_web', 'gemini_web'],
  }),
});
console.log(run.status, await run.json());
```

Keep `engine_codes`. Without it the run asks every engine the project has turned on: with `google_ai_mode`
on, that is 72 x 3 = 216 answers (about 0.26 USD), not 144. With exactly these two engines the cost is
72 x 2 = 144 answers x 0.0012 = 0.1728 USD.

`202` with `meta.answers: 144` and `meta.estimated_cost_usd` means it is queued; the answers arrive in minutes.
If `meta.answers` is not 144, stop and check the body. It counts as one of the project's 20 manual runs of
the day.

**Do not resume the paused schedules unless you want recurring spend.** A resumed schedule asks every active
prompt on every engine that is on, every Monday and Thursday at 01:00 project time: 144 answers, about 0.17
USD, each time.

## If it stops

Most stops come before the first write, and their message ends with `Nothing was written.` Fix the cause and
run it again. Other stops can come after earlier writes: a stop in the entity step (`The project's roles are
not the fixture's.` or `The fixture's entity ... is not valid for the API`) may follow the project being made
or filled in, `Prompts were refused` follows the prompts that were accepted, and `The API refused a step` or
`The database could not be used` may follow any earlier step. Their messages say so. A rerun after the fix
completes the rest and never repeats what is done.

| Message starts with | What to do |
|---|---|
| `Refused: APP_ENV is ...`, `Refused: DATABASE_URL names a database that is not on this machine`, `Refused: APP_ORIGIN is not on this machine` | You are not on a development env file. Use `backend/.env`. |
| `No active workspace 'x' with an active owner was found` | Step 1, or `--workspace <slug>`. |
| `core.locations has no active country location for ...` | Step 2. |
| `The project 'eventus-security' exists and is archived` (or deleted or paused) | Bring it back in the app, then run again. |
| `The project 'eventus-security' differs from the fixture: ...` | The project has another name, time zone, language, domain or default location than the fixture. Change it in the app or the fixture. The seed does not overwrite it. |
| `The project's roles are not the fixture's.` | An entity has another role than the fixture gives it. Change it in the app. No entity, topic, engine or prompt was written; the project may be. |
| `The workspace has U of L active prompts and the fixture needs N more` | Archive prompts in the app, or raise `core.workspace_quotas.max_active_prompts` for the workspace in the dev database. |
| `Prompts were refused: p.. location_not_supported ...` | Another engine (AI Mode) is on without that country. Turn it off or add the country. Some prompts may already be saved; the next run finishes the rest. |
| `The API refused a step: ...` | A service refused a write, with the API's own title and code. Read it, fix the cause in the app, run again. |
| `The database could not be used (...)` | The dev stack is not running, or `DATABASE_URL` is wrong. Only the error type is shown, never the URL. |
| `The fixture ... is not valid: ...` | The fixture changed shape. Fix the file, or update `idraft/devseed/fixture.py`. |
