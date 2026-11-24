# DataForSEO SERP Accuracy and Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `resolve_poisoned_results: true` on every Google organic rank task, so the rank collector stops reading poisoned SERPs, and keep the cost estimate, the docs and the tests true to the extra unit it costs.

**Architecture:** One field added to the `task_post` body in `providers/dataforseo/serp.py`. The live (check now) body does not send it: a live answer is only ever kept as a diagnostic (`seo_rank_ingest.py`), so paying $0.002 more for it buys nothing. The run estimate in `collectors/seo_rank.py` adds one page unit per standard or priority task. No migration, no new price row, no parser change (see "Decisions").

**Tech Stack:** Python 3.13, pydantic, SQLAlchemy Core, pytest (Testcontainers for the estimate test), ruff, mypy strict.

---

## Why (measured 2026-11-23, spikes S-20 to S-24)

- Google serves automated requests different organic results from what people see. DataForSEO's fix (`resolve_poisoned_results`, announced 2026-11-16) cross-checks the results against Google Web mode and replaces poisoned listings.
- Same 15 Eventus queries against Search Console and a real Chromium (gl=in): site found on page one **10 of 30 runs without the fix, 28 of 30 with it** (cloro without a fix: 28). Depth 75 on 20 tracked keywords: found 33 of 38 with the fix, 21 without. Repeat overlap of the top 10 against itself: 0.92 with the fix, 0.28 without.
- The fix fired on 61 of 70 tasks: for these queries poisoning is the norm, not the exception.
- Price: one extra SERP unit per task, whatever the depth. Standard $0.0006, priority $0.0012, live $0.002 (a live page one task measured $0.004 with it, $0.002 without).
- Standard queue returns real URLs. Priority and live return every organic URL as `google.com/goto?url=...`; the site survives only in `breadcrumb`. The parser already recovers the host from it (`recovered`, tests `test_serp_org_04b` to `04d`) and the resolver already treats such a ranking as approximate (`ranking_recovered`). Measured on priority answers: 143 of 143 results recovered.

## Decisions

1. **Send the fix on every `task_post` task**, standard and priority, at every depth. Not a setting: the old behaviour is a wrong rank, so there is nothing to switch back to.
2. **Do not send it on live.** `seo_rank_ingest.py` keeps a live answer as a snapshot and writes no rank from it.
3. **Standard stays the default queue.** Priority is about 10x faster on deep SERPs (median 85 s against 841 s at depth 75) for twice the price, and costs the exact ranking URL. It remains an opt-in schedule mode as it is today.
4. **No parser or storage change for `from_web`.** `checks` on an organic result is a list of strings (`["from_web"]`); `_checks()` reads boolean fields, and nothing downstream reads `OrganicResult.checks`. Storing it would be code with no reader.
5. **No change to `tasks_ready` limits.** The app polls once a minute per endpoint (doc 06 section 4.2), far under any limit. The "12 per minute" seen in the spikes came from two harness processes polling at once.
6. **Depth stays 100 for every profile**, as `test_seo_rank.py` already pins.
7. **No migration.** The price book stays as seeded in 0013. The extra unit is the queue's page price (the same rule the estimate already uses for the AI Overview surcharge when it has no row of its own).

## Cost effect (list prices, standard queue, depth 100, AI Overview fee counted on every task as an upper bound)

| | Per check | 1,000 keywords checked daily (30,000 checks a month) |
|---|---|---|
| Before | 10 pages x $0.0006 + $0.0006 = $0.0066 | $198 |
| After | + $0.0006 = $0.0072 | $216 (+$18, +9%) |

At depth 75 (8 pages) the measured rise was 23%. Priority doubles every figure.

## File Structure

| File | Change |
|---|---|
| `backend/src/idraft/providers/dataforseo/serp.py` | `task_body` sends `resolve_poisoned_results`; `live_body` drops it |
| `backend/tests/providers/dataforseo/test_serp.py` | expected body gains the field; new test for priority; new test that live drops it |
| `backend/tests/providers/dataforseo/test_serp_live.py` | no edit needed; the expected live body must stay unchanged (it proves the drop) |
| `backend/src/idraft/collectors/seo_rank.py` | `estimate` adds one page unit per standard or priority task |
| `backend/tests/collectors/test_seo_rank.py` | estimate test numbers and comment |
| `docs/06-dataforseo-seo-integration.md` | parameter row, cost formula, rank-history note |
| `docs/27-cost-model.md` | price line, SERP prices paragraph |

