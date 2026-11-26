# WP-69: AI referral sessions from Google Analytics

## Status

Built by WP-69 on 2026-11-26. One route, `GET {P}/fp/ai-referrals`, answers the card "AI traffic" of the Overview
(request: [backend-requests-overview.md](../backend-requests-overview.md) section 5; rows BE-GEO-11 and OV-TRF-01).
Specification: `docs/19-api-specification.md` section 3.10 and `docs/18-first-party-integrations.md` sections 7.3 and 11.4.
Plan: [2026-11-26-ai-wp-69-ga4-referrals.md](../../superpowers/plans/2026-11-26-ai-wp-69-ga4-referrals.md) decisions 3 and 6.
The schemas are in `backend/src/idraft/api/schemas/fp.py`; the route, service and repository are in `backend/src/idraft/api/fp/`.
The route is not marked `@not_built`: it was never published as a stub, it is built in one step.

The numbers come from `fp.ai_referral_daily`, which the GA4 sync (`collectors/ga4_sync.py`) fills. Each GA4 row is classified twice
(doc 18 section 7.3): `ga4_ai_assistant_channel` (GA4's own `AI Assistant` channel group) and `own_rules` (our versioned referrer
rules). The route returns both side by side and says neither is the correct one.

## Route and parameters

| Method | Path | Permission | Success |
|---|---|---|---|
| GET | `{P}/fp/ai-referrals` | `data:read` | `200 AiReferralsResponse` |

| Parameter | Type | Meaning |
|---|---|---|
| `from` | date | First project-local day, included. Default: the 28 days ending today. |
| `to` | date | Last project-local day, included. At most 92 days from `from` (`422 window_too_large`). |
| `compare` | `none` (default), `previous_period`, `previous_year` | The window compared with: as many days just before the window, or the same dates a year earlier. |
| `compare_from`, `compare_to` | date | A window of the caller's own; both or neither (one alone is `422 validation_failed` at the missing one); at most 92 days; they win over `compare`. |
| `group_by` | `assistant` (default), `origin`, `landing_page` | `assistant`: one row per assistant code. `origin`: one row per origin of the rows (only `ga4` exists today). `landing_page` answers `422 not_available`: the landing page report is not built yet. |
| `classifier` | `both` (default), `ga4_ai_assistant_channel`, `own_rules` | Which classifier values are filled. The other one is `null`. |

The window is read the way the prompts summary reads it, so the same bounds and errors apply.

## Response

```json
{
  "data": [
    {
      "key": "chatgpt",
      "ga4_ai_assistant_channel": {
        "sessions": 40, "engaged_sessions": 31, "key_events": "6.00",
        "previous": { "sessions": 25, "engaged_sessions": 19, "key_events": "2.00" }
      },
      "own_rules": { "sessions": 44, "engaged_sessions": 33, "key_events": "6.00", "previous": null },
      "difference": 4
    }
  ],
  "meta": {
    "connected": true,
    "collected_through": "2026-11-25",
    "collected_since": "2026-08-28",
    "window_collected": true,
    "last_success_at": "2026-11-26T14:00:12Z",
    "window": { "from": "2026-10-29", "to": "2026-11-25", "timezone": "UTC" },
    "compare_window": { "from": "2026-10-01", "to": "2026-10-28", "timezone": "UTC" },
    "rules_version": 1,
    "lower_bound": true,
    "notes": ["..."]
  }
}
```

`data[]` has at most one row per key. Sorted by the larger of the two sessions values, then by key.

| Field | Type | Meaning |
|---|---|---|
| `key` | string | The assistant code (`chatgpt`, `perplexity`; for GA4 channel rows the lowercased `sessionSource`) or, with `group_by=origin`, the origin. |
| `ga4_ai_assistant_channel`, `own_rules` | `AiReferralValue` or null | The sessions of the key under that classifier in the window. Null when the classifier was not asked for, or has no row for the key in the window. |
| `<classifier>.sessions`, `.engaged_sessions` | integer or null | Sums over the window. Null when the rows of the key hold no count at all (a sum of nothing is not 0); `difference` is then null too. |
| `<classifier>.key_events` | decimal string or null | Sum of `key_events` (two decimals); null when GA4 gave none. |
| `<classifier>.previous` | `AiReferralCounts` or null | The same three numbers over the compared window. Null when nothing is compared, when the compared window is not fully collected, or when the key has no row in it (see the rules below). |
| `difference` | integer or null | `own_rules.sessions` minus `ga4_ai_assistant_channel.sessions`; null when either is null. |

