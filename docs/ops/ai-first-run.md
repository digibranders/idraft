# First real run of AI prompt tracking (Eventus Security)

This is the acceptance run of spec section 6 for slice 1. It puts the prompts of `docs/ops/eventus-ai-prompts.csv` on the Eventus Security project and asks them on ChatGPT, Gemini and Google AI Mode. The first run takes the 134 prompts for India; the 16 prompts for four other countries are an optional step afterwards ("Adding the other countries"). It goes in small steps, so you can stop after any of them.

**Until the web screens ship, every step is an API request that an engineer sends for you.** Where this guide names a screen (the Add prompts dialog, project settings, the Runs page, the Costs page), read it as the request next to it. Nothing here needs a screen.

**This guide never deploys anything.** The release with AI prompts goes live only when you say "ship it" and `infra/ship.sh` runs. **No step spends money by itself.** Every step that can spend says its cost first. Wait for your yes before you send it.

## The words used here

| Word | Meaning |
|---|---|
| Answer | One reply from one engine to one prompt. Each answer costs 0.0012 USD. |
| Engine | ChatGPT (`chatgpt_web`), Gemini (`gemini_web`) or Google AI Mode (`google_ai_mode`). They are all OFF until you turn them on. |
| Run now | Asks one prompt on the engines you name, right now. It makes one "run". |
| Schedule | A rule that asks every active prompt on every engine that is on. The base plan has two per project: Monday and Thursday at 01:00 project time. |
| Window | One occasion a schedule fires. Each active prompt is asked once per engine in a window. |
| Budget | A monthly limit in USD. A run that would pass it is blocked and sends nothing. |
| Probe | A tiny test with two odd prompts, to learn how the engines read the characters `+` and `%`. |
| `{P}` | `/api/v1/workspaces/{workspace_id}/projects/{project_id}` of the Eventus Security project. |

Requests are written as `METHOD {P}/path`. Ask your engineer or assistant to send them. When a screen for a step ships later, it does the same thing.

## What it costs

| Step | Answers | Cost |
|---|---|---|
| C: the probe, 2 prompts on 3 engines | 6 | 0.0072 USD, once |
| 2: Run now, 5 prompts on 3 engines | 15 | 0.018 USD, once |
| Everything before step 3 (C and 2) | 21 | 0.0252 USD |
| Step 3: one window, 134 prompts on 3 engines | 402 | 0.4824 USD |
| Step 3: a week, two windows | 804 | 0.9648 USD |
| Step 3: a month, two windows a week | about 3,500 | about 4.18 USD |
| Optional, other countries: a check of the 4 countries, 4 prompts on 3 engines | 12 | 0.0144 USD, once |
| Optional, other countries: one window with all 150 prompts | 450 | 0.54 USD |
| Optional, other countries: a month with all 150 prompts | about 3,900 | about 4.68 USD |

The monthly budget of 10 USD (step A) leaves room for all of it and stops anything that goes wrong.

## Before you start

1. The release with AI prompts is live on the VPS. It has migrations 0018, 0019 and 0020, the `ai_prompt_ingest` worker tick and the answer routes. Ask your engineer to confirm that the serving commit is the one that holds them and that the health report (`GET https://app.idraft.ai/api/internal/health`) says `ok` for the database, Redis, the raw bucket and the worker. If it is not live, stop here. Shipping is your call, and it is not part of this guide.
2. The project Eventus Security exists. Its own brand is the entity Eventus Security with the site `eventussecurity.com` and the name as an alias, and its competitors are added with their sites. Each one is tracked in AI answers (that is on by default). Without this the answers are stored, but no mention or citation is marked as ours or a competitor's.
3. The DataForSEO balance covers at least 10 USD. Check it on the DataForSEO dashboard.
4. You are the owner, or you hold the permissions the steps need: project settings, prompts, schedules, running prompts, budgets and reading raw answers. A `403` on a step means a permission is missing. Do not work around it.
5. Do the steps on a day and time that is not within an hour of 01:00 on a Monday or Thursday, project time.

## Step A: set the budget (no cost)

Do this before anything is turned on.