Work in a worktree: `git worktree add .claude/worktrees/serp-poisoned-results -b ai/serp-poisoned-results develop` from the main checkout, and remove it when merged (`git worktree remove`, no `--force`). Run only the targeted tests below, serially.

---

### Task 1: Send the fix on every queued task, not on live

**Files:**
- Modify: `backend/src/idraft/providers/dataforseo/serp.py` (`task_body`, `live_body`)
- Test: `backend/tests/providers/dataforseo/test_serp.py`

- [ ] **Step 1: Write the failing tests**

In `tests/providers/dataforseo/test_serp.py`, change the expected body of `test_a_task_asks_for_what_the_rules_say` to include the new key after `"calculate_rectangles": False`:

```python
        "calculate_rectangles": False,
        "resolve_poisoned_results": True,
        "tag": TAG,
```

Add these two tests directly after `test_no_callback_is_asked_for`. First change the import line of the file to `from idraft.providers.dataforseo.serp import SerpOrganicParams, live_body, task_body`.

```python
@pytest.mark.parametrize("queue", ["standard", "priority"])
def test_a_queued_task_resolves_poisoned_results_on_either_queue(queue: str) -> None:
    body = task_body(_request(_params(queue=queue), priority=queue), TAG)

    assert body["resolve_poisoned_results"] is True


def test_a_live_call_does_not_pay_for_the_resolving_pass() -> None:
    # A live answer is kept as a diagnostic and never becomes a rank
    # (collectors/seo_rank_ingest.py), so the extra unit would buy nothing.
    assert "resolve_poisoned_results" not in live_body(_request(_params(queue="live")))
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/providers/dataforseo/test_serp.py -q`
Expected: 3 failures (`KeyError: 'resolve_poisoned_results'` twice and the body mismatch); the live test passes already, which is fine because it pins what Step 3 must keep true.

- [ ] **Step 3: Implement**

In `serp.py`, `task_body`, add the key after `calculate_rectangles`:

```python
        "calculate_rectangles": False,
        # Google serves automated requests other organic results than people see; this
        # cross-checks them against Google Web mode and swaps the poisoned ones. One extra
        # SERP unit a task at any depth. Measured 2026-11-23: the site found on page one in 28
        # of 30 runs against 10 of 30 without it.
        "resolve_poisoned_results": True,
        "tag": tag,
```

In `live_body`, extend the deletion and its docstring:

```python
def live_body(request: CanonicalRequest) -> dict[str, object]:
    """The body of a live call: a task body without the queue, the tag and the resolving pass.
    The first two only `task_post` takes; the last would cost a live page more for an answer
    that is kept as a diagnostic and never becomes a rank."""
    body = task_body(request, tag="")
    del body["tag"], body["priority"], body["resolve_poisoned_results"]
    return body
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/providers/dataforseo/test_serp.py tests/providers/dataforseo/test_serp_live.py tests/providers/dataforseo/test_provider.py -q`
Expected: all pass. `test_serp_live.py` is untouched and still expects the old live body, which proves the drop.

- [ ] **Step 5: Lint and types, then commit**

```bash
cd backend && uv run ruff check src/idraft/providers/dataforseo/serp.py tests/providers/dataforseo/test_serp.py && uv run ruff format --check src tests && uv run mypy src/idraft/providers/dataforseo/serp.py
git add src/idraft/providers/dataforseo/serp.py tests/providers/dataforseo/test_serp.py
git commit -m "feat(rank): resolve poisoned Google results on every queued rank task"
```

---

### Task 2: Count the extra unit in the run estimate

**Files:**
- Modify: `backend/src/idraft/collectors/seo_rank.py` (`estimate`, lines 384 to 425)
- Test: `backend/tests/collectors/test_seo_rank.py` (`test_the_estimate_is_pages_at_the_queues_price_and_the_async_ai_overview`, line 485)

The estimate test needs Docker. Set it up once per shell:

