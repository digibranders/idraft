# Internal links 01: crawl spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the five questions of spec section 10 on three real sites before any production crawl code is written: crawl speed and a clean stop at `max_crawl_pages`; the price of `store_raw_html` and the call limits of `raw_html`; what `respect_sitemap` does to scope, the orphan flag and `click_depth`; the accuracy of the link placement classifier against a hand check of 100 links per site; and whether `/on_page/links` returns the anchor text and rel we need for image links and redirects. The answers land in `docs/spikes/S-17.md` and settle the open points of spec sections 6.1 to 6.3 before plan 02 starts its provider and classifier tasks.

**Architecture:** Two parts. (1) The placement classifier of spec section 6.3 as a pure module, `idraft.crawl.placement`, in its final home so plan 02 promotes it unchanged and with the names plan 02 imports: `classify(html, page_url)` runs rules 1 to 5 on one page, `place_links(pages)` runs the template pass over a crawl. Unit tests on HTML fixtures, no network. (2) A spike script, `backend/spikes/s17_on_page_crawl.py`, in the style of S-01 to S-15: subcommand `crawl` is the only one that calls DataForSEO (through the live `DataForSeoClient`, the spike `Budget`, the `spike` installation tag) and keeps every answer under a git-ignored raw directory; `measure`, `classify` and `score` read only from disk and cost nothing. A hand-filled write-up template, `docs/spikes/S-17.md`, holds the results and the "what changes in the backend plan" checklist that the owner decision gate (Task 10) works through.

**Tech Stack:** Python 3.13, the standard library `html.parser` and `urllib.robotparser`, httpx (installed), the existing DataForSEO client (`idraft.providers.dataforseo`), pytest, ruff, mypy strict, import-linter. No new dependency.

---

## Where this plan sits

