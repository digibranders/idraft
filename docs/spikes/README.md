# Phase 0 test runs

These runs call the live DataForSEO API and spend real money. They answer the questions in doc 01
section 12 and doc 06 section 11 that the build depends on. Run them only when the product owner
says so, with the owner's account.

## Before a run

1. A funded DataForSEO account (the minimum payment is $50).
2. In the shell that runs them, and nowhere else: `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD`.
   They are never written to a file by these tools.
3. A keyword file: one keyword per line, trimmed, no search operators. S-03 needs 500, S-01 and
   S-02 need 100, S-15 needs 20. Use a mix of intents (informational, commercial, local, brand).

Every run takes a spending cap in dollars. It estimates each batch at its dearest (the async AI
Overview surcharge read as a doubling), refuses to send what would pass the cap, and counts what
DataForSEO reports each task cost.

Each run tags its tasks with the installation `spike`, so a worker of another installation on the
same account never takes them, and it collects every task it sends so none is left in the
account's `tasks_ready` list.

## The runs

From `backend/`:

| Run | Command | Cap to pass | Takes |
|---|---|---|---|
| S-01 billing and tag echo | `uv run python -m spikes.s01_billing_and_tags --cap 5 --keywords keywords.txt` | $5 | up to 2 hours |
| S-02 payload sizes | `uv run python -m spikes.s02_payload_sizes --cap 5 --keywords keywords.txt` | $5 (600 tasks) | up to 2 hours |
| S-03 AI Overview with and without async | `uv run python -m spikes.s03_ai_overview --cap 2 --keywords keywords.txt` | $2 | up to 2 hours |
| S-15 turnaround by hour | `uv run python -m spikes.s15_turnaround --cap 0.05 --keywords keywords.txt`, once an hour for 24 hours | $0.05 a run | up to 2 hours a run |

Each writes `docs/spikes/S-xx.md` (S-15 also keeps its rows in `S-15.csv`). S-01 keeps one answer
of each call in `backend/tests/fixtures/dataforseo/captured/`, with the account's login replaced.

## After the runs

- Replace the synthetic fixtures with the captured ones, and check the points listed in
  `backend/tests/fixtures/dataforseo/README.md`.
- Turn on `RESOLVE_UNKNOWN_SUBMISSIONS` only if S-01 found the tag under `metadata.tag` in
  `id_list` for every task.
- Update the price book and doc 06 section 6.2 with the billing S-01 measured, doc 28's storage
  projection with S-02, the async share in doc 27 with S-03, and window sizing in doc 21 with S-15.