```bash
colima status || colima start --cpu 10 --memory 16
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
```

- [ ] **Step 1: Update the test first (it must fail)**

Replace the body of the test from the `standard =` line to the two cost assertions:

```python
    standard = await _plan(worker_db, _window(project, mode="standard_queue"))
    priority = await _plan(worker_db, _window(project, mode="priority_queue"))

    # Standard: (10 + 10) pages at $0.0006, two tasks at $0.0006 for the AI Overview and two
    # at $0.0006 for the resolving pass of poisoned results.
    assert standard.estimated_cost_usd == Decimal("0.0144")
    # Priority: 20 pages at $0.0012, and with no price row of its own each surcharge at the
    # queue's page price (the additive reading of doc 06 section 6.2): two for the AI Overview
    # and two for the resolving pass.
    assert priority.estimated_cost_usd == Decimal("0.0288")
```

Rename the test to `test_the_estimate_is_pages_at_the_queues_price_plus_the_ai_overview_and_the_resolving_pass`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/collectors/test_seo_rank.py -k the_estimate_is_pages -q`
Expected: FAIL, `Decimal('0.0132') != Decimal('0.0144')`.

- [ ] **Step 3: Implement**

In `estimate`, update the docstring sentence and the final lines:

```python
    """What the subjects cost by the price book: the pages of each depth at the queue's price,
    and what each queued task adds: the asynchronous AI Overview (its own price row, else the
    queue's price of a page: the additive reading of doc 06 section 6.2) and the pass that
    resolves poisoned results (one more page at the queue's price, whatever the depth, measured
    2026-11-23). None, and an error in the log, when the book has no page price: a run is never
    planned on a guess of zero."""
```

and replace the last three lines:

```python
    total = sum((pages(s.depth) for s in subjects), 0) * page
    if queue == "live":
        return total  # a live answer carries the AI Overview with it, and sends no resolving pass
    return total + len(subjects) * ((page if surcharge is None else surcharge) + page)
```

- [ ] **Step 4: Run the estimate tests**

Run: `cd backend && uv run pytest -n 0 --no-cov tests/collectors/test_seo_rank.py -q`
Expected: all pass. The live tests at lines 379 and 410 (`0.060`, `0.040`) stay green because live returns before the new term.

- [ ] **Step 5: Lint, types, commit**

```bash
cd backend && uv run ruff check src/idraft/collectors/seo_rank.py tests/collectors/test_seo_rank.py && uv run ruff format --check src tests && uv run mypy src/idraft/collectors/seo_rank.py
git add src/idraft/collectors/seo_rank.py tests/collectors/test_seo_rank.py
git commit -m "feat(rank): include the resolving pass in the rank run estimate"
```

---

### Task 3: Docs

**Files:**
- Modify: `docs/06-dataforseo-seo-integration.md` (parameter table after the `load_async_ai_overview` row, section 6.2)
- Modify: `docs/27-cost-model.md` (price table after line 14, "SERP prices" paragraph near line 194)

- [ ] **Step 1: Doc 06 parameter row**

Add this row to the parameter table, right after the `load_async_ai_overview` row:

```markdown
| `resolve_poisoned_results` | **Always true on queued tasks** (`task_post`), not sent on live. Google serves automated requests other organic results than people see; DataForSEO cross-checks them against Google Web mode and replaces poisoned listings (`checks` holds `from_web` on a replaced one). One extra SERP unit a task at any depth ($0.0006 standard, $0.0012 priority). Measured 2026-11-23 on 15 queries against Search Console and a real browser: site on page one 28 of 30 runs with it, 10 of 30 without; top 10 repeats itself 0.92 with it, 0.28 without. Cannot be combined with `udm=web` or `udm=14`. Live answers are diagnostics and do not send it. |
```

- [ ] **Step 2: Doc 06 section 6.2**

In the formula block add a line after `aio_surcharge`:

```
poison_fix            = base[mode] per queued task, any depth (live: not sent)
```

Below the monthly example table add one sentence:

```markdown
Add `poison_fix` once per check: one page unit, about 9% on a depth 100 check and 23% at depth 75 (measured 2026-11-23).
```

- [ ] **Step 3: Doc 06 rank history note**

At the end of section 6.2, add:

```markdown
**Rank history steps once.** The first check after `resolve_poisoned_results` went live reads the real SERP, so many keywords change place at once and the rank events (gained, lost, entered, dropped) of that day are the correction, not market movement. Release it when the owner expects that step, and note the date in the release notes.
```

- [ ] **Step 4: Doc 27**

Add after the "Async AI Overview surcharge" row of the price table:

```markdown
| Resolve poisoned Google results (SERP) | +1 page unit per queued task at any depth: $0.0006 standard, $0.0012 priority; not sent on live | Measured 2026-11-23 (page one task $0.00074 to $0.00132, depth 75 task $0.0043 to $0.0053) |
```

and at the end of the "SERP prices (rank collection)" paragraph add: ` A queued task also adds one more page at the queue's price for the resolving pass of poisoned results; a live check does not send it.`

