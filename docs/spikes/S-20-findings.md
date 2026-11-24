# S-20 findings: DataForSEO against cloro

Run 2026-11-23. Tables: [S-20.md](S-20.md). Harness: `backend/spikes/s20_provider_ab.py`.

## What was run

- DataForSEO (standard queue): all 290 tasks (50 prompts on ChatGPT forced, ChatGPT natural, Gemini and
  AI Mode, 50 keywords on Google with the AI Overview, plus every fifth item twice). 290 of 290 answered.
  Cost at list price: about $0.34 (the scrapers report no cost in `task_get`).
- cloro (free plan, 470 credits): 92 tasks, 23 prompts and 23 keywords (indices 0 to 18 plus four repeats),
  all India. 92 of 92 answered, 460 credits spent.
- Limits: cloro covers 23 items, not 50; its run-to-run floor is 4 pairs; AE, SA, SG and US were not run on
  cloro (the country list says they are supported); one day; no ground truth for correctness.

## Findings

1. Both providers answered everything (290 of 290, 92 of 92). Completion is not a differentiator.
2. Query fan-out: DataForSEO returned it on 60 of 60 forced and 39 of 50 natural ChatGPT answers. cloro
   returned none on 23 of 23, with `include.searchQueries` and the +2 credits paid. cloro also has no
   fan-out for Gemini or AI Mode (nor does DataForSEO).
3. ChatGPT, Gemini: the two providers disagree about as much as one provider disagrees with itself (cited
   domains Jaccard 0.29 against floors of 0.49 and 0.18; Gemini 0.13 against 0.07 and 0.00). Gemini cites
   sources on only 43% of answers on both. Brand mentions agree about as well as repeats do.
4. AI Mode: they differ more than noise (0.20 against floors of about 0.5). cloro returns a median of 8
   cited sources against 2 from DataForSEO, so it captures a different, larger set.
5. Google SERP: top-10 pages in common 0.12 between providers, and DataForSEO against itself only 0.36
   (3 of 10 keywords identical, the rest fully different); cloro against itself 2 of 4. The result is
   bimodal: the same set or none of it. Google serves different result sets for these keywords from one run
   to the next, whichever provider asks. Switching provider does not fix rank variance.
6. AI Overview: both showed one on 20 of 23 keywords; sources in common 0.29.
7. Time: cloro task time is 12 s (AI Mode), 14 s (Google), 50 s (ChatGPT), 53 s (Gemini). Its waits of about
   30 minutes are the free plan's one-task-at-a-time queue, not the engine. DataForSEO standard waits were
   65 s (ChatGPT), 158 s (Gemini), 313 s (AI Mode and Google), as seen by a 30 second poll.
8. Billing: cloro charges the AI Overview +2 credits even when none is shown (2 of 23 cases); DataForSEO
   charged the extra only when one existed (41 of 60 searches).
9. Cost at the base plan (150 prompts, twice a week, three engines): DataForSEO $4.68 a month; cloro 19,500
   credits, so the $30 Lite plan (6.4 times), $100 on Hobby. Metered equivalents $15.60 (Lite price) to
   $7.21 (Growth price), but plans are not metered.

## Recommendation

- Keep DataForSEO as the source for every surface the product collects: it is cheaper, it returns fan-out
  (the main reason to track ChatGPT), and its answers are as consistent as cloro's.
- cloro, if wanted, as a side lane: a monthly cross-check on the free plan (500 credits is about 30 prompts
  on three engines), a fallback if DataForSEO has an outage, and an option if AI Mode needs many more
  cited sources per answer.
- Do not use cloro for fan-out, rank tracking, volume, or for Perplexity, Copilot, Grok or Claude.
- Rank tracking: neither provider is stable on these keywords; that needs more samples or Search Console,
  not a provider swap.