- **Plan 01 of four** for the internal link tracker: 00 roadmap, 01 crawl spike (this plan), 02 backend, 03 web. Plan 02 exists as a draft written in parallel and not yet committed: `docs/superpowers/plans/2026-11-16-internal-links-02-backend-slice-1.md` ("Internal links 02: backend slice 1"). Its Task 0 reads this spike's results; its "Plan 01 contract" (the names it imports from `idraft.crawl.placement`) is what Task 3 builds. Plans 00 and 03 are not written yet.
- Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md`, sections 6.1 to 6.4 and 10. Spike conventions: `docs/spikes/README.md`, `docs/spikes/S-04.md`, `backend/spikes/common.py`.
- **Worktree:** `/Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike`, branch `feat/internal-links-spike`, cut from `origin/develop`. Every command below runs in that worktree (W). Never work in the main checkout: other sessions have uncommitted changes there (`apps/web/design-preview/*` among them). Never switch branches, stash or reset there, never touch `.claude/worktrees/release`, never push or merge into `main`, never run `infra/ship.sh`.
- **Files this plan touches** (relative to W):

| File | Task | What |
|---|---|---|
| `.gitignore` | 1 | Ignore `backend/spikes/raw/` |
| `backend/src/idraft/crawl/__init__.py` | 2 | The new package |
| `backend/pyproject.toml` | 2, 3 | Import contracts only |
| `backend/tests/crawl/__init__.py`, `backend/tests/crawl/test_placement.py` | 3 | Classifier tests |
| `backend/src/idraft/crawl/placement.py` | 3 | The classifier |
| `backend/tests/spikes/test_s17.py` | 4 | Script tests (no network) |
| `backend/spikes/s17_on_page_crawl.py` | 4 | The spike script |
| `docs/spikes/README.md`, `docs/spikes/S-17.md` | 5, 9 | README row, write-up |
| `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md` | 10 | Sections 6.1 to 6.3 adjusted at the gate |

- **Files it never touches:** `backend/src/idraft/providers/**` (the spike calls the client as it is), `backend/spikes/common.py` and the other spikes, migrations, `backend/openapi/v1.json`, `apps/web/**`, `backend/uv.lock` (no dependency is added), `backend/tests/fixtures/dataforseo/captured/` (nothing is captured as a fixture: the answers hold third-party pages).
- **Money:** Tasks 1 to 6 spend nothing. Task 7 spends real money on the owner's DataForSEO account and runs **only when the product owner says so in chat**. Credentials live only in the shell that runs it (`docs/spikes/README.md`, "Before a run").

## Decisions

1. **Spike number S-17.** `grep -rhoE "\bS-[0-9]{2}\b" docs | sort -u` prints S-01 to S-16 (the S-2x hits of a looser grep are tracker ids such as `BE-METRICS-21`). S-17 is the next free number.
2. **The live client, not the task plumbing.** On-Page is not shaped like SERP or AI tasks (no `tasks_ready` or `task_get`: a `summary` poll, then list endpoints read by task id), so `TaskEndpoint`, `submit_all` and `wait_ready` do not fit. The script uses `spikes.common.live()` for the client and its local call gate, `Budget`, `run`, `say`, `first_result`, `task_cost`, `wilson`, and `make_tag(INSTALLATION, ...)` for the `spike` tag. It calls `DataForSeoClient.call` directly with `family=None` (the local gate knows only the families of `FAMILY_LIMITS`; an unknown family makes every call fail as "not made") and `sending=True` on `task_post` only, so a failed post is read as "may have been created" exactly as production reads it.
3. **Answers first, analysis offline.** `crawl` writes every answer to `backend/spikes/raw/s17/<site>/<variant>/` (`task_post.json`, `progress.jsonl`, `summary.json`, `pages.jsonl`, `links.jsonl`, `non_indexable.jsonl`, `raw_html.jsonl`, `html/*.html`, `robots.txt`, `meta.json`) before anything reads them. `measure`, `classify` and `score` read only that folder, as S-04's `--analyze` does, so a classifier change is tested again for free. The folder is git-ignored (Task 1): it holds third-party HTML and is never committed. DataForSEO keeps raw HTML for 7 days, so `crawl` fetches it in the same run, and the worktree with its raw folder stays until the gate (Task 10) is closed.
4. **Spending: a $5.00 cap over the whole spike, about $2.75 estimated.** Price $0.00015 a page (spec 6.1). Each crawl is estimated at every page of its cap, and a crawl that stores raw HTML at double (the dearer guess until question 2 is answered). `crawl --cap 5` adds the cost of every crawl already kept under the raw folder (DataForSEO's `cost`, or the estimate when it is unknown) and refuses, before sending anything, a crawl that would pass the cap.

   | Crawl | Sites | Pages (cap) | Raw HTML | Estimate each | Total |
   |---|---|---|---|---|---|
   | `smoke` | cleanstart.com | 10 | yes | $0.003 | $0.003 |
   | `stop_raw` | cleanstart.com | 100 | yes | $0.030 | $0.030 |
   | `stop_plain` | cleanstart.com | 100 | no | $0.015 | $0.015 |
   | `main` | 3 | 2,000 | yes | $0.600 | $1.800 |
   | `no_sitemap` | 3 | 2,000 | no | $0.300 | $0.900 |
   | All | | | | | **$2.748** |

   Arithmetic: 2,000 x $0.00015 = $0.30; doubled for raw HTML, $0.60. Per site $0.60 + $0.30 = $0.90, three sites $2.70, plus the three cleanstart.com probes $0.048. If `raw_html` calls were charged at the page price (the docs say they are free), 3 x 2,000 x $0.00015 = $0.90 more would still leave the total at $3.65, under the cap. The balance drop over each crawl (`/v3/appendix/user_data`, read before and after) shows any charge the `cost` field misses.
5. **Robots.** `crawl` fetches `https://<site>/robots.txt` itself before posting and refuses when it does not allow the start URL for `*` or for DataForSEO's crawler, whose default user agent is `Mozilla/5.0 (compatible; RSiteAuditor)` (`task_post` docs, `custom_user_agent`, read 2026-11-16). The crawler merges its own rules with the site's robots.txt by default (`robots_txt_merge_mode` `merge`); the spike never sets `override`. A robots.txt that answers anything but 200, 404 or 410 also refuses. No site is crawled that disallows it.
6. **The classifier follows spec 6.3, with three guards on the template pass.** Rules 1 to 5 and the pass structure are as written. Read literally, the second pass breaks on three real shapes, so it carries three guards, each a keyword argument with a module constant and each with a fixture in Task 3 that fails without it. They are **amendments to spec section 6.3**, listed in the gate checklist for the owner:
   1. **Steady count** (`STEADY_COUNT = 0.8`): article prose shares one container path on every post (`article/div.prose/p`) and links to different targets on each, so "different targets" alone would turn every editorial link into `auto_generated`. A block becomes `auto_generated` only when the most common number of its links per page holds on at least 80% of its pages (a related-posts widget always shows 3; prose varies). Fixture: `test_article_prose_with_changing_targets_stays_content`.
   2. **Minimum folder size** (`MIN_FOLDER_PAGES = 4`): in a folder of one to three pages every container is on at least 50% of the pages, so every link would be reclassified. Smaller folders keep their first-pass placements. Fixture: `test_a_folder_with_too_few_pages_is_left_to_the_first_pass`.
   3. **Self links count as present** (`SAME_TARGETS = 0.8`): links to the page itself are dropped first (spec), so a menu never has identical targets on two pages. "The same targets" is measured as coverage: for each target of the block, the share of the block's pages that link to it, counting a page as linking to itself; the block is the same when the mean coverage is at least 80%. Fixture: `test_a_menu_counts_the_link_each_page_drops_to_itself`.

   A link rule 4 leaves open is returned as `auto_generated` with `open=True` (the shape plan 02 imports); the template pass may claim it, and it stays `auto_generated` when it does not.

   Readings of the spec text the code fixes: rule 1 markers are read on ancestors only, never on `html` or `body`, as whole words of the normalized `aria-label`, `class` and `id` (so `related` never matches `unrelated`); "Previous or Next followed by a title" means at least one more word after it (`Next` alone is not a marker); rule 2 also reads `itemtype`; in rule 3, `header` and `footer` count when no `main` or `article` sits above the landmark; rule 4 counts `role="main"` as `main`; "nearest block container" is the nearest ancestor among a fixed set of block tags, its path built from tag names and class names made of letters, `-` and `_` only, leaving out state classes (`active`, `current`, `selected`, `open`); the top-level folder of `/blog/a-post` is `blog`, and the home page and one-segment pages share the empty folder.
7. **Parser: the standard library.** No HTML parser is installed (`backend/pyproject.toml` has none of lxml, selectolax or beautifulsoup4), and the plan adds no dependency. `html.parser` builds no HTML5 tree, so the reader handles the implied ends that move links between containers (`p`, `li`, a nested `a`) and skips `template` contents. The shortcut is marked in the code; the gate decides whether plan 02 adds an HTML5 parser.
8. **The package.** `idraft.crawl` is new; plan 02 owns it after this plan. `placement.py` imports nothing of idraft and no I/O library; a new import-linter contract keeps it so. The dev seed contract must list every top-level package (`backend/tests/devseed/test_import_contract.py` checks it), so `idraft.crawl` joins its `source_modules`.
9. **Sampling.** 100 internal links per site (target on the site's host, `www.` ignored), drawn by `sha256("17:<source>:<position>")`, smallest first. The key depends only on where the link is, never on the prediction, so a re-run after a threshold change keeps the same rows and their labels (`classify` copies labels across). A second sample of 30 posts per site from the posts folder holds the auto-generated links found on each, for the "previous and next found on every post that has them" check.
10. **Pass criteria.**
    1. A 100-page crawl ends with `crawl_stop_reason` `limit_exceeded` and at most 100 pages crawled, and its pages and links can be read in full. Pages per minute is recorded per site; there is no target.
    2. The cost per page of `stop_raw` and `stop_plain` is compared: equal means `store_raw_html` is free. `raw_html` answers every 200 page of the 2,000-page crawls one call at a time with no refusal; calls a minute and any `40202` or HTTP 429 are recorded.
    3. Recorded, not pass or fail: pages found with and without the sitemap, `from_sitemap` and `is_orphan_page` counts, how many pages DataForSEO gives `click_depth` 0, and how far our breadth-first depth reaches.
    4. Scope accuracy (editorial, auto-generated, template) at least 95% on each site's 100 labelled links, with n and the 95% Wilson interval per site; previous and next links found as `auto_generated` on every sampled post that has them.
    5. Image links carry the alt text (`image_alt` or `text`), `link_attribute` carries the rel values (`nofollow` seen), and links to redirects are visible (`page_to_status_code` 3xx or `type` `redirect`).
    6. For plan 02 open point O3: on the pages whose HTML was kept, the internal (source, target) pairs of `/on_page/links` that our HTML parse misses are under 2% (`measure` prints both differences).
11. **The write-up is filled by hand.** `measure` and `score` print Markdown and keep it in the raw folder (`measure.md`, `score.md`); the tables are pasted into `docs/spikes/S-17.md`, which Task 5 commits as a template. The script never writes into `docs/` (`write_report` of `common.py` would overwrite the hand-written findings). No login, balance or other account data goes into the write-up: only task costs and the balance drop per crawl.
12. **Field names come from the public DataForSEO docs read on 2026-11-16** and are confirmed by the smoke crawl, which prints the keys of every answer before any 2,000-page crawl: `task_post` (`target`, `start_url`, `max_crawl_pages`, `respect_sitemap`, `store_raw_html`, `enable_javascript`, `allow_subdomains`, `tag`; up to 100 tasks a call; `20100` on creation; `cost` per task), `GET /v3/on_page/summary/{id}` (`crawl_progress` `in_progress` or `finished`, `crawl_status` with `max_crawl_pages`, `pages_in_queue`, `pages_crawled`, `crawl_stop_reason` `limit_exceeded`, `empty_queue`, `force_stopped` or `unexpected_exception`), `POST /v3/on_page/pages` and `/v3/on_page/links` (`limit` up to 1,000, `offset`, `filters`, `search_after_token` past 20,000; pages carry `resource_type`, `status_code`, `url`, `location` for redirects, `click_depth`, `checks.from_sitemap`, `checks.is_orphan_page`; links carry `type` (`anchor`, `image`, `redirect` and others), `link_from`, `link_to`, `dofollow`, `direction`, `text`, `image_alt`, `link_attribute`, `page_to_status_code`), `POST /v3/on_page/raw_html` (`id`, `url`; HTML at `tasks[0].result[0].items.html`; free; kept 7 days). Not in the docs read, and so checked in the smoke crawl, which prints the keys of each list answer and of its first item: the body and fields of `/v3/on_page/non_indexable`, whether `search_after_token` sits on the result, and whether `cost` is charged for the page cap or for the pages crawled. A list answer without `total_items_count` stops the run rather than keeping the first 1,000 items silently.

13. **The names are plan 02's.** Plan 02 states the contract it imports from `idraft.crawl.placement`: `class Placement(StrEnum)` with exactly the values of `PLACEMENTS`; `FoundLink(href, anchor, kind, rel, placement, container, open)`, frozen, with slots; `classify(html, page_url) -> list[FoundLink]` in document order, `href` absolute, jump links and script controls left out, `open` true for a link rule 4 left open. Task 3 builds exactly that, plus `place_links`, `page_key` and `folder_of`. The link scopes (editorial, auto-generated, template) are plan 02's (`idraft.crawl.scopes`); the spike script keeps its own three-line `scope_of` for scoring only.
14. **One template pass: this one.** Plan 02 (D19, Task 5, open point O4) agreed on 2026-11-16 to use `idraft.crawl.placement.place_links` as written here, with the three guards of Decision 6, instead of a second pass of its own (a Jaccard overlap of 0.8 and folders of at least 5 pages with no steady-count guard would turn every editorial link of a post into `auto_generated`, see the prose fixture of Decision 6). S-17 therefore measures the pass plan 02 will ship. The gate still settles the values (`TEMPLATE_SHARE`, `SAME_TARGETS`, `STEADY_COUNT`, `MIN_FOLDER_PAGES`) from the hand check.
15. **No payloads are committed.** Plan 02 Task 0 expects recorded payloads under `backend/tests/fixtures/dataforseo/on_page/` and `backend/tests/fixtures/crawl_site/`. This plan keeps every answer in the ignored raw folder only: they hold third-party pages and URLs. At the gate the owner decides which answers, from which sites (the ones the owner or a client controls), plan 02 records as fixtures; the raw folder is handed over before the worktree is removed (Task 10).
16. **Base.** The branch is cut from `origin/develop`. On 2026-11-16 local `develop` (15bd576c) was ahead of `origin/develop` (09be48bc) with unpushed commits, and `git diff --stat origin/develop develop -- backend .gitignore docs/spikes` printed nothing, so either base gives the same files; `origin/develop` keeps the backup push of Task 5 from publishing those unpushed commits.

## Gates every code task ends on

Run from `W/backend`. The classifier and script tests need no Docker; the full suite in Task 5 does.

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike/backend
uv run ruff check --fix . && uv run ruff format .
uv run ruff check .            # All checks passed!
uv run ruff format --check .   # N files already formatted
uv run mypy                    # Success: no issues found in N source files
uv run lint-imports            # Contracts: 6 kept in Task 2, 7 kept from Task 3 on, 0 broken.
```

Targeted tests take `--no-cov` (a partial run fails the coverage gate): `uv run pytest <path> --no-cov -q`.

## Traps (every one applies)

1. **Files are pure ASCII.** No em or en dashes, curly quotes or arrows in code, comments, docstrings, test names, docs or commit messages. Before each commit: `grep -nP '[^\x00-\x7F]' <files>` prints nothing.
2. **Edit with the file tools (Read, Edit, Write).** No shell heredocs, `sed -i` or replace scripts.
3. **Lines are at most 100 characters** (ruff `E501`).
4. **No `print`** (ruff `T20`): the script writes through `say`.
5. **mypy strict covers tests and spikes** (`files = ["src", "tests", "spikes"]`): every function is annotated.
6. **Never `git add -A` or `git add .`.** Every commit names its files.
7. **Raw answers are never staged.** `git status --short` must not list `backend/spikes/raw/`; Task 1 proves the ignore rule.

---

## Task 1: Worktree and the ignored raw folder

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Make the worktree**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform
git fetch origin develop
git worktree add .claude/worktrees/internal-links-spike -b feat/internal-links-spike origin/develop  # Decision 16
cd .claude/worktrees/internal-links-spike/backend && uv sync --frozen
```

Expected: `Preparing worktree (new branch 'feat/internal-links-spike')`, then uv reports the environment in sync.

- [ ] **Step 2: Prove the raw folder is not ignored yet**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
mkdir -p backend/spikes/raw/s17 && : > backend/spikes/raw/s17/probe
git check-ignore -v backend/spikes/raw/s17/probe; echo "exit $?"
```

Expected: `exit 1` (nothing ignores it).

- [ ] **Step 3: Ignore it**

In `.gitignore`, after the `# python` block's last line (`.hypothesis/`), add:

```gitignore

# spike answers: third-party HTML and provider payloads, never committed
backend/spikes/raw/
```

- [ ] **Step 4: Prove the rule holds, then remove the probe**

```bash
git check-ignore -v backend/spikes/raw/s17/probe
rm backend/spikes/raw/s17/probe
git status --short
```

Expected: a line `.gitignore:<n>:backend/spikes/raw/	backend/spikes/raw/s17/probe`, then `git status --short` lists only ` M .gitignore`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore
git commit -m "Ignore spike answers under backend/spikes/raw"
```

## Task 2: The `idraft.crawl` package and the dev seed import contract

**Files:**
- Create: `backend/src/idraft/crawl/__init__.py`
- Modify: `backend/pyproject.toml` (the dev seed contract only)
- Test: `backend/tests/devseed/test_import_contract.py` (existing, unchanged)

- [ ] **Step 1: Create the package**

`backend/src/idraft/crawl/__init__.py`:

```python
"""Site crawls for the internal link tracker
(docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md)."""
```

- [ ] **Step 2: See the dev seed contract test fail**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike/backend
uv run pytest tests/devseed/test_import_contract.py --no-cov -q
```

Expected: `FAILED tests/devseed/test_import_contract.py::test_the_contract_lists_every_top_level_package_but_the_cli_and_the_seed` (an `AssertionError` at line 90: the packages on disk now include `idraft.crawl`) and `1 failed, 2 passed`.

- [ ] **Step 3: Add `idraft.crawl` to the dev seed contract**

In `backend/pyproject.toml`, contract "the dev seed is reached only from the operator CLI", replace:

```toml
  "idraft.ai", "idraft.api", "idraft.collectors", "idraft.config", "idraft.db",
```

with:

```toml
  "idraft.ai", "idraft.api", "idraft.collectors", "idraft.config", "idraft.crawl", "idraft.db",
```

- [ ] **Step 4: See it pass**

```bash
uv run pytest tests/devseed/test_import_contract.py --no-cov -q
uv run lint-imports
```

Expected: `3 passed`; then `the dev seed is reached only from the operator CLI KEPT` and `Contracts: 6 kept, 0 broken.` The purity contract for the classifier comes in Task 3: import-linter stops with `Module 'idraft.crawl.placement' does not exist.` when a contract names a module that is not there yet.

- [ ] **Step 5: Gates and commit**

Run the gates. Then:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
grep -nP '[^\x00-\x7F]' backend/src/idraft/crawl/__init__.py backend/pyproject.toml
git add backend/src/idraft/crawl/__init__.py backend/pyproject.toml
git commit -m "Add the idraft.crawl package to the dev seed import contract"
```

## Task 3: The placement classifier

**Files:**
- Create: `backend/tests/crawl/__init__.py` (empty), `backend/tests/crawl/test_placement.py`
- Create: `backend/src/idraft/crawl/placement.py`
- Modify: `backend/pyproject.toml` (the purity contract)

Names used by Task 4 and plan 02 (Decision 13): `class Placement(StrEnum)` (`CONTENT`, `AUTO_GENERATED`, `NAVIGATION`, `HEADER`, `FOOTER`, `SIDEBAR`, `BREADCRUMB`), `PLACEMENTS: tuple[str, ...]`, `LinkKind`, `TEMPLATE_SHARE`, `SAME_TARGETS`, `STEADY_COUNT`, `MIN_FOLDER_PAGES`, `FoundLink(href, anchor, kind, rel, placement, container, open)`, `page_key(url) -> str`, `folder_of(url) -> str`, `classify(html, page_url) -> list[FoundLink]`, `place_links(pages, *, template_share, same_targets, steady_count, min_folder_pages) -> dict[str, list[FoundLink]]`.

- [ ] **Step 1: Write the tests**

Create the empty `backend/tests/crawl/__init__.py`, then `backend/tests/crawl/test_placement.py`. The fixtures are the ones spec section 11 names: nav, header inside `main`, breadcrumbs, `rel="prev"` and `rel="next"` in an "Article navigation" section outside `article` (the cleanstart.com shape), WordPress `nav.post-navigation`, an unmarked related-posts block, a template block with the same targets, same-page jump links; plus one fixture per guard of Decision 6.

```python
"""The link placement classifier of spec section 6.3, on HTML fixtures. No network, no database."""

from __future__ import annotations

import pytest

from idraft.crawl.placement import (
    PLACEMENTS,
    FoundLink,
    Placement,
    classify,
    folder_of,
    place_links,
)

SITE = "https://example.com"


def _placed(html: str, url: str = f"{SITE}/blog/a-post") -> dict[str, Placement | None]:
    """First-pass placements by path; None for a link rule 4 left open."""
    return {
        link.href.removeprefix(SITE): None if link.open else link.placement
        for link in classify(html, url)
    }


def _final(pages: dict[str, str]) -> dict[str, dict[str, Placement]]:
    found = {url: classify(html, url) for url, html in pages.items()}
    return {
        url: {link.href.removeprefix(SITE): link.placement for link in links}
        for url, links in place_links(found).items()
    }


# The shape found on cleanstart.com on 2026-11-16: previous and next links in a section named
# "Article navigation", inside main but outside the one article, and not in a nav element.
CLEANSTART = """<!doctype html><html><body>
<header><nav><a href="/">Home</a><a href="/blog">Blog</a></nav></header>
<main>
  <article><h1>A post</h1><p>Read <a href="/guide">our guide</a> first.</p></article>
  <section aria-label="Article navigation">
    <a rel="prev" href="/blog/older">Previous: An older post</a>
    <a rel="next" href="/blog/newer">Next: A newer post</a>
  </section>
  <section class="cta"><a href="/pricing">See plans</a></section>
</main>
<footer><a href="/privacy">Privacy</a></footer>
</body></html>"""


def test_the_cleanstart_article_navigation_is_auto_generated() -> None:
    assert _placed(CLEANSTART) == {
        "/": "navigation",
        "/blog": "navigation",
        "/guide": "content",
        "/blog/older": "auto_generated",
        "/blog/newer": "auto_generated",
        # Rule 4: inside main, outside the one article, left open for the template pass.
        "/pricing": None,
        "/privacy": "footer",
    }


def test_an_open_link_no_block_claims_stays_auto_generated() -> None:
    placed = _final({f"{SITE}/blog/a-post": CLEANSTART})[f"{SITE}/blog/a-post"]

    assert placed["/pricing"] == "auto_generated"
    assert placed["/guide"] == "content"


def test_wordpress_post_navigation_is_auto_generated_by_rel_or_by_class() -> None:
    html = """<main><article><p><a href="/x">x</a></p></article>
    <nav class="navigation post-navigation" aria-label="Posts"><div class="nav-links">
      <div class="nav-previous"><a href="/older/" rel="prev">
        <span class="meta-nav">Previous Post</span> <span>Older</span></a></div>
      <div class="nav-next"><a href="/newer/">
        <span class="meta-nav">Next Post</span> <span>Newer</span></a></div>
    </div></nav></main>"""

    placed = _placed(html)

    assert placed["/older/"] == "auto_generated"
    assert placed["/newer/"] == "auto_generated"


def test_previous_or_next_followed_by_a_title_is_auto_generated() -> None:
    html = """<article><p><a href="/a">Next: How to plan a move</a>
    <a href="/b">Next</a> <a href="/c">Nextcloud setup</a></p></article>"""

    assert _placed(html) == {"/a": "auto_generated", "/b": "content", "/c": "content"}


def test_related_recent_and_popular_blocks_are_auto_generated() -> None:
    html = """<article><p><a href="/body">body</a></p>
    <div class="related-posts"><a href="/r">r</a></div>
    <aside id="recentPosts"><a href="/n">n</a></aside>
    <section aria-label="Popular"><a href="/p">p</a></section>
    <div class="more-posts"><a href="/m">m</a></div></article>"""

    assert _placed(html) == {
        "/body": "content",
        "/r": "auto_generated",
        "/n": "auto_generated",
        "/p": "auto_generated",
        "/m": "auto_generated",
    }


def test_markers_match_whole_words_and_never_html_or_body() -> None:
    html = """<html class="related"><body class="post-navigation">
    <article><div class="unrelated-notes"><a href="/a">a</a></div></article></body></html>"""

    assert _placed(html) == {"/a": "content"}


def test_breadcrumbs_win_over_the_nav_they_sit_in() -> None:
    html = """<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>
    <li><a href="/blog">Blog</a></li></ol></nav>
    <ol itemscope itemtype="https://schema.org/BreadcrumbList"><li><a href="/docs">Docs</a></ol>"""

    assert _placed(html) == {"/": "breadcrumb", "/blog": "breadcrumb", "/docs": "breadcrumb"}


def test_landmarks_by_element_and_by_role() -> None:
    html = """<div role="banner"><a href="/logo"><img alt="Example"></a></div>
    <div role="navigation"><a href="/menu">Menu</a></div>
    <aside><a href="/side">Side</a></aside>
    <div role="complementary"><a href="/side2">Side 2</a></div>
    <div role="contentinfo"><a href="/terms">Terms</a></div>"""

    assert _placed(html) == {
        "/logo": "header",
        "/menu": "navigation",
        "/side": "sidebar",
        "/side2": "sidebar",
        "/terms": "footer",
    }


def test_a_header_or_footer_inside_main_or_article_is_not_a_template() -> None:
    html = """<main><article><header><a href="/author/ann">Ann</a></header>
    <p>Text</p><footer><a href="/tags/moving">moving</a></footer></article>
    <header><a href="/main-header">x</a></header></main>"""

    assert _placed(html) == {
        "/author/ann": "content",
        "/tags/moving": "content",
        # Inside main, outside the one article: rule 4.
        "/main-header": None,
    }


def test_rule_four_needs_exactly_one_article() -> None:
    html = """<main><article><a href="/one">1</a></article><article><a href="/two">2</a></article>
    <div><a href="/outside">out</a></div></main>"""

    assert _placed(html) == {"/one": "content", "/two": "content", "/outside": "content"}


def test_jump_links_self_links_and_script_controls_are_dropped() -> None:
    html = """<article><a href="#top">Top</a><a href="/blog/a-post">Self</a>
    <a href="https://EXAMPLE.com/blog/a-post/#x">Self again</a>
    <a href="mailto:hi@example.com">Mail</a><a href="javascript:void(0)">Menu</a>
    <a>No href</a><button>Open</button>
    <a href="/blog/a-post?page=2">Page 2</a></article>"""

    assert _placed(html) == {"/blog/a-post?page=2": "content"}


def test_text_image_kind_rel_and_base_are_read() -> None:
    html = """<head><base href="https://example.com/docs/"></head>
    <article><a href="guide" rel="NoFollow UGC">  Our
    guide </a><a href="logo"><img src="l.png" alt="The logo"></a>
    <a href="labelled" aria-label="Pricing plans">See</a></article>"""

    links = {link.href: link for link in classify(html, f"{SITE}/blog/a-post")}

    guide = links[f"{SITE}/docs/guide"]
    assert (guide.anchor, guide.kind) == ("Our guide", "text")
    assert guide.rel == frozenset({"nofollow", "ugc"})
    logo = links[f"{SITE}/docs/logo"]
    assert (logo.anchor, logo.kind) == ("The logo", "image")
    assert links[f"{SITE}/docs/labelled"].anchor == "Pricing plans"


def test_implied_ends_keep_list_items_and_paragraphs_apart() -> None:
    html = """<nav><ul class="menu"><li class="item current-menu-item"><a href="/a">A
    <li class="item"><a href="/b">B</a></ul></nav>
    <article><p>One <a href="/c">c</a><div class="box"><a href="/d">d</a></div></article>"""

    links = {link.href.removeprefix(SITE): link for link in classify(html, SITE + "/x")}

    assert links["/a"].container == links["/b"].container
    assert links["/a"].container.endswith("nav/ul.menu/li.item")
    assert links["/d"].container.endswith("article/div.box")
    assert links["/c"].container.endswith("article/p")


def test_links_inside_a_template_element_are_not_on_the_page() -> None:
    html = """<article><template><a href="/hidden">x</a></template><a href="/shown">y</a>
    <br/><img src="a.png"/><a href="/after"/></article>"""

    assert _placed(html) == {"/shown": "content", "/after": "content"}


def test_an_unclosed_or_nested_link_ends_where_the_next_begins() -> None:
    html = '<article><a href="/a">A <a href="/b">B</article><p><a href="/c">C'

    links = classify(html, SITE + "/x")

    assert [(link.href.removeprefix(SITE), link.anchor) for link in links] == [
        ("/a", "A"),
        ("/b", "B"),
        ("/c", "C"),
    ]


def _post(slug: str, body: list[str], block: str) -> str:
    links = " ".join(f'<a href="{href}">{href}</a>' for href in body)
    return f"""<html><body><header><nav><a href="/">Home</a></nav></header>
    <main><article><h1>{slug}</h1><div class="prose"><p>{links}</p></div>{block}</article></main>
    </body></html>"""


def _related(*targets: str) -> str:
    items = "".join(f'<li><a href="{target}">{target}</a></li>' for target in targets)
    return f'<div class="more-reading"><ul>{items}</ul></div>'


CTA = '<div class="cta-band"><a href="/pricing">Pricing</a><a href="/demo">Demo</a></div>'


def test_an_unmarked_related_block_with_changing_targets_is_auto_generated() -> None:
    pages = {
        f"{SITE}/blog/p{n}": _post(f"p{n}", [f"/guide-{n}"], _related(f"/r{n}a", f"/r{n}b"))
        for n in range(5)
    }

    placed = _final(pages)[f"{SITE}/blog/p0"]

    assert placed["/r0a"] == "auto_generated"
    assert placed["/r0b"] == "auto_generated"
    assert placed["/"] == "navigation"


def test_a_block_with_the_same_targets_on_most_pages_is_navigation() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", ["/guide"], CTA) for n in range(4)}
    pages[f"{SITE}/blog/p4"] = _post("p4", ["/guide"], "")

    placed = _final(pages)

    assert placed[f"{SITE}/blog/p0"]["/pricing"] == "navigation"
    assert placed[f"{SITE}/blog/p0"]["/demo"] == "navigation"


def test_a_menu_counts_the_link_each_page_drops_to_itself() -> None:
    menu = "".join(f'<a href="/blog/p{n}">p{n}</a>' for n in range(4))
    pages = {
        f"{SITE}/blog/p{n}": f'<main><article><div class="series">{menu}</div></article></main>'
        for n in range(4)
    }

    placed = _final(pages)

    # Each page holds 3 of the 4 links: without its own, the targets would look different.
    assert set(placed[f"{SITE}/blog/p0"].values()) == {"navigation"}


def test_article_prose_with_changing_targets_stays_content() -> None:
    bodies = [["/a"], ["/b", "/c"], ["/d", "/e", "/f"], ["/g"], ["/h", "/i"]]
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", body, "") for n, body in enumerate(bodies)}

    placed = _final(pages)

    # One container path on every post, different targets, and a link count that changes.
    assert placed[f"{SITE}/blog/p2"] == {
        "/": "navigation",
        "/d": "content",
        "/e": "content",
        "/f": "content",
    }


def test_a_folder_with_too_few_pages_is_left_to_the_first_pass() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", ["/guide"], CTA) for n in range(3)}

    placed = _final(pages)

    assert placed[f"{SITE}/blog/p0"]["/pricing"] == "content"


def test_the_pass_never_changes_a_landmark_placement() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", [f"/x{n}"], "") for n in range(5)}

    placed = _final(pages)

    assert {placement["/"] for placement in placed.values()} == {"navigation"}


def test_a_block_on_fewer_than_half_the_pages_is_left_alone() -> None:
    pages = {f"{SITE}/blog/p{n}": _post(f"p{n}", ["/guide"], "") for n in range(3)}
    pages |= {f"{SITE}/blog/q{n}": _post(f"q{n}", ["/guide"], CTA) for n in range(2)}

    placed = _final(pages)

    assert placed[f"{SITE}/blog/q0"]["/pricing"] == "content"


@pytest.mark.parametrize(
    ("url", "folder"),
    [
        (f"{SITE}/", ""),
        (f"{SITE}/pricing", ""),
        (f"{SITE}/blog", ""),
        (f"{SITE}/blog/a-post", "blog"),
        (f"{SITE}/docs/api/v1/", "docs"),
    ],
)
def test_the_folder_is_the_first_of_two_or_more_segments(url: str, folder: str) -> None:
    assert folder_of(url) == folder


def test_placement_values_are_the_seven_of_the_spec() -> None:
    assert PLACEMENTS == (
        "content",
        "auto_generated",
        "navigation",
        "header",
        "footer",
        "sidebar",
        "breadcrumb",
    )


def test_an_open_link_is_auto_generated_and_marked_open() -> None:
    (link,) = [
        link
        for link in classify(CLEANSTART, f"{SITE}/blog/a-post")
        if link.href.endswith("/pricing")
    ]

    assert (link.placement, link.open) == (Placement.AUTO_GENERATED, True)


def test_place_links_keeps_every_link_in_order_and_changes_only_what_it_claims() -> None:
    link = FoundLink(
        href=f"{SITE}/a",
        anchor="a",
        kind="text",
        rel=frozenset(),
        placement=Placement.AUTO_GENERATED,
        container="",
        open=True,
    )

    placed = place_links({f"{SITE}/x": [link, link]})

    assert placed == {f"{SITE}/x": [link, link]}
```

- [ ] **Step 2: See them fail**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike/backend
uv run pytest tests/crawl --no-cov -q
```

Expected: `ImportError while importing test module` for `tests/crawl/test_placement.py`, `E   ModuleNotFoundError: No module named 'idraft.crawl.placement'`, and `1 error`.

- [ ] **Step 3: Write the classifier**

`backend/src/idraft/crawl/placement.py`:

```python
"""Where a link sits on its page (docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md
section 6.3).

Two passes. `classify` reads one page and gives each link the placement of rules 1 to 5; a link
rule 4 leaves open is `auto_generated` with `open` set. `place_links` takes every page of a crawl
and runs the template pass, which needs the other pages of the same folder. Both are pure: no I/O,
no clock.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from enum import StrEnum
from html.parser import HTMLParser
from typing import Final, Literal
from urllib.parse import urldefrag, urljoin, urlsplit


class Placement(StrEnum):
    CONTENT = "content"
    AUTO_GENERATED = "auto_generated"
    NAVIGATION = "navigation"
    HEADER = "header"
    FOOTER = "footer"
    SIDEBAR = "sidebar"
    BREADCRUMB = "breadcrumb"


PLACEMENTS: Final[tuple[str, ...]] = tuple(placement.value for placement in Placement)
LinkKind = Literal["text", "image"]

# Template pass thresholds. TEMPLATE_SHARE is the spec's 50%; the other three are the guards
# of plan 01 Decision 6 (amendments to section 6.3, settled by spike S-17).
TEMPLATE_SHARE: Final = 0.5
SAME_TARGETS: Final = 0.8
STEADY_COUNT: Final = 0.8
MIN_FOLDER_PAGES: Final = 4

# Rule 1: names of article navigation, post navigation, pagination, related, recent, popular
# and more posts blocks, matched as whole words of the normalized attribute text.
_AUTO_MARKERS: Final = re.compile(
    r"\b(?:(?:article|post|posts|entry|story) nav(?:igation)?"
    r"|nav (?:previous|next)|pagination|pager|related|recent|popular"
    r"|(?:more|latest|similar) (?:posts|articles|stories))\b"
)
_PREV_NEXT_TEXT: Final = re.compile(r"^\W*(?:previous|next)\b\W*\w", re.IGNORECASE)
_CAMEL: Final = re.compile(r"([a-z0-9])([A-Z])")
_NOT_WORD: Final = re.compile(r"[^a-z0-9]+")
# Class names that are the same on every page: letters, hyphens and underscores only, and not
# a state that follows the page in view (the menu item of the current page).
_STABLE_CLASS: Final = re.compile(r"[a-z][a-z_-]*")
_STATE_CLASS: Final = re.compile(r"active|current|selected|open")
_ROLES: Final = {
    "navigation": "nav",
    "banner": "header",
    "contentinfo": "footer",
    "complementary": "aside",
    "main": "main",
}
# fmt: off
_VOID: Final = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr",
})
# Blocks whose start ends an open paragraph (the HTML parsing rule, simplified).
_ENDS_P: Final = frozenset({
    "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "figure", "footer",
    "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "main", "nav", "ol", "p", "pre",
    "section", "table", "ul",
})
# The containers the template pass groups links by.
_BLOCKS: Final = frozenset({
    "article", "aside", "blockquote", "dd", "div", "dl", "figure", "footer", "form", "header",
    "li", "main", "nav", "ol", "p", "section", "table", "td", "ul",
})
# fmt: on
_P_SCOPE: Final = (_ENDS_P - {"p"}) | {"li", "td", "th", "body", "html", "button"}


@dataclass(frozen=True, slots=True)
class FoundLink:
    """One link of a page. `href` is absolute, without its fragment; `anchor` is its accessible
    text (aria-label, words, or the alt of its images); `open` is true for a link rule 4 left to
    the template pass, which stays `auto_generated` unless the pass claims it."""

    href: str
    anchor: str
    kind: LinkKind
    rel: frozenset[str]
    placement: Placement
    container: str
    open: bool


@dataclass(eq=False, slots=True)
class _Element:
    tag: str
    attrs: dict[str, str]


@dataclass(slots=True)
class _RawLink:
    href: str
    rel: str
    label: str
    ancestors: tuple[_Element, ...]
    element: _Element
    text: list[str] = field(default_factory=list)
    alts: list[str] = field(default_factory=list)


class _Reader(HTMLParser):
    """Builds the open-element stack while reading, and keeps each link with its ancestors.

    shortcut: `html.parser` builds no HTML5 tree; only the implied ends that move links between
    containers (`p`, `li`, nested `a`) are handled. Upgrade to an HTML5 parser (selectolax or
    lxml) if spike S-17 finds links misplaced by broken markup.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[_Element] = []
        self.links: list[_RawLink] = []
        self.articles = 0
        self.base: str | None = None
        self._open: _RawLink | None = None
        self._in_template = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "template":
            self._in_template += 1
            return
        if self._in_template:
            return
        values = {name: value or "" for name, value in attrs}
        if tag == "base" and self.base is None and values.get("href"):
            self.base = values["href"]
        if tag == "img" and self._open is not None:
            self._open.alts.append(values.get("alt", ""))
        if tag in _VOID:
            return
        if tag in _ENDS_P:
            self._close("p", stop=_P_SCOPE)
        if tag == "li":
            self._close("li", stop=frozenset({"ul", "ol", "menu"}))
        if tag == "a" and self._open is not None:
            self._close_element(self._open.element)
        element = _Element(tag, values)
        if tag == "article":
            self.articles += 1
        if tag == "a" and "href" in values:
            self._open = _RawLink(
                href=values["href"],
                rel=values.get("rel", ""),
                label=values.get("aria-label", ""),
                ancestors=tuple(self.stack),
                element=element,
            )
        self.stack.append(element)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in _VOID and not self._in_template and self.stack:
            self._close_element(self.stack[-1])

    def handle_endtag(self, tag: str) -> None:
        if tag == "template":
            self._in_template = max(0, self._in_template - 1)
            return
        if self._in_template or tag in _VOID:
            return
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                self._close_element(self.stack[index])
                return

    def handle_data(self, data: str) -> None:
        if self._open is not None and not self._in_template:
            self._open.text.append(data)

    def close(self) -> None:
        super().close()
        if self._open is not None:
            self._finish()

    def _close(self, tag: str, *, stop: frozenset[str]) -> None:
        for element in reversed(self.stack):
            if element.tag == tag:
                self._close_element(element)
                return
            if element.tag in stop:
                return

    def _close_element(self, element: _Element) -> None:
        index = next(i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i] is element)
        if self._open is not None and any(e is self._open.element for e in self.stack[index:]):
            self._finish()
        del self.stack[index:]

    def _finish(self) -> None:
        if self._open is not None:
            self.links.append(self._open)
            self._open = None


def _marker_text(element: _Element) -> str:
    raw = " ".join(element.attrs.get(name, "") for name in ("aria-label", "class", "id"))
    return " " + _NOT_WORD.sub(" ", _CAMEL.sub(r"\1 \2", raw).lower()) + " "


def _is_breadcrumb(element: _Element) -> bool:
    names = ("aria-label", "class", "id", "itemtype")
    return any("breadcrumb" in element.attrs.get(name, "").lower() for name in names)


def _landmark(element: _Element) -> str:
    role = element.attrs.get("role", "").split()
    return _ROLES.get(role[0].lower(), element.tag) if role else element.tag


def _first_pass(
    ancestors: Sequence[_Element], rel: frozenset[str], text: str, articles: int
) -> Placement | None:
    """Rules 1 to 5; None when rule 4 leaves the link open."""
    named = [element for element in ancestors if element.tag not in ("html", "body")]
    if (
        rel & {"prev", "next"}
        or _PREV_NEXT_TEXT.match(text)
        or any(_AUTO_MARKERS.search(_marker_text(element)) for element in named)
    ):
        return Placement.AUTO_GENERATED
    if any(_is_breadcrumb(element) for element in named):
        return Placement.BREADCRUMB
    landmarks = [_landmark(element) for element in ancestors]
    if "nav" in landmarks:
        return Placement.NAVIGATION
    for index, landmark in enumerate(landmarks):
        if landmark in ("header", "footer") and not {"main", "article"} & set(landmarks[:index]):
            return Placement.HEADER if landmark == "header" else Placement.FOOTER
    if "aside" in landmarks:
        return Placement.SIDEBAR
    if articles == 1 and "main" in landmarks and "article" not in landmarks:
        return None
    return Placement.CONTENT


def _step(element: _Element) -> str:
    classes = sorted(
        {
            name
            for name in element.attrs.get("class", "").lower().split()
            if _STABLE_CLASS.fullmatch(name) and not _STATE_CLASS.search(name)
        }
    )
    return "".join([element.tag, *(f".{name}" for name in classes)])


def _container(ancestors: Sequence[_Element]) -> str:
    """The structural path of the nearest block container, list positions left out."""
    end = len(ancestors)
    for index in range(len(ancestors) - 1, -1, -1):
        if ancestors[index].tag in _BLOCKS:
            end = index + 1
            break
    return "/".join(_step(element) for element in ancestors[:end])


def page_key(url: str) -> str:
    """A URL as compared for self links: host in lower case, no trailing slash, no fragment."""
    parts = urlsplit(url)
    path = parts.path.rstrip("/") or "/"
    return f"{(parts.hostname or '').lower()}{path}?{parts.query}"


def folder_of(url: str) -> str:
    """The top-level folder the template pass groups a page by: `blog` for `/blog/a-post`,
    and the empty string for the home page and pages one level deep."""
    segments = [segment for segment in urlsplit(url).path.split("/") if segment]
    return segments[0] if len(segments) > 1 else ""


def classify(html: str, page_url: str) -> list[FoundLink]:
    """Rules 1 to 5 for every link of one page, in document order. Jump links, links to the
    page itself and links that are not http or https are dropped first."""
    reader = _Reader()
    reader.feed(html)
    reader.close()
    base = urljoin(page_url, reader.base) if reader.base else page_url
    own = page_key(page_url)
    found: list[FoundLink] = []
    for raw in reader.links:
        href = raw.href.strip()
        if not href or href.startswith("#"):
            continue
        target = urldefrag(urljoin(base, href)).url
        if urlsplit(target).scheme not in ("http", "https") or page_key(target) == own:
            continue
        words = " ".join("".join(raw.text).split())
        alts = " ".join(" ".join(raw.alts).split())
        text = " ".join(raw.label.split()) or words or alts
        rel = frozenset(raw.rel.lower().split())
        placement = _first_pass(raw.ancestors, rel, text, reader.articles)
        found.append(
            FoundLink(
                href=target,
                anchor=text,
                kind="image" if raw.alts and not words else "text",
                rel=rel,
                placement=placement or Placement.AUTO_GENERATED,
                container=_container(raw.ancestors),
                open=placement is None,
            )
        )
    return found


def place_links(
    pages: Mapping[str, Sequence[FoundLink]],
    *,
    template_share: float = TEMPLATE_SHARE,
    same_targets: float = SAME_TARGETS,
    steady_count: float = STEADY_COUNT,
    min_folder_pages: int = MIN_FOLDER_PAGES,
) -> dict[str, list[FoundLink]]:
    """The template pass over every page of a crawl, keyed by page URL, links in the same order.
    It only changes links the first pass called `content` or left open; an open link it does not
    claim stays `auto_generated`."""
    folders: dict[str, list[str]] = defaultdict(list)
    for url in pages:
        folders[folder_of(url)].append(url)
    claimed: dict[tuple[str, int], Placement] = {}
    for urls in folders.values():
        if len(urls) < min_folder_pages:
            continue
        # container -> page -> positions of the links the pass may change
        blocks: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(list))
        for url in urls:
            for position, link in enumerate(pages[url]):
                if link.open or link.placement is Placement.CONTENT:
                    blocks[link.container][url].append(position)
        for on_pages in blocks.values():
            if len(on_pages) < template_share * len(urls):
                continue
            placement = _block_placement(pages, on_pages, same_targets, steady_count)
            if placement is None:
                continue
            for url, positions in on_pages.items():
                for position in positions:
                    claimed[(url, position)] = placement
    return {
        url: [
            replace(link, placement=claimed[(url, position)])
            if (url, position) in claimed
            else link
            for position, link in enumerate(links)
        ]
        for url, links in pages.items()
    }


def _block_placement(
    pages: Mapping[str, Sequence[FoundLink]],
    on_pages: Mapping[str, Sequence[int]],
    same_targets: float,
    steady_count: float,
) -> Placement | None:
    targets = {
        url: {page_key(pages[url][position].href) for position in positions}
        for url, positions in on_pages.items()
    }
    keys = {url: page_key(url) for url in on_pages}
    union = set().union(*targets.values())
    # A page's link to itself was dropped, so a page counts as linking to itself here.
    coverage = [
        sum(1 for url in on_pages if target in targets[url] or target == keys[url]) / len(on_pages)
        for target in union
    ]
    if sum(coverage) / len(coverage) >= same_targets:
        return Placement.NAVIGATION
    counts = Counter(len(positions) for positions in on_pages.values())
    if counts.most_common(1)[0][1] / len(on_pages) >= steady_count:
        return Placement.AUTO_GENERATED
    return None
```

- [ ] **Step 4: See them pass, with the branch coverage the gate needs**

```bash
uv run pytest tests/crawl --no-cov -q
uv run pytest tests/crawl -q -o addopts="" --cov=idraft.crawl --cov-branch --cov-report=term-missing
```

Expected: `30 passed`; the coverage line for `src/idraft/crawl/placement.py` reads `225 0 94 4 99%` (statements, missed, branches, partial branches). The new module therefore lifts, never lowers, the suite's 90% gate.

- [ ] **Step 5: Add the purity contract for the classifier**

In `backend/pyproject.toml`, insert before the `[[tool.importlinter.contracts]]` header of `name = "providers never touch the database"` a new contract:

```toml
[[tool.importlinter.contracts]]
name = "crawl placement is pure: no internal imports, no I/O libraries"
type = "forbidden"
source_modules = ["idraft.crawl.placement"]
forbidden_modules = [
  "idraft.api", "idraft.worker", "idraft.collectors", "idraft.providers",
  "idraft.db", "idraft.storage", "idraft.config", "idraft.domain",
  "sqlalchemy", "asyncpg", "redis", "httpx", "fastapi", "starlette",
]

```

It names the module, not the package, so plan 02 can add I/O modules to `idraft.crawl` (ingest, storage) and keep `placement` pure. Then:

```bash
uv run lint-imports
```

Expected: `crawl placement is pure: no internal imports, no I/O libraries KEPT` and `Contracts: 7 kept, 0 broken.`

- [ ] **Step 6: Gates and commit**

Run the gates. Then:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
grep -nP '[^\x00-\x7F]' backend/src/idraft/crawl/placement.py backend/tests/crawl/test_placement.py backend/pyproject.toml
git add backend/src/idraft/crawl/placement.py backend/tests/crawl/__init__.py backend/tests/crawl/test_placement.py backend/pyproject.toml
git commit -m "Classify internal link placement from page HTML (spec 6.3)"
```

## Task 4: The S-17 spike script

**Files:**
- Create: `backend/tests/spikes/test_s17.py`
- Create: `backend/spikes/s17_on_page_crawl.py`

- [ ] **Step 1: Write the tests**

They cover everything that runs without the network: the estimates and the cap arithmetic of Decision 4, the robots rule, depth through redirects, the sample key, the accuracy tables, the spend ledger, and `measure`, `classify` and `score` on a raw folder written by hand. `backend/tests/spikes/test_s17.py`:

```python
"""What S-17 does with what it keeps: the estimates, robots, depth, the sample and the score.
No network: the raw directory is written by hand in a temporary folder."""

from __future__ import annotations

import csv
import json
from collections import Counter
from decimal import Decimal
from pathlib import Path

import pytest

from idraft.crawl.placement import PLACEMENTS
from spikes.s17_on_page_crawl import (
    VARIANTS,
    SpikeError,
    accuracy,
    classify_site,
    click_depths,
    estimate,
    measure,
    render_accuracy,
    render_confusion,
    robots_allows,
    sample_key,
    scope_of,
    score,
    spent_so_far,
)

SITE = "example.com"


def test_every_crawl_of_the_spike_fits_the_five_dollar_cap() -> None:
    assert estimate(VARIANTS["main"]) == Decimal("0.60000")
    assert estimate(VARIANTS["no_sitemap"]) == Decimal("0.30000")
    assert estimate(VARIANTS["stop_raw"]) == Decimal("0.03000")
    assert estimate(VARIANTS["stop_plain"]) == Decimal("0.01500")
    assert estimate(VARIANTS["smoke"]) == Decimal("0.00300")
    per_site = estimate(VARIANTS["main"]) + estimate(VARIANTS["no_sitemap"])
    cleanstart_only = sum(
        (estimate(VARIANTS[name]) for name in ("smoke", "stop_raw", "stop_plain")), Decimal(0)
    )
    assert 3 * per_site + cleanstart_only == Decimal("2.74800")


def test_robots_must_allow_both_agents() -> None:
    url = f"https://{SITE}/"

    assert robots_allows("", url)
    assert robots_allows("User-agent: *\nDisallow: /admin/", url)
    assert not robots_allows("User-agent: *\nDisallow: /", url)
    assert not robots_allows("User-agent: RSiteAuditor\nDisallow: /", url)


def test_depth_follows_links_and_redirects_from_the_start() -> None:
    edges = [
        (f"https://{SITE}/", f"https://{SITE}/a/"),
        (f"https://{SITE}/a", f"https://{SITE}/old"),
        (f"https://{SITE}/old", f"https://{SITE}/new"),
        (f"https://{SITE}/island", f"https://{SITE}/a"),
    ]

    depths = click_depths(edges, f"https://{SITE}/")

    assert depths == {f"{SITE}/?": 0, f"{SITE}/a?": 1, f"{SITE}/old?": 2, f"{SITE}/new?": 3}


def test_the_sample_order_depends_on_the_link_place_only() -> None:
    assert sample_key("https://example.com/a", 3) == sample_key("https://example.com/a", 3)
    assert sample_key("https://example.com/a", 3) != sample_key("https://example.com/a", 4)


def test_each_placement_has_one_scope() -> None:
    assert [scope_of(placement) for placement in PLACEMENTS] == [
        "editorial",
        "auto_generated",
        "template",
        "template",
        "template",
        "template",
        "template",
    ]


def test_accuracy_and_its_tables() -> None:
    table = Counter({("editorial", "editorial"): 9, ("editorial", "template"): 1})

    assert accuracy(table) == (9, 10)
    assert render_accuracy("Scope", table).startswith("Scope: 9 of 10 (90.0%, 95% interval")
    assert render_accuracy("Scope", Counter()) == "Scope: no labelled rows"
    assert render_confusion(table, ("editorial", "template")) == [
        "| Human \\ predicted | editorial | template | n | Right |",
        "|---|---|---|---|---|",
        "| editorial | 9 | 1 | 10 | 90% |",
        "| template | 0 | 0 | 0 | n/a |",
    ]


def _crawl(raw: Path, variant: str, cost: str | None) -> Path:
    folder = raw / SITE / variant
    (folder / "html").mkdir(parents=True)
    meta = {
        "site": SITE,
        "variant": variant,
        "settings": {"max_pages": 100, "respect_sitemap": True, "store_raw_html": True},
        "estimate": "0.03",
        "cost": cost,
        "posted_at": "2026-11-17T10:00:00+00:00",
        "finished_at": "2026-11-17T10:04:00+00:00",
        "balance_drop": "0.015",
    }
    (folder / "meta.json").write_text(json.dumps(meta))
    summary = {
        "tasks": [
            {
                "result": [
                    {
                        "crawl_progress": "finished",
                        "crawl_stop_reason": "limit_exceeded",
                        "crawl_status": {
                            "max_crawl_pages": 100,
                            "pages_in_queue": 40,
                            "pages_crawled": 100,
                        },
                    }
                ]
            }
        ]
    }
    (folder / "summary.json").write_text(json.dumps(summary))
    return folder


POST = """<html><body><header><nav><a href="/">Home</a></nav></header>
<main><article><p><a href="/guide">guide</a></p></article>
<section aria-label="Article navigation"><a rel="next" href="/blog/{after}">Next: After</a>
</section></main><footer><a href="https://other.org/">Elsewhere</a></footer></body></html>"""


def _with_pages(folder: Path) -> None:
    pages, calls = [], []
    for number in range(3):
        url = f"https://{SITE}/blog/p{number}"
        name = f"{number:05d}.html"
        (folder / "html" / name).write_text(POST.format(after=f"p{number + 1}"))
        pages.append({"url": url, "resource_type": "html", "status_code": 200, "click_depth": 0})
        calls.append({"url": url, "file": name, "error": None, "seconds": 0.5})
    calls.append({"url": f"https://{SITE}/gone", "file": None, "error": "x", "seconds": 1.0})
    pages.append({"url": f"https://{SITE}/old", "location": f"https://{SITE}/blog/p0"})
    (folder / "pages.jsonl").write_text("".join(json.dumps(page) + "\n" for page in pages))
    (folder / "raw_html.jsonl").write_text("".join(json.dumps(call) + "\n" for call in calls))
    links = [
        {"type": "anchor", "link_from": f"https://{SITE}/", "link_to": f"https://{SITE}/blog/p0"},
        {"type": "image", "link_from": f"https://{SITE}/blog/p0", "link_to": f"https://{SITE}/",
         "text": "", "image_alt": "Logo", "link_attribute": ["nofollow"], "dofollow": False},
        {"type": "redirect", "link_from": f"https://{SITE}/old",
         "link_to": f"https://{SITE}/blog/p0", "page_to_status_code": 301},
    ]  # fmt: skip
    (folder / "links.jsonl").write_text("".join(json.dumps(link) + "\n" for link in links))


def test_spent_so_far_adds_costs_and_estimates(tmp_path: Path) -> None:
    _crawl(tmp_path, "stop_raw", "0.015")
    _crawl(tmp_path, "stop_plain", None)

    assert spent_so_far(tmp_path) == Decimal("0.045")


def test_measure_reports_speed_stop_cost_sitemap_and_link_shape(tmp_path: Path) -> None:
    for variant in ("main", "no_sitemap"):
        _with_pages(_crawl(tmp_path, variant, "0.30"))

    measure(SITE, tmp_path)

    report = (tmp_path / SITE / "measure.md").read_text()
    assert "pages per minute: 25.0" in report
    assert "stop reason `limit_exceeded`" in report
    assert "per page crawled: $0.003000" in report
    assert "raw_html: 4 calls, 3 with HTML" in report
    # Only p0 is linked from the home page; p1, p2 and the redirect are not reached.
    assert "our depth reaches 1, deepest 1; not reachable by links: 3" in report
    assert "Internal links by type: {'anchor': 1, 'image': 1, 'redirect': 1}" in report
    assert "with an image_alt: 1" in report
    assert "Links to a 3xx page: 1; not dofollow: 1" in report
    # Ours from the HTML: 3 posts x (home, guide, next). Theirs: the anchor from the home page
    # is left out (no HTML kept for it); the image link from p0 to the home page is in ours.
    assert "pairs: ours 9, DataForSEO 1; theirs we miss: 0 (0.0%); only ours: 8" in report


def _label(path: Path, labels: dict[str, str], field: str) -> None:
    with path.open(newline="") as file:
        rows = list(csv.DictReader(file))
    for row in rows:
        row[field] = labels.get(row.get("predicted", ""), labels.get("*", ""))
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def test_classify_then_score_and_a_rerun_keeps_the_labels(tmp_path: Path) -> None:
    _with_pages(_crawl(tmp_path, "main", "0.30"))
    root = tmp_path / SITE

    classify_site(SITE, tmp_path, "blog")
    _label(root / "sample.csv", {"navigation": "navigation", "*": "content"}, "human_label")
    _label(root / "posts.csv", {"*": "yes"}, "human_has_prev_next")
    _label(root / "posts.csv", {"*": "yes"}, "human_all_found")
    classify_site(SITE, tmp_path, "blog")
    score(SITE, tmp_path)

    with (root / "sample.csv").open(newline="") as file:
        rows = list(csv.DictReader(file))
    # Three posts with three internal links each; the external footer link is left out.
    assert len(rows) == 9
    assert all(row["human_label"] for row in rows)
    report = (root / "score.md").read_text()
    # The next links were labelled content by the stand-in labeller, so 6 of 9 agree.
    assert "Scope (editorial, auto-generated, template): 6 of 9" in report
    assert "all of them found as auto_generated: 3 of 3" in report


def test_score_refuses_an_unknown_label(tmp_path: Path) -> None:
    _with_pages(_crawl(tmp_path, "main", "0.30"))
    classify_site(SITE, tmp_path, "blog")
    _label(tmp_path / SITE / "sample.csv", {"*": "menu"}, "human_label")

    with pytest.raises(SpikeError, match="is not one of"):
        score(SITE, tmp_path)


def test_classify_needs_the_main_crawl(tmp_path: Path) -> None:
    with pytest.raises(SpikeError, match="run crawl --variant main first"):
        classify_site(SITE, tmp_path, "blog")
```

- [ ] **Step 2: See them fail**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike/backend
uv run pytest tests/spikes/test_s17.py --no-cov -q
```

Expected: `ImportError while importing test module` for `tests/spikes/test_s17.py`, `E   ModuleNotFoundError: No module named 'spikes.s17_on_page_crawl'`, and `1 error`.

- [ ] **Step 3: Write the script**

`backend/spikes/s17_on_page_crawl.py`:

```python
"""S-17: DataForSEO On-Page crawls for the internal link tracker
(docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md section 10).

Four subcommands. Only `crawl` calls DataForSEO and spends money; it keeps every answer under the
raw directory, and the other three read only from there, so they can be run again for free.

    uv run python -m spikes.s17_on_page_crawl crawl --site cleanstart.com --variant smoke --cap 5
    uv run python -m spikes.s17_on_page_crawl measure --site cleanstart.com
    uv run python -m spikes.s17_on_page_crawl classify --site cleanstart.com --posts-folder blog
    uv run python -m spikes.s17_on_page_crawl score --site cleanstart.com

The cap counts every crawl kept under the raw directory, so one cap covers the whole spike.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import time
from collections import Counter, deque
from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, Final, Literal
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
from uuid import uuid4

import httpx

from idraft.crawl.placement import PLACEMENTS, Placement, folder_of, page_key, place_links
from idraft.crawl.placement import classify as classify_page
from idraft.providers.contract import ProviderCallError, ProviderError
from idraft.providers.dataforseo.client import DataForSeoClient
from idraft.providers.dataforseo.errors import read_status
from idraft.providers.dataforseo.tags import make_tag
from spikes.common import (
    INSTALLATION,
    Budget,
    first_result,
    live,
    median,
    percentile,
    run,
    say,
    task_cost,
    wilson,
)

# Kept out of git (.gitignore: backend/spikes/raw/). Holds third-party HTML: never commit it.
RAW: Final = Path(__file__).resolve().parent / "raw" / "s17"
# Base price of a crawled page without JavaScript (spec section 6.1, pricing page 2026-11-16).
PAGE_PRICE: Final = Decimal("0.00015")
# Whether `store_raw_html` costs extra is what the spike finds out: until then it is read as
# doubling the page price, the dearer guess.
RAW_HTML_FACTOR: Final = Decimal(2)
POLL_EVERY: Final = timedelta(seconds=30)
CRAWL_WITHIN: Final = timedelta(hours=4)
PAGE_SIZE: Final = 1000
# `*` and DataForSEO's crawler. Its user agent name is checked in the smoke crawl's log.
CRAWLER_AGENTS: Final = ("*", "RSiteAuditor")
SEED: Final = 17
SAMPLE_LINKS: Final = 100
SAMPLE_POSTS: Final = 30
LABELS: Final = ("yes", "no")
# The link scopes of spec section 4, for scoring only: plan 02 owns them in production.
SCOPES: Final = ("editorial", "auto_generated", "template")


class SpikeError(RuntimeError):
    """A step of the run that cannot go on, with the reason."""


@dataclass(frozen=True, slots=True)
class Variant:
    max_pages: int
    respect_sitemap: bool
    store_raw_html: bool


VARIANTS: Final = {
    # A first look at every answer's keys before any large crawl.
    "smoke": Variant(max_pages=10, respect_sitemap=True, store_raw_html=True),
    # The settings of spec section 6.1: questions 1, 4 and 5.
    "main": Variant(max_pages=2000, respect_sitemap=True, store_raw_html=True),
    # Question 3: the same site without the sitemap (and without raw HTML, which it does not need).
    "no_sitemap": Variant(max_pages=2000, respect_sitemap=False, store_raw_html=False),
    # Questions 1 and 2 on cleanstart.com: a crawl that must stop at its page cap, with and
    # without raw HTML, so the price of `store_raw_html` is the only difference.
    "stop_raw": Variant(max_pages=100, respect_sitemap=True, store_raw_html=True),
    "stop_plain": Variant(max_pages=100, respect_sitemap=True, store_raw_html=False),
}


def estimate(variant: Variant) -> Decimal:
    """The most one crawl can cost: every page of its cap, at the dearer raw HTML guess."""
    factor = RAW_HTML_FACTOR if variant.store_raw_html else Decimal(1)
    return variant.max_pages * PAGE_PRICE * factor


def scope_of(placement: str) -> str:
    if placement == Placement.CONTENT:
        return "editorial"
    if placement == Placement.AUTO_GENERATED:
        return "auto_generated"
    return "template"


def robots_allows(robots_txt: str, url: str) -> bool:
    """Whether robots.txt lets both `*` and DataForSEO's crawler fetch the URL."""
    parser = RobotFileParser()
    parser.parse(robots_txt.splitlines())
    return all(parser.can_fetch(agent, url) for agent in CRAWLER_AGENTS)


def click_depths(edges: Iterable[tuple[str, str]], start: str) -> dict[str, int]:
    """Fewest clicks from `start` over the given (source, target) edges, by page key."""
    following: dict[str, list[str]] = {}
    for source, target in edges:
        following.setdefault(page_key(source), []).append(page_key(target))
    depths = {page_key(start): 0}
    queue = deque([page_key(start)])
    while queue:
        page = queue.popleft()
        for target in following.get(page, []):
            if target not in depths:
                depths[target] = depths[page] + 1
                queue.append(target)
    return depths


def sample_key(source: str, position: int) -> str:
    """The order a sample is drawn in. It depends only on where the link is, never on what it
    was predicted to be, so a run with other thresholds keeps the same rows and their labels."""
    return hashlib.sha256(f"{SEED}:{source}:{position}".encode()).hexdigest()


def confusion(pairs: Iterable[tuple[str, str]]) -> Counter[tuple[str, str]]:
    """(human label, predicted) counts."""
    return Counter(pairs)


def accuracy(table: Counter[tuple[str, str]]) -> tuple[int, int]:
    """Correct and total."""
    return sum(n for (human, predicted), n in table.items() if human == predicted), sum(
        table.values()
    )


def render_confusion(table: Counter[tuple[str, str]], classes: Sequence[str]) -> list[str]:
    lines = [
        "| Human \\ predicted | " + " | ".join(classes) + " | n | Right |",
        "|---" * (len(classes) + 3) + "|",
    ]
    for human in classes:
        row = [table[(human, predicted)] for predicted in classes]
        total = sum(row)
        right = f"{table[(human, human)] / total:.0%}" if total else "n/a"
        lines.append(f"| {human} | " + " | ".join(map(str, row)) + f" | {total} | {right} |")
    return lines


def render_accuracy(name: str, table: Counter[tuple[str, str]]) -> str:
    correct, total = accuracy(table)
    if total == 0:
        return f"{name}: no labelled rows"
    low, high = wilson(correct, total)
    share = correct / total
    return f"{name}: {correct} of {total} ({share:.1%}, 95% interval {low:.1%} to {high:.1%})"


def _site_dir(raw: Path, site: str) -> Path:
    return raw / site


def _read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    if not path.exists():
        return
    with path.open(encoding="utf-8") as file:
        for line in file:
            if line.strip():
                row: dict[str, Any] = json.loads(line)
                yield row


def spent_so_far(raw: Path) -> Decimal:
    """What every kept crawl cost, by DataForSEO's `cost`, or at its estimate when unknown."""
    total = Decimal(0)
    for meta_path in raw.glob("*/*/meta.json"):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        total += Decimal(meta["cost"] if meta.get("cost") is not None else meta["estimate"])
    return total


