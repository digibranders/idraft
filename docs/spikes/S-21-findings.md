# S-21 findings: cloro on a paid plan, two groups

Run 2026-11-23. Tables: [S-21.md](S-21.md). Same harness as S-20 (`backend/spikes/s20_provider_ab.py --fresh`).

## What was run

- Group A: 10 India prompts and 10 India keywords. Group B: 10 prompts and 10 keywords for AE, SA, SG and US.
  Fresh items cloro had not seen. Four items of each kind sent twice (the floor).
- cloro on the Lite plan (37,500 credits, 10 tasks at a time): 96 of 96 answered, 480 credits.
- DataForSEO standard queue, same hour, same items: 116 of 116 answered, about $0.13 at list price.
- Extra: 20 ChatGPT prompts with cloro's `legacy` flag (140 credits).
- Limits: the floor is 2 pairs per group; one day; no ground truth for correctness; the AE and SA local-domain
  shares rest on 3 items each; SG and US were collected but the report has no .sg or .us column.

## Findings

1. Completion is equal again (cloro 96 of 96, DataForSEO 116 of 116).
2. Fan-out: cloro's default ChatGPT path returned none (0 of 24 again). With `legacy: true` it returned fan-out
   on 17 of 20 prompts (mean 1.1 queries; DataForSEO's median is 1), at the same 7 credits. The flag was added
   on 28 Aug as "temporary, best-effort", so it is a dependency on a switch cloro may remove.
3. Sources per answer: cloro ChatGPT 18 default and 32 with legacy, against 6 to 10 from DataForSEO; AI Mode
   8 to 10 against 2. Domain agreement with DataForSEO is the same on both cloro paths (0.24 and 0.25).
4. Country: both react to it. cloro's Gemini localizes (.ae 0.29, .sa 0.67 of cited domains); DataForSEO's
   Gemini barely does (0.00 and 0.08). On AI Mode DataForSEO is more local in the UAE (0.89 against 0.47).
5. AI Overview: both returned one on 21 of 24 keywords and agree on its sources (0.73 in India, 0.38 abroad).
6. Google top 10: no agreement in India (0.00 over 12 keywords, no shared first result); 0.24 abroad. cloro
   repeats itself closely (1.00 and 0.89 on its repeat keywords); DataForSEO does not (0.06 and 0.50). Over
   both runs cloro repeats at about 0.72 (8 keywords) and DataForSEO at about 0.34 (14). Stable is not the
   same as right, and nothing here says which one matches Google.
7. Time: cloro task time 8 to 14 s (Google, AI Mode), 39 to 60 s (ChatGPT, Gemini). Waits of 94 to 340 s are
   queueing of 96 tasks at once on 10 slots. DataForSEO standard waits 63 to 193 s.
8. Cost has not moved: $4.68 a month at the base plan on DataForSEO; the $30 Lite plan on cloro (19,500
   credits of 37,500). Google Search with the AI Overview is 5 credits ($0.004 on Lite) against $0.0012.

## Recommendation

- AI answers (ChatGPT, Gemini, AI Mode, AI Overview): DataForSEO stays the default on cost. cloro is a real
  alternative here, not a weaker one: it returns more cited sources, localizes Gemini better and can return
  fan-out with `legacy`.
- Where cloro earns its price: the Citations work (4 times the cited sources per AI Mode answer) and Gemini
  in the Gulf. Use it as a second source for those, or as the fallback when DataForSEO is down.
- Rank tracking: do not switch on this evidence. The providers disagree completely in India. Check both
  against Search Console positions for the Eventus keywords first.
