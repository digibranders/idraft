# DataForSEO fixtures

**Synthetic.** Every file here was written by hand from DataForSEO's documentation, not captured
from the API. They have the documented shape and fields, and nothing more is claimed for them.
Spike S-01 captures real answers with the fixture tool in `backend/spikes/`; those replace these
files (plan `docs/superpowers/plans/2026-09-30-dataforseo-raw-storage.md`, decision D8).

Points S-01 checks against the real API before anything depends on them:

- `id_list.json`: that the task's `tag` comes back under `metadata` when `include_metadata` is
  true.
- `user_data.json`: the paths of the balance (`money.balance`), the calls allowed per minute
  (`rates.limits.minute.total`) and the day's spend (`money.statistics.day.total`).
- `task_post.json`: that `data` echoes the posted task, `tag` included, for refused tasks as
  well as accepted ones; that a task without `people_also_ask_click_depth` is taken (the
  documented values are 1 to 4, so 0 is never sent); that a keyword with `%25` and `%2B` is
  searched with `%` and `+`.
- `id_list.json`: that `result_count` is the number of items in `result`.

Tags in these files are for installation `test`, task 35 (`z` in base 36), attempt 1 and run
`0192f0a1-3c44-7e10-8a51-2b7d9c0e4f11`.