| `meta` field | Type | Meaning |
|---|---|---|
| `connected` | boolean | The project has a ga4 integration whose status is not `disabled`. |
| `collected_through` | date or null | The last day a finished sync run stored (`backfill_state.ga4.through`). Null when the sync never finished. |
| `collected_since` | date or null | The first day the first finished sync run stored (`backfill_state.ga4.since`), recorded once and never moved. The first pull covers 90 days and a window can be 92, so a window can start before it. Null when the sync never finished, or when the state was written before this field existed (nothing in production yet; a later run does not fill it, only a new first pull does). |
| `window_collected` | boolean | True when every day of `window` is stored: see the rule below. |
| `last_success_at` | timestamp or null | `fp.integrations.last_success_at` of that integration. |
| `window`, `compare_window` | `{ from, to, timezone }` or null | The days used; `compare_window` is null when nothing is compared. |
| `rules_version` | integer or null | The rule set version of the own rules rows in `window` only (not of the compared window); null when there are none. |
| `lower_bound` | boolean | Always `true`. |
| `notes` | string[] | Fixed English sentences the web shows. See below. |

## Null versus zero

- No live ga4 integration: `200`, `connected: false`, `data: []`, `collected_through: null`.
- Connected, never collected (`collected_through` null): `200`, `data: []`. A note says nothing is collected yet.
- Collected: an assistant with no row in the window is absent from `data`. The route never writes a `0` for an assistant it
  has no row for. The web reads an empty `data` with `meta.window_collected: true` as zero AI sessions, and with
  `window_collected: false` as not (fully) collected, never as zero.
- `window_collected` is true when `collected_since` is not null and at or before the first day of `window`, and
  `collected_through` is at or after the last day that has to be stored. That day is the window's `to`, except for a window
  that ends today (project local) or later, which needs yesterday: a pull ends yesterday, so no window that ends today could
  otherwise be complete (the default window ends today). A window that ended earlier gets no such relief. `collected_through`
  is the GA4 property's date (Pacific in this slice) and a window is in project local days, so the rule never takes a day
  short of the end as the end, and a project east of Pacific whose window ends today can read false until Pacific has caught
  up. It is false when nothing is connected, never collected, or `collected_since` is null.
- `collected_through` before `from`: `data: []` and a note says the window starts after what was collected. The window is not
  read, so no number is made up for it.
- `collected_through` inside the window, or `collected_since` after its first day: the rows of the days collected are summed,
  `window_collected` is false and a note says up to which day, or from which day, the figures go.
- `previous` is null unless the compared window is collected by the same rule (`collected_since` at or before its first day and
  `collected_through` covering its last). It is also null for a key with no row in the compared window: the route states only
  what it read, and the web does not read it as 0.
- Only rows with `is_current` and `landing_url_id = 0` (all pages) count. When a project has several ga4 integrations, the route
  reads the first live one (an `active` one first, then the one that last succeeded).

## Notes

`meta.notes` always holds these three sentences, in this order, then the ones that apply:

1. `Google AI Mode and Google AI Overview are not counted: Google Analytics files their visits under organic search.`
2. `The figures are a lower bound: visits without a referrer, such as clicks from native apps, are filed under direct.`
3. `The two classifiers are shown side by side and neither is labelled correct.`

Then, when it applies:

- `Google Analytics has not been collected yet for this project.` (connected, `collected_through` null)
- `Collected up to <date>, before the start of this window, so nothing is shown for it.` (`collected_through` before `from`)
- `Collected up to <date>: the days after it are not in these figures.` (`collected_through` before the last day that has to be stored)
- `The figures start on <date>: the days of this window before it were not collected.` (`collected_since` after the first day of the window)
- `The first collected day is not recorded for this project, so the window cannot be called fully collected.` (`collected_since` null while `collected_through` is set)
- `The compared window is not fully collected, so no comparison is shown.` (a comparison was asked for and is not covered)

## Error codes

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | No session. |
| 404 | `not_found` | Not a member of the workspace; a project outside the member's scope or the workspace. |
| 403 | `forbidden` | The role lacks `data:read`. |
| 422 | `validation_failed` | A value that is not a date, a `group_by`, `classifier` or `compare` outside its list, `from` after `to`, only one of `compare_from` and `compare_to`. |
| 422 | `window_too_large` | A window of more than 92 days (carries `limit_days`). |
| 422 | `not_available` | `group_by=landing_page`: `NotAvailableError`, declared in `api/fp/service.py`. |

Order: 401, 404 (workspace, then project), 403, 422 for values FastAPI checks, then the service: 404 for a project that does not
exist, `not_available`, then the window errors.

## Statements

Beside the session and membership checks, the route sends at most three statements: the project's timezone, the integration facts
(one row), and one grouped read of both windows and both classifiers (`GROUP BY classifier, key`, `SUM ... FILTER` per window).
It sends two when nothing is connected or collected, because there is nothing to read. Every statement names `workspace_id` and
`project_id`.

## Change log

| Date | Change |
|---|---|
| 2026-11-26 | Built by WP-69 as published above. Deviations from doc 19: `window` is `from` and `to` as the prompts summary has them; each value is a small `AiReferralValue`, not a `MetricValue`. |
| 2026-11-26 | Review fixes: `meta.collected_since` and `meta.window_collected` added (the sync records the first pulled day); `previous` also needs the compared window to start after it; `rules_version` is of the window alone; `sessions` and `engaged_sessions` are null, not 0, when the rows hold no count. |
