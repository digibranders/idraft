# Planner statistics for the AI tables

Release A follow-up F-12. Code: `idraft/db/maintenance.py` (the rule), `analyze.py` (the operator
command), `migrate.py` (the call after every upgrade).

## Why

A database with no table statistics (restored from a logical dump, upgraded to a new major version,
or bulk loaded) is planned as if every table had one row, and the planner nests the joins of the AI
reads. Those reads run 30 to 100 times slower. WP-12 measured the co-mentions self join of
`ai.entity_mentions` at 62.8 to 69 s without statistics (the statement timeout is 15 s, so the API
answers `503 query_timeout`) and 0.4 s with the partitions analyzed. The WP-32 guard
`SET LOCAL enable_nestloop = off` covers three reads, not the next one: it is not a substitute.

## What runs by itself

Every release: `idraft.db.migrate.main()` analyzes the AI tables after the upgrade, as the migrator
(owner) role that `infra/vps/activate.sh` already runs. A failure only logs `analyze skipped` and
never fails the release. Autovacuum covers steady state on the monthly partitions.

## When to run it by hand

After a restore (doc 23 step 10; `vacuumdb --analyze-in-stages` there covers the whole database),
after a major PostgreSQL upgrade, and after a bulk backfill or the first real run into an empty month.

## The command

As the migrator user, the way `activate.sh` runs the migrator (never print `/etc/idraft`):

```bash
sudo systemd-run --wait --pipe --collect --quiet -p User=idraft \
  -p EnvironmentFile=/etc/idraft/migrator.env -p RuntimeMaxSec=600 \
  -p WorkingDirectory=/path/to/release -E PYTHONUNBUFFERED=1 \
  /path/to/release/.venv/bin/python -m idraft.db.analyze
```

It logs `statistics refreshed` with the number of tables, and exits non-zero when it cannot connect
or runs out of its budget.

## The bound

Nine named tables, never a database-wide ANALYZE: `ai.observations`, `ai.citations`,
`ai.entity_mentions`, `ai.observation_facts`, `ai.prompts`, `ai.prompt_versions`, `ai.prompt_terms`,
`core.urls`, `core.domains`. ANALYZE of a partitioned parent also analyzes each partition. Each
table gets 30 s (`STATEMENT_TIMEOUT_MS`) and waits at most 5 s for a lock (`LOCK_TIMEOUT_MS`); one
that cannot be analyzed is logged as `analyze table skipped` and the rest go on. The whole run
stops after 120 s (`TOTAL_BUDGET_SECONDS`). ANALYZE reads a fixed sample and blocks neither reads
nor writes.

## How to see it

```sql
SELECT relname, last_analyze, last_autoanalyze FROM pg_stat_user_tables WHERE schemaname = 'ai';
```

## What not to do

No worker job until the grant exists: `app_worker` has no `MAINTAIN` privilege and does not own the
tables, so its `ANALYZE` only logs "skipping" and does nothing (doc 21 section 10,
`analyze_hot_partitions`, needs a migration).