async def _call(
    client: DataForSeoClient,
    method: Literal["GET", "POST"],
    path: str,
    body: list[dict[str, object]] | None = None,
    *,
    sending: bool = False,
    family: str | None = None,
) -> dict[str, Any]:
    """One call; the whole answer, or SpikeError when the task in it failed. `family` stays
    None for On-Page calls: the local gate knows only the families of `FAMILY_LIMITS`."""
    answered = await client.call(method, path, family=family, sending=sending, body=body)
    task = answered.tasks[0] if answered.tasks else None
    if task is None:
        raise SpikeError(f"{path}: the answer holds no readable task")
    outcome = read_status(task.status_code, task.status_message, sending=sending)
    if isinstance(outcome, ProviderError):
        raise SpikeError(f"{path}: {outcome.kind.value} {outcome.message}")
    parsed: dict[str, Any] = json.loads(answered.content)
    return parsed


async def _balance(client: DataForSeoClient) -> Decimal | None:
    """The account balance, kept only to work out what a crawl took from it."""
    result = first_result(await _call(client, "GET", "/v3/appendix/user_data", family="user_data"))
    money = result.get("money") or {}
    balance = money.get("balance")
    return None if balance is None else Decimal(str(balance))


async def _robots(site: str, folder: Path) -> None:
    start = f"https://{site}/"
    async with httpx.AsyncClient(
        follow_redirects=True, headers={"user-agent": "idraft-spike"}, timeout=30
    ) as http:
        answer = await http.get(f"https://{site}/robots.txt")
    if answer.status_code in (404, 410):
        text = ""
    elif answer.status_code == 200:
        text = answer.text
    else:
        raise SpikeError(f"robots.txt answered {answer.status_code}: not crawled")
    (folder / "robots.txt").write_text(text, encoding="utf-8")
    if not robots_allows(text, start):
        raise SpikeError(f"robots.txt of {site} does not allow crawling {start}: not crawled")


