# Measuring how many ChatGPT answers the 16 KB bound cut

Written 2026-11-13 by WP-14 (BE-FANOUT-03). Nothing here has been run: this package has no access to
production or to the shared dev database. The ops session, or the owner, runs it once and gives the
numbers back to the coordinator.

## Why

`ai_parse` stores the fan-out queries of an answer in `ai.observations.provider_extras` under a bound of
16 KB (`EXTRAS_MAX_BYTES`; migration 0018 checks `octet_length(provider_extras::text) <= 16384`). A
longer list is cut to a prefix, and `fanout_count` keeps the number of queries the engine issued. A
query in the cut part is in no row of `GET {P}/ai/fanout-queries`; the read reports the loss as
`meta.answers_truncated`.

The unit tests of the bound (`backend/tests/api/ai/test_fanout_bound.py`) show that a typical answer
(1 to 10 queries) is never cut and that about 250 queries of 60 characters fit (halving keeps
200 of 400). What they cannot say is how many real answers are cut. This query says it.

## The query

Read only: it selects from one table and writes nothing. Run it on production, in a read only
transaction.

```sql
BEGIN READ ONLY;

SELECT count(*) FILTER (WHERE fanout_count > 0) AS with_fanout,
       count(*) FILTER (
         WHERE fanout_count > coalesce(
           CASE WHEN jsonb_typeof(provider_extras -> 'fan_out_queries') = 'array'
                THEN jsonb_array_length(provider_extras -> 'fan_out_queries') END, 0)
       ) AS cut,
       max(fanout_count) AS most_issued,
       max(octet_length(provider_extras::text)) AS biggest_extras
FROM ai.observations
WHERE engine_code = 'chatgpt_web'
  AND superseded_by IS NULL
  AND observed_at >= now() - interval '28 days';

ROLLBACK;
```

`cut` uses the same rule as the read: a stored list shorter than `fanout_count` is cut, and extras that
were reduced to `{"truncated": true}` (no list at all) count as cut. `with_fanout` is the denominator.

## How to read the result

The share is `cut / with_fanout`. The owner decides what is too much; as a guide, a share under 1%
needs nothing. A larger share is a reason to ask WP-57 for a table of its own for the queries
(`ai.fanout_queries`, BE-FANOUT-02), which removes the bound; this package builds no migration.
Answers ingested before the bound cut the ads and brand entities first (WP-14 T8b) were cut by the
old rule, so the share of the last few days shows the current behaviour best.