1. Look up the project once. Ask your engineer to run this on the VPS as the migrator role:

   ```sql
   SELECT p.id AS project_id, p.workspace_id, w.name AS workspace, p.created_at
   FROM core.projects p JOIN auth.workspaces w ON w.id = p.workspace_id
   WHERE p.name = 'Eventus Security' AND p.deleted_at IS NULL;
   ```

   It must return exactly one row. Two rows mean another workspace has a project of that name: pick the one of your workspace by its name. Copy `project_id` and `workspace_id`. Every later statement uses these two ids, never the project name, so it cannot touch another project. `{workspace_id}` and `{project_id}` in `{P}` are these ids.

2. Ask your engineer to run this as the migrator role, with the two ids pasted in. It sets a 10 USD monthly limit for AI answers on this project only:

   ```sql
   INSERT INTO ops.budgets (workspace_id, project_id, workload, period, limit_usd)
   VALUES ('<workspace_id>', '<project_id>', 'ai_prompt', 'month', 10.00)
   ON CONFLICT (workspace_id, project_id, workload, period) DO UPDATE SET limit_usd = 10.00;
   ```

3. Check it: `GET /api/v1/workspaces/{workspace_id}/budgets/status` lists the `ai_prompt` budget of the project with `spent_usd` 0 and `state` `ok`.

If the budget is not listed, stop. Do not go on without it.

## Step B: turn the engines on, and pause the schedules (no cost)

Turning an engine on makes the project's two schedules. A schedule spends money by itself when its window comes. So you pause both schedules at once, and resume them only in step 3.

1. Read the estimate first. `GET {P}/engines` shows `estimated_monthly_cost_usd` for each engine. With no prompts yet it is 0.
2. For each of `chatgpt_web`, `gemini_web` and `google_ai_mode`, send `PUT {P}/engines/{engine_code}` with `{"location_ids": [2356], "is_enabled": true}`. Location 2356 is India. A `422 location_not_supported` means the country is not in the location list. Stop and tell your engineer.
3. Right away list the schedules: `GET {P}/schedules?filter[workload]=ai_prompt`. There must be exactly two (Monday and Thursday).
4. Pause each: `POST {P}/schedules/{schedule_id}/pause` with `{"reason": "first run, paused until step 3"}`.
5. Check: `GET {P}/schedules?filter[workload]=ai_prompt` shows `is_active: false` for both.

A paused schedule stays in place. Switching engines on again later does not make new ones, and nothing runs from them.

## Step C: the probe (costs 0.0072 USD)

**Why.** The SERP side of the system has to escape `%` and `+` in a keyword, because DataForSEO decodes them there (`%41` becomes `A`, `+` becomes a space). Nobody knows yet whether the three AI endpoints do the same. None of the 150 Eventus prompts contains `%` or `+`, so the real run does not depend on the answer. The answer decides whether the adapter needs an escaping change later (a follow-up change, not part of this guide).

1. Add two prompts, country `IN`, language `en`, with the Add prompts dialog or `POST {P}/prompts` for each:
   - Probe 1 (plus sign): `Is a SOC 2 + ISO 27001 certified managed SOC provider better for a bank in India?`
   - Probe 2 (percent code): `Is %41 in a web server log a sign of an attack or just an encoded letter A?`

   Write each one down exactly, with its prompt id.
2. **Cost: 2 prompts x 3 engines = 6 answers = 0.0072 USD.** Wait for your yes. Then send, for each probe prompt, `POST {P}/prompts/{prompt_id}/run-now` with `{"engine_codes": ["chatgpt_web", "gemini_web", "google_ai_mode"]}`. Each answers `202`.
3. Wait a few minutes. List the answers of a probe: `GET {P}/ai/observations?filter[prompt_id]={prompt_id}`. There should be 3, one per engine, with a `status` and an `observation_id`.
4. For each answer fetch the stored provider reply: `GET {P}/ai/observations/{observation_id}/raw` (needs the `raw:read` permission). It downloads a JSON file. Find `tasks`, the first entry, then `data`, then `keyword`. That is the text the engine says it received.
5. Compare it to what you wrote:

   | `keyword` in the reply | Meaning |
   |---|---|
   | The same text, with `+` and `%41` as written | The endpoint does not decode. No change is needed. |
   | `+` is now a space, or `%41` is now `A` | The endpoint decodes, like the SERP endpoint. The adapter must escape these characters before any prompt that contains them is run. Tell your engineer. This is a follow-up change. |

   Check all three engines, one by one. The answer for each engine can differ.
