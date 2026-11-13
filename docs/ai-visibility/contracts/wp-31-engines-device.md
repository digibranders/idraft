# WP-31: the device of an AI engine

## Status

Published by WP-31 (Task 1) on 2026-11-14. Owner package:
[WP-31 settings-engines](../work-packages/WP-31-settings-engines.md), row BE-ENGINES-10. Plan:
[docs/superpowers/plans/2026-11-14-ai-wp-31-settings.md](../../superpowers/plans/2026-11-14-ai-wp-31-settings.md).
The schemas are in `backend/src/idraft/api/schemas/ai_engines.py` (`EngineProviderParams`,
`EngineProviderParamsUpdate`), used by `ProjectEngine` and `EngineUpdate` in `api/schemas/ai.py`. The
device rule is `device_of` and `Engine.supports_device` in `backend/src/idraft/domain/ai_engines.py`.
Web consumer: WP-31 Task 5 (the device selector).

Built, not a stub: no route is added and no route changes its access. Two existing operations gain an
optional field each. Part 2 (Task 2) makes the Google AI Mode request use the device; until then the
device is stored and shown but the collector still sends `desktop`.

## Routes and parameters

`{P}` is `/api/v1/workspaces/{workspace_id}/projects/{project_id}`.

| Method | Path | Permission | Change |
|---|---|---|---|
| GET | `{P}/engines` | `data:read` | Each row gains `provider_params`. |
| PUT | `{P}/engines/{engine_code}` | `projects:write` | The body gains an optional `provider_params`; the answer gains `provider_params`. |

Request member (`EngineUpdate.provider_params`), optional:

| Field | Type | Bounds | Meaning |
|---|---|---|---|
| `provider_params` | `EngineProviderParamsUpdate` or null | | Omit it to keep the saved device. |
| `provider_params.device` | `desktop` or `mobile` | required inside the object | The device Google AI Mode asks from. |

Response member (`ProjectEngine.provider_params`, optional in the generated client, always sent):

| Field | Type | Meaning |
|---|---|---|
| `provider_params` | `EngineProviderParams` | |
| `provider_params.device` | `desktop`, `mobile` or null | Null means the engine takes no device (ChatGPT and Gemini). Google AI Mode reads `desktop` while the engine is unconfigured, and for a row that holds no device. |

Rules:

- Only `google_ai_mode` takes a device. A device for `chatgpt_web` or `gemini_web` answers `422
  validation_failed` with the error `device_not_supported` at path `provider_params.device`, and nothing
  is saved.
- A value other than `desktop` or `mobile` (including `null` and an empty string) answers `422
  validation_failed` at path `provider_params.device`, from the schema. An unknown member of
  `provider_params` is refused like any unknown body member.
- A PUT without `provider_params` keeps the saved device. Saving the countries or turning the engine on
  or off never resets it. A PUT with one changes it, also while the engine is off.
- Google AI Mode rows always store `{"device": "desktop" | "mobile"}` when written; the other engines
  store `{}`.
- A stored value that is missing, is not `desktop` or `mobile`, or is not an object reads as `desktop`.
- The device is part of the audit entry `project_engine.updated` (`before` and `after`, key `device`) for
  Google AI Mode only. The entries of the other engines keep their three keys.
- Migration `0023_ai_project_engine_provider_params_grant`: a grant only, no data change.
  `ai.project_engines.provider_params` exists since migration 0018, but the `app_api` role could update
  only `location_ids` and `is_enabled` of that table. 0023 grants `UPDATE (provider_params)` to `app_api`
  and nothing else (no table-level UPDATE, no other column, no other role). `replicates`,
  `provider_code`, `engine_code` and `workspace_id` stay out of the API's reach, and row-level security
  is untouched. The save is an upsert that sets `location_ids`, `is_enabled` and `provider_params`.
  OPERATIONS NOTE: the shared development database needs `alembic upgrade head`; this package does not
  run it. The number is 0023 unless another package took it first (the coordinator renumbers at push).
- Comparability: earlier AI Mode answers keep the device they were asked with; no `ADAPTER_VERSION` bump.

## Examples

Request, `PUT {P}/engines/google_ai_mode`:

```json
{"location_ids": [2840], "is_enabled": true, "provider_params": {"device": "mobile"}}
```

Response `data` (the `Engine` member is shown as served):

```json
{
  "engine": {"engine_code": "google_ai_mode", "label": "Google AI Mode", "observation_class": "serp_ai", "vendor": "google", "exposes_citations": true, "exposes_fanout": false, "max_prompt_chars": 700},
  "is_configured": true,
  "is_enabled": true,
  "location_ids": [2840],
  "replicates": 1,
  "provider_code": "dataforseo",
  "provider_params": {"device": "mobile"},
  "active_prompts": 12,
  "estimated_monthly_cost_usd": "0.12"
}
```

A ChatGPT or Gemini row carries `"provider_params": {"device": null}`.

Refusal, `PUT {P}/engines/chatgpt_web` with a device: `422`, code `validation_failed`, `errors` holds
`{"location": "body", "path": "provider_params.device", "code": "device_not_supported"}`.

## Open choices

- Mobile sends os `android` to DataForSEO (Task 2); a real AI Mode mobile request was never made. Owner
  can confirm with one paid check later.

## Change log

Newest last; one line per change, in the form `date package: change`.

2026-11-14 WP-31: contract published and built (setting and API); the collector change is Task 2
2026-11-14 WP-31: migration 0023 grants `UPDATE (provider_params)` on `ai.project_engines` to `app_api`; no shape change