async def _collect(
    client: DataForSeoClient,
    path: str,
    task_id: str,
    out: Path,
    filters: list[object] | None = None,
) -> tuple[int, list[str], list[str]]:
    """Every item of a list endpoint into a JSON lines file. Returns the count, the keys of the
    first result and the keys of its first item, which the smoke crawl prints."""
    token: str | None = None
    offset = 0
    keys: list[str] = []
    result_keys: list[str] = []
    with out.open("w", encoding="utf-8") as file:
        while True:
            body: dict[str, object] = {"id": task_id, "limit": PAGE_SIZE}
            if filters:
                body["filters"] = filters
            if token:
                body["search_after_token"] = token
            else:
                body["offset"] = offset
            result = first_result(await _call(client, "POST", path, [body]))
            result_keys = result_keys or sorted(result)
            total = result.get("total_items_count")
            if total is None:
                raise SpikeError(f"{path}: no total_items_count in the answer: {sorted(result)}")
            items: list[dict[str, Any]] = list(result.get("items") or [])
            if items and not keys:
                keys = sorted(items[0])
            for item in items:
                file.write(json.dumps(item, ensure_ascii=False) + "\n")
            offset += len(items)
            if not items or offset >= int(total):
                return offset, result_keys, keys
            token = result.get("search_after_token") or None


