# AI answer screenshots (runbook)

The Screenshot column of the Prompts page shows the real platform page of an AI answer (ChatGPT, Gemini, Google AI Mode), as a
person saw it. Built 2026-11-23. Plan: `docs/superpowers/plans/2026-11-23-ai-answer-screenshots.md`.

## How it works

1. A person with the `runs:trigger` permission opens a row's Screenshot cell and presses "Get screenshot".
2. `POST /api/v1/workspaces/{ws}/projects/{p}/ai/observations/{id}/screenshot` checks the budget, asks DataForSEO
   (`POST /v3/serp/screenshot` with the answer's scraper task id and a browser height of 9,999 px), records the cost, downloads the
   image, trims it to the end of the answer and stores it.
3. `GET` on the same path serves the stored PNG to anyone with `data:read`. The summary's `latest.screenshot_url` is that path.
4. One screenshot per answer, never replaced: a second press returns the stored one and spends nothing.

## What it costs

| | |
|---|---|
| One screenshot | $0.004 (provider-reported, any engine) |
| Every answer captured, base plan (150 prompts, 3 engines, twice a week) | about $15.59 a month; ChatGPT only about $5.20 |
| On demand (what is built) | $0.004 for each answer a person asks for |

The cost is one event in `ops.provider_cost_events`: provider `dataforseo`, endpoint `/v3/serp/screenshot`, workload `ai_prompt`,
channel `ai`. Check a spend:

```sql
SELECT date_trunc('day', occurred_at) AS day, count(*), sum(cost_usd)
FROM ops.provider_cost_events
WHERE provider_code = 'dataforseo' AND endpoint = '/v3/serp/screenshot'
GROUP BY 1 ORDER BY 1 DESC;
```

The cost event is written as soon as the provider answers, before the download. A capture that fails after that point still shows its
cost and stores nothing; the person can press again (and pays again).

## Limits

- **7-day window.** DataForSEO can only screenshot a task within 7 days of its posting. We stop offering it after 6 days 20 hours; the
  cell then says "Expired" and no spend is possible. A weekly schedule can run into this edge.
- **Which engines.** Only the engines that have a page: `chatgpt_web`, `gemini_web`, `google_ai_mode`. Other answers show "n/a".
- **Sources panel.** The image shows the inline citation pills, not the full Sources panel. The dialog lists the cited pages from
  the structured data next to the image.
- **`truncated`.** An answer whose content reaches the bottom of the 9,999 px capture, or ends within 1,000 px of the prompt box, is
  stored whole and flagged `truncated`. Very unlikely.
- **Page height.** ChatGPT and Gemini captures are 9,999 px high; a Google AI Mode capture is as tall as the page (10,117 px seen).
  A capture is refused ("Try again", a 502 in the API log with `error_kind: CaptureError`, and the $0.004 is still spent) when it is
  wider than 4,000 px or holds more than 40 million pixels (about 20,800 px high at 1,920 px wide).
- **Double press from two replicas.** Both could pay; the second upload overwrites the first (same key). No lock is built.

## Where the images live

The raw bucket (`R2_RAW_BUCKET`), key `screenshots/v1/<workspace>/<project>/<observation>.png.zst` (zstd of the PNG), outside the
`raw/v1/<class>/` prefixes that the lifecycle rules expire, so they are kept. The row is `ai.observation_screenshots` (one per
observation, readable by the API role, never updated). The image is only served by the API route, with `Cache-Control: private`.

## Needs on the server

The API process needs `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (the worker already has them) and the raw bucket settings.
Without them `POST` answers `503 screenshots_unavailable` and the cell says "Not available". Never print or copy the server env.

## Not built (separate plans)

1. **Automatic capture** of the latest answer per prompt and engine: needs a per-engine switch on `ai.project_engines` and a budget
   check before each $0.004.
2. **cloro as a source of page images.** cloro has only a 24-hour HTML link, no image.
3. **The full Sources panel** in the image: the screenshot cannot show it.
4. **Screenshots of answers older than 7 days.** DataForSEO cannot make them; automatic capture is the only fix.