6. Ask your engineer to write the result for each engine into `docs/07-dataforseo-ai-integration.md`, section 5.5.
7. **Archive both probe prompts now:** `DELETE {P}/prompts/{prompt_id}`. This is not optional. An active probe prompt would be asked again by every schedule, and it takes two of the 150 places the workspace may have active.

## Step 1: five real prompts (no cost)

1. Add the first 5 rows of `docs/ops/eventus-ai-prompts.csv` (country `IN`, language `en`) with the Add prompts dialog, or `POST {P}/prompts/bulk-create`. The count against the quota (150 active prompts) is shown before saving. Topics are optional for now: answers work without them, and the loading of topics from the `topic` column of the CSV is your engineer's job.
2. Read the estimate: `GET {P}/engines`. It shows about 0.05 USD a month for each engine with 5 prompts, about 0.16 USD for all three. Nothing has been spent.

## Step 2: ask the five by hand, and check the answers (costs 0.018 USD)

1. **Cost: 5 prompts x 3 engines = 15 answers = 0.018 USD.** Wait for your yes. Then, for each of the 5 prompts, send `POST {P}/prompts/{prompt_id}/run-now` with `{"engine_codes": ["chatgpt_web", "gemini_web", "google_ai_mode"]}`. Each answers `202`. A project may start at most 20 manual runs in a day, probes included, so do not repeat it needlessly.
2. Within a minute each run is `running`. Open it: `GET {P}/runs/{run_id}` (the Runs page) shows the estimated cost of 0.0036 USD and the number of tasks. `GET /api/v1/workspaces/{workspace_id}/budgets/status` shows `committed_estimate_usd`, which is what the runs under way are still expected to spend: each run's estimate less what its tasks have cost so far. It starts near 0.0036 USD per run and falls toward 0 as the provider accepts the tasks and their cost is booked. The money actually spent moves to `spent_usd`. `state` stays `ok`.
3. Within a few minutes every task is `ingested`. List the answers: `GET {P}/ai/observations?filter[prompt_id]={prompt_id}`.
4. Open each answer: `GET {P}/ai/observations/{observation_id}` (the answer viewer). It shows the text, the cited sources and the names it found.
5. Ask the same prompt by hand in chatgpt.com, in gemini.google.com and in Google AI Mode, signed out, from India, in English. Keep a table, one row per prompt and engine:

   | Prompt | Engine | Eventus Security named (ours / by hand) | eventussecurity.com cited (ours / by hand) | Competitors named | Kinds of sources | Language |
   |---|---|---|---|---|---|---|

   What to look at:
   - **Is the brand named?** Ours means `facts.own_mentioned` in the stored answer. Compare it with the text of the stored answer, which you can read yourself. They must agree.
   - **Are the cited sources the same kind?** Vendor sites, review sites, news, forums. The exact pages differ from one asking to the next, so look at the kind and at the domains that come up again and again.
   - **Language and market.** English, and about India.
   - **Competitors.** The ones the stored answer marks as named are really named in its text.

   Answers differ from one asking to the next. This is normal. What matters is that our marks match our stored answer, and that the stored answer reads like what the product shows.
6. Ask your engineer to check the database agrees with the screens (the cost should be 0.006 USD per engine for 5 answers). Paste the `project_id` copied in step A:

   ```sql
   SELECT o.engine_code, o.status, count(*) AS answers,
          count(*) FILTER (WHERE f.own_mentioned) AS mentioned,
          count(*) FILTER (WHERE f.own_domain_cited) AS cited,
          sum(o.cost_usd) AS cost_usd
   FROM ai.observations o
   JOIN ai.observation_facts f
     ON f.observation_id = o.id AND f.observed_at = o.observed_at AND f.is_current
   WHERE o.project_id = '<project_id>' AND o.observed_at > now() - interval '1 day'
   GROUP BY 1, 2 ORDER BY 1, 2;
   ```

   Expected: 5 `complete` answers per engine. A `refused` or `empty` one is possible; it is counted in no rate. The probe answers of the same day are in this list too, so 7 answers per engine is normal if they ran today.

### What a failure looks like, and where to see it