async def _wait(client: DataForSeoClient, task_id: str, folder: Path) -> dict[str, Any]:
    deadline = time.monotonic() + CRAWL_WITHIN.total_seconds()
    with (folder / "progress.jsonl").open("w", encoding="utf-8") as progress:
        while True:
            body = await _call(client, "GET", f"/v3/on_page/summary/{task_id}")
            result = dict(first_result(body))
            status = result.get("crawl_status") or {}
            row = {
                "at": datetime.now(UTC).isoformat(),
                "progress": result.get("crawl_progress"),
                "pages_crawled": status.get("pages_crawled"),
                "pages_in_queue": status.get("pages_in_queue"),
            }
            progress.write(json.dumps(row) + "\n")
            progress.flush()
            if result.get("crawl_progress") == "finished":
                (folder / "summary.json").write_text(json.dumps(body, indent=2) + "\n")
                return result
            if time.monotonic() > deadline:
                raise SpikeError(f"task {task_id} not finished within {CRAWL_WITHIN}")
            say(f"crawling: {row['pages_crawled']} pages, {row['pages_in_queue']} in queue")
            await asyncio.sleep(POLL_EVERY.total_seconds())


async def _raw_html(
    client: DataForSeoClient, task_id: str, folder: Path, limit: int | None
) -> list[str]:
    """The HTML of every 200 page, one call each, timed. Returns the keys of the first result."""
    html_dir = folder / "html"
    html_dir.mkdir(exist_ok=True)
    pages = [
        page["url"]
        for page in _read_jsonl(folder / "pages.jsonl")
        if page.get("resource_type") == "html" and page.get("status_code") == 200
    ][:limit]
    keys: list[str] = []
    with (folder / "raw_html.jsonl").open("w", encoding="utf-8") as log:
        for number, url in enumerate(pages):
            began = time.monotonic()
            row: dict[str, object] = {"url": url, "file": None, "error": None}
            try:
                result = first_result(
                    await _call(
                        client, "POST", "/v3/on_page/raw_html", [{"id": task_id, "url": url}]
                    )
                )
            except (SpikeError, ProviderCallError) as error:
                row["error"] = str(error)
            else:
                keys = keys or sorted(result)
                html = (result.get("items") or {}).get("html")
                if isinstance(html, str):
                    name = f"{number:05d}.html"
                    (html_dir / name).write_text(html, encoding="utf-8")
                    row["file"] = name
                else:
                    row["error"] = "no html in the answer"
            row["seconds"] = round(time.monotonic() - began, 3)
            log.write(json.dumps(row) + "\n")
    return keys