- [ ] **Step 5: Check and commit**

```bash
git diff --stat docs
grep -n "—\|–" docs/06-dataforseo-seo-integration.md docs/27-cost-model.md | head
git add docs/06-dataforseo-seo-integration.md docs/27-cost-model.md
git commit -m "docs: poisoned-results pass in the DataForSEO parameters and cost model"
```

Expected: the `grep` prints no line you added (the global style rule bans dashes in prose).

---

### Task 4: Check one real task against the account, then merge

**Files:** none (a measurement before the change is released)

- [ ] **Step 1: Run the targeted checks**

```bash
cd backend && uv run pytest -n 0 --no-cov tests/providers/dataforseo tests/collectors/test_seo_rank.py tests/collectors/test_seo_rank_ingest.py -q
```

Expected: all pass.

- [ ] **Step 2: One real task, about $0.001**

The spike harness already builds the body the same way; run it on the smallest set with the resolving pass on, one process, then read the report:

```bash
cd backend && uv run --env-file .env python -m spikes.s22_search_console_check dfs --raw-dir /tmp/serp-fix-check --resolve
uv run python -m spikes.s22_search_console_check analyze --raw-dir /tmp/serp-fix-check
```

Expected: the site found in the top 10 on most of the 15 queries (the 2026-11-23 run: 28 of 30 runs). This costs about $0.02 for the whole set; stop it if it runs longer than the 15 minutes the standard queue needs. Delete `/tmp/serp-fix-check` afterwards.

- [ ] **Step 3: Merge into develop**

Merge the branch into `develop` in the main checkout (fast-forward), push `origin/develop`, remove the worktree. Do not push `main`: a release is `infra/ship.sh` and only when the owner says so (the rank-history step in Task 3 is the reason to ask first).

---

## Out of scope (separate decisions)

- **cloro as a second source** for citations, Gemini in the Gulf, or a failover when DataForSEO is slow. Needs its own plan and a paid plan.
- **Priority queue for rank**, as a customer-facing "fast refresh" mode: needs the page URL recovered or marked approximate in the rank table and UI.
- **`from_web` as a data-quality signal** (share of tasks the fix replaced), shown in the ops health page. Build it when someone reads it.
- **Automatic answer screenshots**: see `2026-11-23-ai-answer-screenshots.md` (on demand only in v1).
- **Search Console cross-check** of tracked ranks per project: a feature of its own.
- **Depth**: stays 100.

## Self-review

- Spec coverage: new parameter on queued tasks (Task 1), live excluded with a reason (Task 1), priority and redirect links (Decisions 3 and 4, covered by existing parser and resolver tests), cost estimate (Task 2), docs and cost model (Task 3), real-account check and release rule (Task 4), other findings listed under Out of scope.
- Placeholders: none. Every code step shows the code; the one command with uncertain output (Task 4 Step 2) states the figure to compare with.
- Names: `resolve_poisoned_results`, `task_body`, `live_body`, `estimate`, `surcharge`, `page` match the current source.
- Numbers: standard (10 + 10 pages) x $0.0006 = $0.0120, plus 2 x $0.0006 (AI Overview) plus 2 x $0.0006 (resolving pass) = $0.0144. Priority: 20 x $0.0012 = $0.0240, plus 4 x $0.0012 = $0.0288. Live tests unchanged.