| What you see | Where | What it means |
|---|---|---|
| Answer `status` is `error` with an `error_code` that is a number, for example `40501` | The observation list and the answer viewer | The provider could not answer the task. The failure is stored as an answer and counts in no rate. |
| Answer `status` is `error` with `error_code` `schema_mismatch` | The same | The reply arrived in a shape we cannot read (an unreadable answer). The raw reply is kept (`.../raw`). Tell your engineer: the reader needs a change. |
| Answer `status` is `refused` | The same | The engine declined with a short reply. Real, not a fault. It counts in no rate. |
| Answer `status` is `empty` | The same | The engine sent no text. It counts in no rate. |
| Answer `status` is `partial` | The same | Text without the blocks behind it. It counts in the rates, flagged. |
| A task `failed` or `dead`, or a run `failed` | The Runs page, `GET {P}/runs/{run_id}` (`tasks_by_status`, `status_reason`) | The task never got an answer. Look at the reason, and tell your engineer. |
| A run `budget_blocked` | The Runs page, `budgets/status` (`blocked_runs`) | The budget stopped it and nothing was sent. |
| A task stays `submitted` or `ready` for more than 30 minutes | The Runs page | The worker is not reading answers. Tell your engineer: the `ai_prompt_ingest` tick or the raw bucket. |
| More money than the table above | The Costs page, `budgets/status` | Stop (see "How to switch everything off") and tell your engineer. |

**Stop here if the marks do not match the answers, or if most answers fail.** Switch the engines off (below). Nothing more is asked.

## Step 3: the rest of the India prompts, and the schedule (0.4824 USD a window)

This step uses only the 134 prompts of the CSV with country `IN` (rows 1 to 123 and 140 to 150). The 16 prompts of other countries (rows 124 to 139) stay out of the first run: see "Adding the other countries".

1. Add rows 6 to 123 and 140 to 150 of the CSV the same way (country `IN`): 129 prompts, 134 active with the five of step 1. If the quota says no, an active prompt is left over: check that both probe prompts are archived.
2. Read `GET {P}/engines`: it now estimates about 1.39 USD a month for each engine, 4.18 USD for the three. The summary hides the branded prompts (rows 140 to 150, 11 of them) unless you ask for them, so it shows fewer prompts than you added.
3. **Cost: 134 prompts x 3 engines = 402 answers = 0.4824 USD for each window. The schedules run twice a week (Monday and Thursday, 01:00 project time): 0.9648 USD a week, about 4.18 USD a month.** The prompts asked by hand are asked again, because a schedule asks every active prompt, whatever was asked by hand. Wait for your yes.
4. Resume the two schedules: `POST {P}/schedules/{schedule_id}/resume`, one by one. Read `next_run_at` of each (`GET {P}/schedules?filter[workload]=ai_prompt`). This is when the money is first spent. Windows missed while a schedule was paused are not caught up.
5. Before it sends anything, the planner checks the run's estimate against the budget. A run over the budget is `budget_blocked` and spends nothing.
6. After the first window (it lasts 8 hours), ask your engineer to run the SQL of step 2 again with `interval '2 days'`. Expected: about 134 answers per engine, cost about 0.16 USD per engine. `GET {P}/ai/prompts-summary` shows each prompt's counts per engine ("1 of 1" after the first window, up to about 8 of 8 after four weeks, over valid answers only).

## Adding the other countries (optional, after the first window looked right)

Rows 124 to 139 of the CSV are 4 prompts each for Saudi Arabia (`SA`), the UAE (`AE`), Singapore (`SG`) and the United States (`US`). They add location work and a paid check, so they are not part of the first run. Do this only when you want them.

1. A prompt is asked only where an engine has a location in its country, and adding one is refused (`422 location_not_supported`) until all three engines have it. Ask your engineer to find the location ids of the four countries (do not guess them) with this query, as the migrator role:

   ```sql
   SELECT id, name, country_iso FROM core.locations
   WHERE location_type = 'Country' AND country_iso IN ('SA', 'AE', 'SG', 'US') AND is_active
   ORDER BY country_iso;
   ```

   It must return one row per country. A country with no row cannot be used yet.