async def crawl(site: str, name: str, raw: Path, cap: Decimal, html_limit: int | None) -> None:
    variant = VARIANTS[name]
    folder = _site_dir(raw, site) / name
    if (folder / "meta.json").exists():
        raise SpikeError(f"{folder} holds a crawl already; move it away to crawl again")
    folder.mkdir(parents=True, exist_ok=True)
    budget = Budget(cap=cap, spent=spent_so_far(raw))
    budget.allow(estimate(variant))
    await _robots(site, folder)
    run_id = uuid4()
    task = {
        "target": site,
        "start_url": f"https://{site}/",
        "max_crawl_pages": variant.max_pages,
        "respect_sitemap": variant.respect_sitemap,
        "store_raw_html": variant.store_raw_html,
        "enable_javascript": False,
        "allow_subdomains": False,
        "tag": make_tag(INSTALLATION, 1, 1, run_id),
    }
    meta: dict[str, Any] = {
        "site": site,
        "variant": name,
        "settings": asdict(variant),
        "estimate": str(estimate(variant)),
        "cost": None,
    }
    async with live() as api:
        before = await _balance(api.client)
        meta["posted_at"] = datetime.now(UTC).isoformat()
        # Written before the post, so a post that fails without an answer is still counted at
        # its estimate and the folder refuses a second post.
        (folder / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        posted = await _call(api.client, "POST", "/v3/on_page/task_post", [task], sending=True)
        (folder / "task_post.json").write_text(json.dumps(posted, indent=2) + "\n")
        cost = task_cost(posted)
        budget.charge(cost, fallback=estimate(variant))
        meta["cost"] = None if cost is None else str(cost)
        task_id = str(posted["tasks"][0]["id"])
        meta["task_id"] = task_id
        (folder / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        summary = await _wait(api.client, task_id, folder)
        meta["finished_at"] = datetime.now(UTC).isoformat()
        say(f"summary keys: {sorted(summary)}")
        pages, page_result, page_keys = await _collect(
            api.client, "/v3/on_page/pages", task_id, folder / "pages.jsonl"
        )
        links, link_result, link_keys = await _collect(
            api.client,
            "/v3/on_page/links",
            task_id,
            folder / "links.jsonl",
            filters=["direction", "=", "internal"],
        )
        blocked, blocked_result, blocked_keys = await _collect(
            api.client, "/v3/on_page/non_indexable", task_id, folder / "non_indexable.jsonl"
        )
        say(f"{pages} pages; result keys {page_result}; item keys {page_keys}")
        say(f"{links} internal links; result keys {link_result}; item keys {link_keys}")
        say(f"{blocked} non-indexable; result keys {blocked_result}; item keys {blocked_keys}")
        if variant.store_raw_html:
            html_keys = await _raw_html(api.client, task_id, folder, html_limit)
            say(f"raw_html result keys: {html_keys}")
        after = await _balance(api.client)
    meta["balance_drop"] = None if before is None or after is None else str(before - after)
    (folder / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    say(f"kept in {folder}; the spike has spent ${budget.spent} of ${cap}")


def _minutes(meta: Mapping[str, Any]) -> float:
    posted = datetime.fromisoformat(meta["posted_at"])
    finished = datetime.fromisoformat(meta["finished_at"])
    return (finished - posted).total_seconds() / 60


def _measure_crawl(folder: Path) -> list[str]:
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    summary = first_result(json.loads((folder / "summary.json").read_text(encoding="utf-8")))
    status = summary.get("crawl_status") or {}
    crawled = int(status.get("pages_crawled") or 0)
    minutes = _minutes(meta)
    cost = Decimal(meta["cost"]) if meta.get("cost") is not None else None
    lines = [
        f"### {meta['variant']} ({json.dumps(meta['settings'])})",
        "",
        f"- Pages crawled: {crawled} of a cap of {status.get('max_crawl_pages')}; "
        f"stop reason `{summary.get('crawl_stop_reason')}`; in queue at the end: "
        f"{status.get('pages_in_queue')}",
        f"- Minutes from post to finished: {minutes:.1f}; pages per minute: "
        f"{crawled / minutes if minutes else 0:.1f} (upper bound: polled every "
        f"{POLL_EVERY.seconds} s)",
        f"- Task cost: ${cost}; per page of the cap: "
        f"{'n/a' if cost is None else f'${cost / meta["settings"]["max_pages"]:.6f}'}; per page "
        f"crawled: {'n/a' if cost is None or not crawled else f'${cost / crawled:.6f}'}; balance "
        f"drop over the run: ${meta.get('balance_drop')}",
    ]
    calls = list(_read_jsonl(folder / "raw_html.jsonl"))
    if calls:
        seconds = [float(call["seconds"]) for call in calls]
        failed = Counter(str(call["error"]) for call in calls if call["error"])
        total = sum(seconds)
        lines.append(
            f"- raw_html: {len(calls)} calls, {len(calls) - sum(failed.values())} with HTML, "
            f"median {median(seconds):.2f} s, p95 {percentile(seconds, 0.95):.2f} s, "
            f"{len(calls) / total * 60 if total else 0:.0f} calls a minute one at a time; "
            f"failures: {dict(failed) or 'none'}"
        )
    return [*lines, ""]


def _sitemap(site: str, main: Path, plain: Path) -> list[str]:
    start = f"https://{site}/"
    lines = ["### respect_sitemap: main (true) against no_sitemap (false)", ""]
    for label, folder in (("true", main), ("false", plain)):
        pages = list(_read_jsonl(folder / "pages.jsonl"))
        links = [
            (str(link["link_from"]), str(link["link_to"]))
            for link in _read_jsonl(folder / "links.jsonl")
            if link.get("link_from") and link.get("link_to")
        ]
        redirects = [
            (str(page["url"]), str(page["location"])) for page in pages if page.get("location")
        ]
        depths = click_depths([*links, *redirects], start)
        keys = {page_key(str(page["url"])) for page in pages}
        checks = [page.get("checks") or {} for page in pages]
        in_sitemap = sum(1 for check in checks if check.get("from_sitemap"))
        orphans = sum(1 for check in checks if check.get("is_orphan_page"))
        depth_zero = sum(1 for page in pages if page.get("click_depth") == 0)
        reached = keys & set(depths)
        lines.append(
            f"- respect_sitemap {label}: {len(pages)} pages; from_sitemap {in_sitemap}; "
            f"is_orphan_page {orphans}; provider click_depth 0 on {depth_zero}; our depth "
            f"reaches {len(reached)}, deepest {max(depths.values(), default=0)}; not reachable "
            f"by links: {len(keys - reached)}"
        )
    main_keys = {page_key(str(page["url"])) for page in _read_jsonl(main / "pages.jsonl")}
    plain_keys = {page_key(str(page["url"])) for page in _read_jsonl(plain / "pages.jsonl")}
    lines += [
        f"- Only with the sitemap: {len(main_keys - plain_keys)} pages; only without it: "
        f"{len(plain_keys - main_keys)}; in both: {len(main_keys & plain_keys)}",
        "",
    ]
    return lines


def _links_shape(folder: Path) -> list[str]:
    links = list(_read_jsonl(folder / "links.jsonl"))
    types = Counter(str(link.get("type")) for link in links)
    images = [link for link in links if link.get("type") == "image"]
    attributes = Counter(
        " ".join(sorted(link.get("link_attribute") or [])) or "(none)" for link in links
    )
    to_redirects = [
        link for link in links if 300 <= int(link.get("page_to_status_code") or 0) < 400
    ]
    examples = [*images[:2], *[link for link in links if link.get("type") == "redirect"][:2]]
    return [
        "### What /on_page/links returns (question 5)",
        "",
        f"- Internal links by type: {dict(types)}",
        f"- Image links: {len(images)}; with an empty text: "
        f"{sum(1 for link in images if not link.get('text'))}; with an image_alt: "
        f"{sum(1 for link in images if link.get('image_alt'))}",
        f"- link_attribute values: {dict(attributes.most_common(10))}",
        f"- Links to a 3xx page: {len(to_redirects)}; not dofollow: "
        f"{sum(1 for link in links if link.get('dofollow') is False)}",
        "- Examples (two image links, two redirect links):",
        "",
        "```json",
        *[json.dumps(link, ensure_ascii=False) for link in examples],
        "```",
        "",
    ]


def _kept_html(folder: Path) -> dict[str, str]:
    return {
        str(call["url"]): (folder / "html" / str(call["file"])).read_text(encoding="utf-8")
        for call in _read_jsonl(folder / "raw_html.jsonl")
        if call.get("file")
    }


def _href_match(site: str, folder: Path) -> list[str]:
    """Our internal (source, target) pairs from the HTML against those of /on_page/links, on
    the pages whose HTML was kept (plan 02 open point O3)."""
    html = _kept_html(folder)
    if not html:
        return []
    pages = {page_key(url) for url in html}
    ours = {
        (page_key(url), page_key(link.href))
        for url, page in html.items()
        for link in classify_page(page, url)
        if _internal(site, link.href)
    }
    theirs = {
        (page_key(str(link["link_from"])), page_key(str(link["link_to"])))
        for link in _read_jsonl(folder / "links.jsonl")
        if link.get("type") in ("anchor", "image") and link.get("link_from") and link.get("link_to")
    }
    theirs = {(source, target) for source, target in theirs if source in pages and source != target}
    missing = sorted(theirs - ours)
    extra = sorted(ours - theirs)
    return [
        "### Our hrefs against /on_page/links (plan 02 open point O3)",
        "",
        f"- Pages compared: {len(pages)}; (source, target) pairs: ours {len(ours)}, "
        f"DataForSEO {len(theirs)}; theirs we miss: {len(missing)} "
        f"({len(missing) / len(theirs) if theirs else 0:.1%}); only ours: {len(extra)} "
        f"({len(extra) / len(ours) if ours else 0:.1%})",
        f"- First pairs we miss: {missing[:5]}",
        f"- First pairs only we have: {extra[:5]}",
        "",
    ]


def measure(site: str, raw: Path) -> None:
    root = _site_dir(raw, site)
    lines = [f"## {site}", ""]
    for folder in sorted(path.parent for path in root.glob("*/meta.json")):
        if (folder / "summary.json").exists():
            lines += _measure_crawl(folder)
    if (root / "main" / "pages.jsonl").exists() and (root / "no_sitemap" / "pages.jsonl").exists():
        lines += _sitemap(site, root / "main", root / "no_sitemap")
    if (root / "main" / "links.jsonl").exists():
        lines += _links_shape(root / "main")
        lines += _href_match(site, root / "main")
    (root / "measure.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    say("\n".join(lines))


def _internal(site: str, url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return host.removeprefix("www.") == site.lower().removeprefix("www.")


SAMPLE_FIELDS: Final = (
    "key",
    "source",
    "position",
    "target",
    "text",
    "kind",
    "rel",
    "predicted",
    "human_label",
    "note",
)
POST_FIELDS: Final = (
    "key",
    "page",
    "auto_generated_links",
    "human_has_prev_next",
    "human_all_found",
)


def _read_csv(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as file:
        return {row["key"]: row for row in csv.DictReader(file)}


def _write_csv(path: Path, fields: Sequence[str], rows: Iterable[Mapping[str, object]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(fields))
        writer.writeheader()
        writer.writerows(rows)


def classify_site(site: str, raw: Path, posts_folder: str) -> None:
    root = _site_dir(raw, site)
    main = root / "main"
    html = _kept_html(main)
    if not html:
        raise SpikeError(f"no raw HTML under {main}: run crawl --variant main first")
    placed = place_links({url: classify_page(page, url) for url, page in html.items()})
    rows: list[dict[str, object]] = []
    for source, links in placed.items():
        for position, link in enumerate(links):
            if not _internal(site, link.href):
                continue
            rows.append(
                {
                    "key": sample_key(source, position),
                    "source": source,
                    "position": position,
                    "target": link.href,
                    "text": link.anchor,
                    "kind": link.kind,
                    "rel": " ".join(sorted(link.rel)),
                    "predicted": link.placement.value,
                    "human_label": "",
                    "note": "",
                }
            )
    _write_csv(root / "placements.csv", SAMPLE_FIELDS, rows)
    # A re-run keeps the rows already drawn and their labels; only the prediction is new.
    kept = _read_csv(root / "sample.csv")
    chosen = sorted(rows, key=lambda row: str(row["key"]))[:SAMPLE_LINKS]
    for row in chosen:
        before = kept.get(str(row["key"]))
        if before is not None:
            row["human_label"], row["note"] = before["human_label"], before["note"]
    _write_csv(root / "sample.csv", SAMPLE_FIELDS, chosen)
    posts = sorted(
        (url for url in placed if folder_of(url) == posts_folder),
        key=lambda url: sample_key(url, -1),
    )[:SAMPLE_POSTS]
    kept_posts = _read_csv(root / "posts.csv")
    post_rows: list[dict[str, object]] = []
    for url in posts:
        key = sample_key(url, -1)
        before = kept_posts.get(key, {})
        found = [
            f"{link.anchor} -> {link.href}"
            for link in placed[url]
            if link.placement is Placement.AUTO_GENERATED and _internal(site, link.href)
        ]
        post_rows.append(
            {
                "key": key,
                "page": url,
                "auto_generated_links": " | ".join(found),
                "human_has_prev_next": before.get("human_has_prev_next", ""),
                "human_all_found": before.get("human_all_found", ""),
            }
        )
    _write_csv(root / "posts.csv", POST_FIELDS, post_rows)
    by_placement = Counter(str(row["predicted"]) for row in rows)
    say(f"{len(html)} pages, {len(rows)} internal links: {dict(by_placement)}")
    say(f"label {root / 'sample.csv'} (human_label: one of {', '.join(PLACEMENTS)})")
    say(f"and {root / 'posts.csv'} (yes or no) with {len(post_rows)} posts of /{posts_folder}/")


def score(site: str, raw: Path) -> None:
    root = _site_dir(raw, site)
    rows = list(_read_csv(root / "sample.csv").values())
    labelled: list[tuple[str, str]] = []
    for line, row in enumerate(rows, start=2):
        label = row["human_label"].strip()
        if not label:
            continue
        if label not in PLACEMENTS or row["predicted"] not in PLACEMENTS:
            raise SpikeError(f"sample.csv line {line}: {label!r} is not one of {PLACEMENTS}")
        labelled.append((label, row["predicted"]))
    scopes = confusion((scope_of(human), scope_of(predicted)) for human, predicted in labelled)
    placements = confusion(labelled)
    lines = [
        f"## {site}: placement accuracy",
        "",
        f"Labelled {len(labelled)} of {len(rows)} sampled links.",
        "",
        "- " + render_accuracy("Scope (editorial, auto-generated, template)", scopes),
        "- " + render_accuracy("Placement (seven classes)", placements),
        "",
        *render_confusion(scopes, SCOPES),
        "",
        *render_confusion(placements, PLACEMENTS),
        "",
    ]
    posts = [
        row
        for row in _read_csv(root / "posts.csv").values()
        if row["human_has_prev_next"].strip() in LABELS
    ]
    with_them = [row for row in posts if row["human_has_prev_next"].strip() == "yes"]
    found = sum(1 for row in with_them if row["human_all_found"].strip() == "yes")
    lines += [
        f"- Posts checked: {len(posts)}; with previous or next links: {len(with_them)}; "
        f"all of them found as auto_generated: {found} of {len(with_them)}",
        "",
    ]
    (root / "score.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    say("\n".join(lines))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("crawl", "measure", "classify", "score"):
        command = commands.add_parser(name)
        command.add_argument("--site", required=True, help="host, such as cleanstart.com")
        command.add_argument("--raw-dir", type=Path, default=RAW, help="where answers are kept")
        if name == "crawl":
            command.add_argument("--variant", choices=sorted(VARIANTS), required=True)
            command.add_argument("--cap", type=Decimal, required=True, help="dollars, whole spike")
            command.add_argument("--html-limit", type=int, help="fetch raw HTML of N pages only")
        if name == "classify":
            command.add_argument("--posts-folder", required=True, help="such as blog")
    options = parser.parse_args()
    site = options.site.strip().lower()
    try:
        if options.command == "crawl":
            run(
                lambda: crawl(
                    site, options.variant, options.raw_dir, options.cap, options.html_limit
                )
            )
        elif options.command == "measure":
            measure(site, options.raw_dir)
        elif options.command == "classify":
            classify_site(site, options.raw_dir, options.posts_folder)
        else:
            score(site, options.raw_dir)
    except (SpikeError, ProviderCallError) as error:
        say(f"stopped: {error}")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: See them pass, and see the cap refuse before any call**

```bash
uv run pytest tests/spikes/test_s17.py --no-cov -q
uv run python -m spikes.s17_on_page_crawl crawl --site example.com --variant smoke --cap 0.001 --raw-dir /tmp/s17-cap-check; echo "exit $?"
rm -rf /tmp/s17-cap-check
```

Expected: `11 passed`; then `estimated $0.00300 is over the cap of $0.001; nothing sent` and `exit 2`. No credentials are needed for this check: the cap is checked before robots.txt is fetched or the client is made.

- [ ] **Step 5: Gates and commit**

Run the gates. Then:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
grep -nP '[^\x00-\x7F]' backend/spikes/s17_on_page_crawl.py backend/tests/spikes/test_s17.py
git add backend/spikes/s17_on_page_crawl.py backend/tests/spikes/test_s17.py
git commit -m "Add spike S-17: On-Page crawls, placement sample and score"
```

## Task 5: The write-up template, the README row and the full suite

**Files:**
- Create: `docs/spikes/S-17.md`
- Modify: `docs/spikes/README.md`

- [ ] **Step 1: Write the template**

`docs/spikes/S-17.md`:

```markdown
# S-17. DataForSEO On-Page crawls for the internal link tracker

Not run yet. Filled in by hand after the run (plan `docs/superpowers/plans/2026-11-16-internal-links-01-crawl-spike.md`, Tasks 7 to 9). Spec: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md` section 10. Tooling: `backend/spikes/s17_on_page_crawl.py`; the tables below are pasted from its `measure.md` and `score.md`.

Run: date and time in UTC. Spent: the sum of the task costs, of a $5.00 cap (estimate $2.75). No account data (login, balance) is written here.

## Sites

| Site | CMS | robots.txt allows the crawl | Sitemap | Pages crawled (main) | Posts folder |
|---|---|---|---|---|---|
| cleanstart.com | Next.js | | | | |
| | WordPress | | | | |
| | | | | | |

## 1. Crawl speed and the page cap

Pass: the 100-page crawl stops with `limit_exceeded` at no more than 100 pages, and its pages and links read in full. Speed is recorded, with no target.

| Site | Crawl | Cap | Pages crawled | Stop reason | In queue at the end | Minutes | Pages per minute |
|---|---|---|---|---|---|---|---|
| cleanstart.com | stop_raw | 100 | | | | | |
| cleanstart.com | main | 2,000 | | | | | |
| | main | 2,000 | | | | | |
| | main | 2,000 | | | | | |

## 2. The price of store_raw_html and the limits of raw_html

Pass: the cost per page of `stop_raw` against `stop_plain` is known; `raw_html` answers every 200 page one call at a time with no refusal.

| Crawl | Task cost | Per page of the cap | Per page crawled | Balance drop |
|---|---|---|---|---|
| stop_raw (raw HTML on) | | | | |
| stop_plain (raw HTML off) | | | | |

| Site | raw_html calls | With HTML | Median seconds | p95 seconds | Calls a minute | Refusals (40202, 429) |
|---|---|---|---|---|---|---|
| cleanstart.com | | | | | | |
| | | | | | | |
| | | | | | | |

## 3. What respect_sitemap does

Recorded, not pass or fail.

| Site | Pages, sitemap on | Pages, sitemap off | Only with the sitemap | from_sitemap | is_orphan_page | DataForSEO click_depth 0 | Our depth reaches | Not reachable by links |
|---|---|---|---|---|---|---|---|---|
| cleanstart.com | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

## 4. Placement accuracy

Pass: scope accuracy at least 95% on each site; previous and next links found on every sampled post that has them. Thresholds in use: TEMPLATE_SHARE 0.5, SAME_TARGETS 0.8, STEADY_COUNT 0.8, MIN_FOLDER_PAGES 4 (write the values used if they were changed).

| Site | Labelled | Scope accuracy (95% interval) | Editorial right | Auto-generated right | Template right | Posts with previous or next | All found |
|---|---|---|---|---|---|---|---|
| cleanstart.com | | | | | | | |
| | | | | | | | |
| | | | | | | | |

Confusion tables, per site, pasted from `score.md`.

## 5. Links: anchors, rel, image links and redirects

Pass: image links carry their alt text, `link_attribute` carries the rel values, links to redirects are visible, and our HTML parse misses under 2% of the pairs of `/on_page/links`.

| Site | Links by type | Image links with alt text | link_attribute values | Links to a 3xx page | Not dofollow |
|---|---|---|---|---|---|
| cleanstart.com | | | | | |
| | | | | | |
| | | | | | |

Our hrefs against `/on_page/links` (plan 02 open point O3), on the pages with kept HTML: pairs of theirs we miss, and pairs only we have, per site.

| Site | Our pairs | Their pairs | Theirs we miss | Only ours |
|---|---|---|---|---|
| cleanstart.com | | | | |
| | | | | |
| | | | | |

Field names that differ from plan 01 Decision 12, as the smoke crawl printed them: none found yet.

## Findings (written by hand after the run)

Numbered, one finding each, with the figure it rests on.

## What changes in the backend plan

Worked through at the owner decision gate (plan 01 Task 10). Tick each line and write the decision next to it.

- [ ] Crawl ceiling (spec 6.2): three times the sitemap URL count, at least 2,000, and 50,000 without a sitemap. Keep, or change to:
- [ ] Template-detection threshold (spec 6.3): 50% of a folder's pages. Keep, or change to:
- [ ] The three guards of plan 01 Decision 6 (STEADY_COUNT 0.8, MIN_FOLDER_PAGES 4, SAME_TARGETS 0.8 with self links counted): written into spec 6.3, with the values:
- [ ] Raw HTML: fetched for every 200 page, or only for pages of templates the first pass cannot classify:
- [ ] Click depth with respect_sitemap: our breadth-first search (spec 6.4) as planned, or:
- [ ] Price of store_raw_html, for the cost estimate in the ledger:
- [ ] raw_html pacing for the ingest job (calls a minute, calls at once):
- [ ] Paging of /pages and /links: offset, or search_after_token:
- [ ] HTML parser: standard library kept, or an HTML5 parser added (selectolax or lxml):
- [ ] Anchor of an image link: `text` or `image_alt`:
- [ ] Redirects: `type` `redirect` link rows, or `location` on pages, as the hop of spec 6.4:
- [ ] Field names that differ from plan 01 Decision 12:
- [ ] Template pass values (plan 01 Decision 14; plan 02 D19 uses this pass): the constants `TEMPLATE_SHARE`, `SAME_TARGETS`, `STEADY_COUNT` and `MIN_FOLDER_PAGES` as the hand check settles them, and the measure of "the same targets" (coverage with self links):
- [ ] Edges from our HTML against `/on_page/links` (plan 02 D7 and O3): gap measured, keep D7 or match against `/links`:
- [ ] Recorded fixtures for plan 02 Task 0 (plan 01 Decision 15): which answers, from which sites:
```

- [ ] **Step 2: Add the README row**

In `docs/spikes/README.md`, after the row that starts `| S-15 turnaround by hour |`, add:

```markdown
| S-17 internal link crawls (On-Page: cleanstart.com and two sites the owner names) | `uv run python -m spikes.s17_on_page_crawl crawl --site cleanstart.com --variant smoke --cap 5`, then the other variants and sites (plan 01 Task 7); `measure`, `classify` and `score` read the kept answers at no cost | $5 for the whole spike (estimate $2.75) | minutes for 100 pages; a 2,000-page crawl is measured by the run |
```

Then, after the paragraph that starts `Each writes \`docs/spikes/S-xx.md\``, add a paragraph:

```markdown
S-17 does not write its report: it keeps every answer, third-party HTML included, under the git-ignored `backend/spikes/raw/s17/`, prints its tables, and `docs/spikes/S-17.md` is filled in by hand from them.
```

- [ ] **Step 3: Run the whole backend suite once**

```bash
colima status || colima start --cpu 10 --memory 16
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike/backend
uv sync --frozen && ./check.sh
```

Expected: ruff, ruff format, mypy and `Contracts: 7 kept, 0 broken.` pass, then pytest ends with `N passed` and `Required test coverage of 90% reached`. Never restart Colima or stop `idraft-dev-*` containers while other sessions use them: if `colima status` says running, go on.

- [ ] **Step 4: Commit**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
grep -nP '[^\x00-\x7F]' docs/spikes/S-17.md docs/spikes/README.md
git add docs/spikes/S-17.md docs/spikes/README.md
git commit -m "Add the S-17 write-up template and its README row"
git push origin feat/internal-links-spike
```

The push is the backup branch only; it is never merged into `main` from here. The branch goes into `develop` after Task 9, when the owner says so.

## Task 6: Owner decision point: the two other sites and the go-ahead to spend

No code. The run of Task 7 waits for both answers in chat.

- [ ] **Step 1: Check the candidates' robots.txt and CMS (free, no DataForSEO call)**

For each candidate host:

```bash
curl -s https://<host>/robots.txt
curl -s https://<host>/ | grep -o -m1 'wp-content\|content="Ghost[^"]*"\|data-wf-site\|cdn.shopify.com\|hs-scripts'
```

A candidate is kept only when its robots.txt lets `*` crawl `/` (no `Disallow: /` for `*` or `RSiteAuditor`) and the second line names the CMS. The script checks robots.txt again before it posts (Decision 5).

Proposed, to check in this step (none is verified yet):

| Slot | First choice | Why | Fallback |
|---|---|---|---|
| WordPress | A site the owner or a client runs on WordPress (eventussecurity.com, the mock's sample client, if the check above finds `wp-content`) | Permission to crawl is not in doubt, and the results apply to a real customer | wpbeginner.com (a large WordPress blog with post navigation) |
| Other CMS | A client site on Webflow, Ghost or HubSpot CMS | Same reason | A Ghost blog (the `content="Ghost` check), or a Webflow site (`data-wf-site`) |

Sites the owner or a client controls come first: crawling a site of 2,000 pages at DataForSEO's default 2 second delay takes about an hour of that site's traffic.

- [ ] **Step 2: Ask the owner**

Ask in chat, in one message: the WordPress host, the other CMS host, each site's posts folder (`blog` on cleanstart.com is checked in Task 7 Step 2), and the go-ahead to spend up to $5 on the owner's DataForSEO account with credentials set in the running shell only. Write the answers into the Sites table of `docs/spikes/S-17.md` in Task 9, not before.

## Task 7: The run (only on the owner's go-ahead)

**Files:** none committed. Everything lands in `backend/spikes/raw/s17/` (ignored).

Run every command from `W/backend`, in one shell.

- [ ] **Step 1: Credentials in this shell only**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike/backend
read -r DATAFORSEO_LOGIN && read -rs DATAFORSEO_PASSWORD && export DATAFORSEO_LOGIN DATAFORSEO_PASSWORD
```

The owner types them; they are never written to a file or pasted into chat.

- [ ] **Step 2: Smoke crawl of cleanstart.com (about $0.003)**

```bash
uv run python -m spikes.s17_on_page_crawl crawl --site cleanstart.com --variant smoke --cap 5
```

Expected, in order: `crawling: ...` lines every 30 seconds, then `summary keys: [...]` holding `crawl_progress`, `crawl_status` and `crawl_stop_reason`; `N pages; result keys [...]` (holding `total_items_count`, and `search_after_token` if DataForSEO puts it there) `; item keys [...]` holding `checks`, `click_depth`, `resource_type`, `status_code`, `url`; `N internal links; result keys [...]; item keys [...]` holding `direction`, `dofollow`, `link_from`, `link_to`, `page_to_status_code`, `text`, `type`; `N non-indexable; result keys [...]; item keys [...]`; `raw_html result keys: [...]` holding `items`; and `the spike has spent $... of $5`. Then:

```bash
grep -o '"url": "[^"]*"' spikes/raw/s17/cleanstart.com/smoke/pages.jsonl | head -20
```

It shows the posts folder (for example `https://cleanstart.com/blog/...`). **Stop here** if any expected key is missing or a name differs: record the difference under "Field names that differ" in `S-17.md`, fix the field the script reads (Task 4 code, with its test) in a commit, and run the smoke crawl again into a fresh folder (`mv spikes/raw/s17/cleanstart.com/smoke spikes/raw/s17/cleanstart.com/smoke-1`).

- [ ] **Step 3: The page cap and raw HTML probes on cleanstart.com (about $0.045)**

```bash
uv run python -m spikes.s17_on_page_crawl crawl --site cleanstart.com --variant stop_raw --cap 5
uv run python -m spikes.s17_on_page_crawl crawl --site cleanstart.com --variant stop_plain --cap 5
```

Expected: each ends with `kept in .../stop_raw` (and `stop_plain`) and the running spend.

- [ ] **Step 4: The full crawls, one site after the other (about $0.90 a site)**

For `cleanstart.com`, then the WordPress host, then the other host named in Task 6:

```bash
uv run python -m spikes.s17_on_page_crawl crawl --site <host> --variant main --cap 5
uv run python -m spikes.s17_on_page_crawl crawl --site <host> --variant no_sitemap --cap 5
```

A crawl that is refused by robots.txt stops with `stopped: robots.txt of <host> does not allow crawling ...` and spends nothing: go back to Task 6 for another site. A crawl that is refused by the cap stops with exit 2 and spends nothing.

- [ ] **Step 5: Measure each site (free)**

```bash
uv run python -m spikes.s17_on_page_crawl measure --site cleanstart.com
uv run python -m spikes.s17_on_page_crawl measure --site <wordpress host>
uv run python -m spikes.s17_on_page_crawl measure --site <other host>
```

Expected: per crawl, pages crawled, stop reason, minutes, pages per minute, cost per page and the `raw_html` line; per site the sitemap comparison and the shape of `/on_page/links`. Each is also kept as `spikes/raw/s17/<host>/measure.md`.

- [ ] **Step 6: Leave nothing staged**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
git status --short
```

Expected: nothing under `backend/spikes/raw/`. Close the shell, so the credentials go with it.

## Task 8: Label and score the placement samples (free)

**Files:** none committed (the CSV files are in the ignored raw folder).

- [ ] **Step 1: Classify each site**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike/backend
uv run python -m spikes.s17_on_page_crawl classify --site cleanstart.com --posts-folder blog
```

Then the same for the two other hosts, with the posts folder seen in their `pages.jsonl`. Expected: `N pages, M internal links: {placement counts}`, then the paths of `sample.csv` (100 rows) and `posts.csv` (up to 30 rows).

- [ ] **Step 2: Label 100 links per site by hand**

Open `spikes/raw/s17/<host>/sample.csv` in a spreadsheet. For each row, open `source` in a browser, find the link with that `text` and `target`, and write in `human_label` where it sits, by spec section 4: `content` (placed by a person in the body), `auto_generated` (previous and next, related, recent, popular, more posts, tag and category lists written by the CMS), `navigation`, `header`, `footer`, `sidebar` or `breadcrumb`. Use `note` for a doubtful row. Do not look at `predicted` while labelling (hide the column).

- [ ] **Step 3: Check the posts**

In `spikes/raw/s17/<host>/posts.csv`, for each post write in `human_has_prev_next` `yes` when the page shows previous or next links (or `no`), and in `human_all_found` `yes` when every one of them is listed in `auto_generated_links` (or `no`).

- [ ] **Step 4: Score**

```bash
uv run python -m spikes.s17_on_page_crawl score --site cleanstart.com
```

Then the two other hosts. Expected: `Scope (editorial, auto-generated, template): C of N (P%, 95% interval L% to H%)`, the seven-class line, both confusion tables and the posts line, kept as `spikes/raw/s17/<host>/score.md`.

- [ ] **Step 5: When a site is under 95%, try the thresholds once (the spike is one day)**

Look at the wrong rows of the confusion table. If they come from the template pass, change only the constant at fault in `backend/src/idraft/crawl/placement.py` (`TEMPLATE_SHARE`, `SAME_TARGETS`, `STEADY_COUNT` or `MIN_FOLDER_PAGES`), run `uv run pytest tests/crawl --no-cov -q` (a guard fixture that now fails shows the value is too loose), run `classify` and `score` again (labels are kept, Decision 9), and keep the change only when every site improves. Commit it alone:

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
git add backend/src/idraft/crawl/placement.py
git commit -m "Tune the template pass thresholds from spike S-17"
```

Errors from rules 1 to 5 (a marker the CMS uses that the rules do not know, a landmark the site misuses) are written down as findings for plan 02, not fixed here.

## Task 9: Fill in the write-up

**Files:**
- Modify: `docs/spikes/S-17.md`

- [ ] **Step 1: Fill every table**

Paste the figures from each site's `measure.md` and `score.md` into the tables of `docs/spikes/S-17.md`, replace `Not run yet.` with one line naming the run, fill the Sites table, and replace the Run line with the date and the spend. Write the findings as a numbered list, one figure each, in the style of `docs/spikes/S-04.md` "Findings". Leave the checklist unticked: it is ticked at the gate.

- [ ] **Step 2: Check that no account data or third-party page text went in**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
grep -niE 'login|password|balance:|@' docs/spikes/S-17.md
grep -nP '[^\x00-\x7F]' docs/spikes/S-17.md
```

Expected: the first prints only the line "No account data (login, balance) is written here."; the second prints nothing (replace any non-ASCII character copied from a site's anchor text).

- [ ] **Step 3: Commit**

```bash
git add docs/spikes/S-17.md
git commit -m "Write up spike S-17: On-Page crawls and link placement accuracy"
git push origin feat/internal-links-spike
```

## Task 10: The owner decision gate

**Files:**
- Modify: `docs/spikes/S-17.md` (the ticked checklist)
- Modify: `docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md` (sections 6.1 to 6.3 and 13, as decided)

Plan 02 starts its provider and classifier tasks only after this gate.

- [ ] **Step 1: Walk the checklist with the owner**

The plan author presents `docs/spikes/S-17.md` to the owner in chat: the five answers, the pass or fail of each criterion of Decision 10, and each line of "What changes in the backend plan" with a recommended decision. The owner decides each line; write the decision next to it and tick it.

- [ ] **Step 2: Adjust the spec**

Change spec sections 6.1 to 6.3 to match the decisions (spec section 10: "The plan adjusts sections 6.1 to 6.3 from the results before the backend tasks start"): the ceiling numbers of 6.2, the threshold and the three guards in 6.3 (with their values), raw HTML for every page or only some, the parser, and the field names. Move the three "Open until the spike" points of section 13 to "Decided by the owner", with the date.

- [ ] **Step 3: Hand the decisions to plan 02**

Plan 02 (`docs/superpowers/plans/2026-11-16-internal-links-02-backend-slice-1.md`) runs its Task 0 from the ticked checklist: its "Spike outcome" list and the decisions and open points it names as spike-dependent (D5, D6, D7, D12, D13, D19, O1, O3, O4, O6). The template pass line (Decision 14) settles plan 02 Task 5. The fixtures line (Decision 15) tells plan 02 which kept answers it may record under `backend/tests/fixtures/dataforseo/on_page/` and `backend/tests/fixtures/crawl_site/`; give its author the raw folder path, `backend/spikes/raw/s17/` in this worktree.

These plan 02 tasks do **not** depend on the spike and may start in parallel with it (plan 02 "Dependencies between tasks"): Task 1 (migration 0025: the `core` tier tables and the `seo` crawl tables; the anchor and kind columns of the crawl links table are rechecked against answer 5 at this gate), Task 2 (the `idraft.crawl` rules: scopes, tier rules, ceiling, schedule), Task 3 (tier levels service and API), Task 4 (depth and PageRank), Task 6 (page tiers, rules with preview, reset, CSV import, tags, tier flow store) and Task 7's adapter code. These **wait for the gate**: Task 0, Task 5 (the template pass), the recorded fixtures of Task 7, Task 8 (edges from the classifier, after this branch is merged) and Task 11 (ingest), and the ceiling numbers and price of D5, D13 and O1.

- [ ] **Step 4: Commit and hand over**

```bash
cd /Users/a12345/Desktop/AI/idraft/platform/.claude/worktrees/internal-links-spike
grep -nP '[^\x00-\x7F]' docs/spikes/S-17.md docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md
git add docs/spikes/S-17.md docs/superpowers/specs/2026-11-16-internal-link-tracker-design.md
git commit -m "Settle the internal link tracker spike points (S-17 gate)"
git push origin feat/internal-links-spike
```

Report to the owner that `feat/internal-links-spike` is ready to merge into `develop`; merge it only when the owner says so. Keep the worktree and its raw folder until plan 02 has taken over the decisions and recorded the fixtures the owner allowed, then remove the worktree (`git worktree remove .claude/worktrees/internal-links-spike` from the main checkout); the raw folder goes with it.

---

## Self-review

**Spec section 10 coverage.**

| Spec 10 asks | Where |
|---|---|
| Run on cleanstart.com, one WordPress site and one other CMS | Task 6 names the sites (owner decision), Task 7 crawls them |
| 1. Crawl speed in pages per minute; whether `max_crawl_pages` stops cleanly | Variants `stop_raw` and `main`; `measure` prints pages per minute and the stop reason; Decision 10.1 |
| 2. Whether `store_raw_html` changes the price; the call limits of `raw_html` | `stop_raw` against `stop_plain` (the only difference is raw HTML); the timed `raw_html` log; Decision 10.2 |
| 3. What `respect_sitemap` does to scope and orphan flags (and `click_depth`) | `main` against `no_sitemap`; `from_sitemap`, `is_orphan_page`, `click_depth` 0 and our depth in `measure`; Decision 10.3 |
| 4. Classifier accuracy on 100 hand-checked links per site; 95% target; previous and next found on every post | Tasks 3, 8; `sample.csv` and `posts.csv`; `score` with the Wilson interval; Decision 10.4 |
| 5. Anchor text and rel from `/links` for image links and redirects | `measure` "What /on_page/links returns"; Decision 10.5 |
| Adjust sections 6.1 to 6.3 before the backend tasks | Task 10 |

**Spec section 6.3 coverage.** Rule 1 (rel, ancestor markers, Previous or Next text; cleanstart.com and WordPress shapes): `test_the_cleanstart_article_navigation_is_auto_generated`, `test_wordpress_post_navigation_is_auto_generated_by_rel_or_by_class`, `test_previous_or_next_followed_by_a_title_is_auto_generated`, `test_related_recent_and_popular_blocks_are_auto_generated`, `test_markers_match_whole_words_and_never_html_or_body`. Rule 2: `test_breadcrumbs_win_over_the_nav_they_sit_in`. Rule 3: `test_landmarks_by_element_and_by_role`, `test_a_header_or_footer_inside_main_or_article_is_not_a_template`. Rule 4: `test_rule_four_needs_exactly_one_article`, `test_an_open_link_no_block_claims_stays_auto_generated`. Rule 5: the `content` rows throughout. Second pass: `test_a_block_with_the_same_targets_on_most_pages_is_navigation`, `test_an_unmarked_related_block_with_changing_targets_is_auto_generated`, `test_a_block_on_fewer_than_half_the_pages_is_left_alone`, `test_the_pass_never_changes_a_landmark_placement`, and the three guards. Dropped links (jump links, self links, script controls, `template`): `test_jump_links_self_links_and_script_controls_are_dropped`, `test_links_inside_a_template_element_are_not_on_the_page`. Matching a link to `/on_page/links` "by source page and href in document order" is ingest (plan 02); the spike samples from the HTML's own links.

**Checked while writing.** All the code in Tasks 3 and 4 was run on a copy of `backend/` taken from the main checkout on 2026-11-16 (the backend files equal `origin/develop`, Decision 16), with the backend's own tools, in the order of the tasks: Task 2's failing and passing contract test (`1 failed, 2 passed`, then `3 passed`, `Contracts: 6 kept, 0 broken.`), Task 3's collection error, `30 passed` and `225 0 94 4 99%`, `Contracts: 7 kept, 0 broken.`, Task 4's collection error, `11 passed` and the cap refusal `exit 2`; then ruff check, ruff format check and mypy strict over the whole copy (`All checks passed!`, `726 files already formatted`, `Success: no issues found in 721 source files`). Each guard of Decision 6 was switched off once to see its fixture fail (prose became `auto_generated`; a three-page folder turned body links into `navigation`; the menu without self links fell to `auto_generated`). Not run while writing: the database suite of `./check.sh` (Task 5 Step 3 runs it) and any DataForSEO call.

**Open points.**

1. **Unverified DataForSEO facts** (Decision 12): the body and fields of `/v3/on_page/non_indexable`; where `search_after_token` sits in an answer; whether `target` takes the bare host as sent; whether `task_post` charges the page cap up front or the pages crawled (the estimate assumes the cap; plan 02 D5 assumes the same); whether `raw_html` takes more than one task a call (one is sent); the one-condition `filters` form `["direction", "=", "internal"]`. The smoke crawl (Task 7 Step 2) stops the run when any of these is wrong.
2. **The three guards amend spec 6.3** and their values are guesses until the run (Decision 6). A site whose posts all carry the same number of body links would still flip its prose to `auto_generated` under the steady count guard; the hand check shows whether this happens.
3. **The sites besides cleanstart.com** are the owner's to name (Task 6); the candidates in the table are not checked yet.
4. **One cap for the whole spike** relies on the raw folder: a crawl moved out of it (Task 7 Step 2's `smoke-1`) is still counted, because `spent_so_far` reads every `meta.json` two levels down; a folder moved elsewhere is not.
5. **A crawl that outlives the 4 hour wait** leaves its `meta.json` (paid) and is not resumed by the script; its task stays readable at DataForSEO for 30 days. At the default 2 second crawl delay a 2,000-page crawl takes about 67 minutes if pages are fetched one at a time, so this is not expected.
6. **Plan 02 follows this plan.** Its imported names match Task 3 (Decision 13) and it uses this plan's template pass (Decision 14, plan 02 D19). Its Task 0 expects committed payloads this plan does not record (Decision 15): that stays a gate line. Neither plan is edited by the other after this reconciliation.