2. Send `PUT {P}/engines/{engine_code}` again for each of the three engines with `location_ids` holding `2356` (India) and the four ids from the query, and `"is_enabled": true`. A `422 location_not_supported` means the provider does not serve that country: stop and tell your engineer. The engines must have all four countries before a prompt of that country can be added.
3. Add one prompt of each country first: rows 124, 128, 132 and 136 (their own countries). A prompt is asked once per engine, in its own country.
4. The AI providers' location lists are not synced yet, so a country they do not serve fails only when asked. **Cost of the check: 1 prompt of each of the four countries x 3 engines = 12 answers = 0.0144 USD.** Wait for your yes, then send Run now for those 4 prompts as in step 2. If a country fails (`error` answers), archive its prompt, or take the country out of the engines' `location_ids`. Do not leave a failing country in the schedule.
5. When all four answered, add the other 12 rows (125 to 127, 129 to 131, 133 to 135 and 137 to 139). **From the next window the schedules ask all 150 prompts: 450 answers = 0.54 USD a window, 1.08 USD a week, about 4.68 USD a month.** The schedules are already running, so the new prompts are spent on at the next Monday or Thursday window, and `GET {P}/engines` now estimates about 1.56 USD a month for each engine. Wait for your yes before you add them.

## How to switch everything off

Do these in this order. Each one is enough to stop new spending on its own, and together they are safe.

1. **Turn the engines off.** `PUT {P}/engines/{engine_code}` with the engine's current `location_ids` (`[2356]` unless you added the other countries) and `"is_enabled": false` for each of the three. A schedule then plans nothing, and Run now answers `422 engine_not_enabled`.
2. **Pause the schedules.** `POST {P}/schedules/{schedule_id}/pause` for both.
3. **Archive prompts you do not want asked.** `DELETE {P}/prompts/{prompt_id}`. The answers stay. `PATCH {P}/prompts/{prompt_id}` with `{"is_active": true}` brings one back.
4. **Cancel a run under way.** `POST {P}/runs/{run_id}/cancel` (the Runs page). Tasks already sent to the provider are paid for. The rest are not sent.
5. **The emergency brake.** Ask your engineer to set the budget to 0: `UPDATE ops.budgets SET limit_usd = 0 WHERE workload = 'ai_prompt' AND project_id = '<project_id>';` with the `project_id` copied in step A. A limit of 0 blocks every run.

The schedules stay in place when you switch the engines off, and they plan nothing. Pause them rather than delete them.

## What NOT to do

- Never edit the migrations 0018, 0019 or 0020 once they are shipped. A change to the tables is a new migration.
- Do not turn an engine on in production before the budget of step A is set.
- Do not resume the schedules before the answers of step 2 look right.
- Do not leave a probe prompt active.
- Do not change the text of a prompt: it cannot change. Archive it and add a new one.
- Do not edit or delete rows of the `ai.*` tables by hand. The answers are a record.
- Do not paste tokens, passwords or anything from `/etc/idraft` into this guide, a chat or a ticket.
- Do not add more than 150 active prompts: the quota refuses them, and a higher quota is a billing decision.
- Do not run the probe again and again: it is a paid test.

## Final checklist

| # | Done | Item | Cost |
|---|---|---|---|
| 1 | | The release with AI prompts is live and healthy (you said "ship it" for it) | 0 |
| 2 | | Eventus Security has its own brand and competitors, tracked in AI answers | 0 |
| 3 | | DataForSEO balance is at least 10 USD | 0 |
| 4 | | Step A: the 10 USD `ai_prompt` budget is set and listed in `budgets/status` | 0 |
| 5 | | Step B: the three engines are on at India, and both schedules show `is_active: false` | 0 |
| 6 | | Step C: the probe ran after your yes, the echoed `keyword` is read for each engine, the result is written in doc 07 | 0.0072 USD |
| 7 | | Both probe prompts are archived | 0 |
| 8 | | Step 1: 5 prompts are added | 0 |
| 9 | | Step 2: Run now ran after your yes, 15 answers are ingested, and each is compared by hand | 0.018 USD |
| 10 | | The SQL check agrees with the screens, and the failures (if any) are understood | 0 |
| 11 | | Step 3: 129 more India prompts are added, 134 are active | 0 |
| 12 | | Step 3: the schedules are resumed after your yes, the first `next_run_at` is noted | 0.4824 USD a window |
| 13 | | After the first window: about 134 answers per engine, cost about 0.16 USD per engine, the summary shows "1 of 1" | |
| 14 | | You know how to switch everything off | |
| 15 | | Optional: the other countries are added (location ids looked up, check run after your yes, each country answered) | 0.0144 USD, then 0.54 USD a window |
