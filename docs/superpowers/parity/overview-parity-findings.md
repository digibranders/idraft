# Overview parity register: findings of the re-sync pass

Date: 2026-11-17. Worktree `port-regov` (branch `port/regov`, cut from `port/real-app` at `6fe302f1`). Documentation only: no
code was changed.

How the rows were checked:

- The real app ran on `http://localhost:3411` with the mock API (Playwright Chromium, fixture project Eventus Security),
  next to the preview on `http://localhost:4190` (newest preview commit `36d32e13`). Page text, accessibility names, card
  boxes and keyboard behaviour were read with scripts at 1920, 1440, 1280, 1024, 768 and 390 px, in light and dark, in six
  scopes (All, ChatGPT, Gemini, AI Mode, AI Overview, Compare off), with one group chosen, with the three presets applied,
  with the competitor drawer open (three tabs) and in customize mode (as an editor and as an admin).
- Every long string of the `aiov-*.js` files was searched in `messages/en.json` and the layout catalog; every long string
  of the register was searched in the preview source.
- `vitest` on `src/features/ai-overview`, `src/lib/layouts`, `src/lib/glossary` and `src/lib/prompt-facts`: 223 files, 2,810
  tests, all passing. The test names are cited in the last column of each row.
- An axe scan (`@axe-core/playwright`, wcag2a, wcag2aa, wcag21aa) of the Overview at 1440 px (light and dark), 1024 px and
  390 px.

## 1. Rows that were untrue, and what is true

| Row                      | What the register said                                                   | What is true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OV-DRW-30                | `done 68df60c0`, "Same strings as the row"                               | Six of the seven drawer info texts equal the row. The trend how reads "One point for each weekly run. With Compare on, the weeks are the previous 28 days and then the current 28 days, as on the trend of the page." where the preview says "The 8 weeks are the previous 28 days and the current 28 days." (a deliberate change, N6 of the review, but the row was not marked). Set to `differs`. The row also said "Their own domain ranks high ...": the preview (since `36d32e13`) and the real app say "Their domain ranks high ...". The row text was corrected. |
| OV-SCOPE-05              | flat list, no parents and no indentation                                 | The list is flat and has no indentation, but each option carries its parent as text (`Pricing and buying / SOC pricing`). The status now says so.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| OV-GRP-12                | notes `All groups 38% (+6 pts)`                                          | Written before preview `15bd576c`: the gap is now a trend icon with its sentence in the hover, in the preview and in the real app. The row is `differs` and names it.                                                                                                                                                                                                                                                                                                                                                                                                   |
| OV-HEAD-21               | 203 px at 1280 px                                                        | The preview now measures 215 px at 1280 px (the real app 211). Both apps measured; `differs` with the numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| OV-SHELL-07, OV-HEAD-16  | status text `Updated Sep 28, 02:10 · run 48`; tooltip `Run 48, last ...` | The real app has no run number: `AI updated Nov 16, 07:30` and `8 runs in this period, last Nov 16, 01:00`. Both `differs`.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OV-RESP-01 to OV-RESP-05 | measured at the preview, 1920 to 768 px                                  | Re-measured in both apps: the toolbar is two rows (96 px) at 1440, 1280 and 1024 px in the real app, one row at 1280 px in the preview; the real referral and fan-out cards are 370 px high at 1440 px (the content is taller than their smallest height of 346 px).                                                                                                                                                                                                                                                                                                    |

Rows that were already `done` and were looked at again in the real app (31) and held: OV-SHELL-10, OV-SCOPE-05 (with the
note above), OV-SCOPE-13 (Top cited domains 876 and 803 units add to the 1,679 of All platforms, no pooled AI Mode),
OV-KEEP-04 (Gemini), OV-HEAD-05, OV-HEAD-06, OV-HEAD-11, OV-HEAD-12, OV-HEAD-13, OV-OUT-04, OV-SOV-01, OV-SOV-04,
OV-SOV-06 (the info text equals the preview word for word), OV-GAP-01, OV-GAP-03, OV-CIT-01, OV-CIT-05, OV-CIT-06,
OV-PT-01, OV-PT-03, OV-TRF-05, OV-DRW-02, OV-DRW-03, OV-DRW-06, OV-DRW-07, OV-DRW-11, OV-DRW-20, OV-DRW-21, OV-DRW-22,
OV-DRW-23, OV-DRW-40. Of the 32 already-`done` rows looked at (these 31 and OV-DRW-30), only OV-DRW-30 was untrue. The other
15 already-`done` rows were not looked at again beyond their tests. Rows set to `done` in this pass each name a test, a
measurement or both.

## 2. Real gaps (features missing or defective in the real app)

| Gap                                                     | Row                   | What happens                                                                                                                                                                                                                                                   | Suggested action                                                                                                         |
| ------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Share of voice over time without per-brand weekly cells | OV-SOVT-05 (`todo`)   | When the summary carries no per-brand weekly cells (backend request 10), `weeksModel` returns `unread` and the card shows its error state with Retry (`sov-over-time-card.tsx` line 265). The register asks for `Not collected yet`. No test covers this case. | Draw the `Not collected yet` state and add a test.                                                                       |
| One axe violation on the page                           | OV-KEY-02 (`todo`)    | `scrollable-region-focusable` at 1440 px, light and dark: the scroll area of the Top fan-out queries card cannot take focus. 1024 and 390 px are clean.                                                                                                        | Give the scroll area `tabindex="0"` and a name in the shared table scroller; then the e2e axe scan (OV-E2E-07) can pass. |
| Cards are unnamed sections                              | OV-KEY-04 (`differs`) | A ready chart card is a `section` with an h2 and no `aria-labelledby` or `aria-label` (`chart-frame.tsx` line 526), so it is not a landmark; the empty and error states do name it.                                                                            | Add `aria-labelledby` to the ready section of `ChartFrame`.                                                              |
| No Cmd or Ctrl K command palette                        | OV-KEY-08 (`differs`) | The top bar of the real app has no search box and no palette on this page (only a mock handler exists). The preview has both. This is a shell gap, not an Overview one.                                                                                        | Decide with the owner whether the palette is in scope.                                                                   |
| Spec still describes the old empty-card rule            | OV-KEEP-13 (`todo`)   | `docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md` lines 51 and 105 still say cards that cannot be drawn are hidden and a note says how many. The real app and the mock keep every card with a reason.                                         | Update the spec (a documentation change, outside this pass).                                                             |

Known and recorded, not new: Google AI Mode and Google AI Overview cannot be chosen (OV-SCOPE-01, OV-SCOPE-03, backend
B7); the Tile lines of Mention position, Recommendation rate and Sentiment are missing for lack of weekly series
(OV-HEAD-14); Citations by domain type uses roles until the API returns a type (OV-CIT-03); AI referral visits says GA4
is not connected (OV-TRF-01 to OV-TRF-03).

Differences that the owner may want to look at (all `differs`, none a defect):

- OV-LAY-01: the descriptions of five cards differ from the preview (the titles were aligned, see below), and the Add
  card dialog groups the cards as SEO, AI, Cross-channel, Activity and Traffic.
- OV-LAY-04 to OV-LAY-06: the Start from menu has no description line for the presets.
- OV-TREND-10: the Table switch of a card stays when the scope changes (the preview rebuilds the card).
- OV-GRP-04, OV-GRP-05: the heat map uses the design system's seven bins (edges 10, 20, 35, 50 and 70%), not the preview's
  edges, and prints `3 ans` in a thin cell.
- OV-KEY-01: the shared Select opens on ArrowDown and does not wrap.
- OV-SHELL-02: decided by the owner 2026-11-17 and done in `port/dec-wording`: breadcrumb and sidebar item `AI visibility`,
  page title (h1, tab title) `AI visibility overview`, in the preview and the real app.
- OV-LAY-01, titles: decided 2026-11-17 and done: the five card titles are the glossary's everywhere (see the register row).

Wording that is not from the glossary and stays, for the owner to approve (decision 11, `port/dec-wording`):

- Heat map info "how" (`aiOverview.topics.groups.info.heatmap.how`): says a prompt can be in more than one group, so the groups
  may add up to more than the total; the glossary says every prompt is in one group. The real data allows several groups.
- Lost to competitor info "how" (`aiOverview.competitors.scopeGap.info.how`): the All platforms rule (a brand leads when it leads
  on one platform and the other leads on none) has no glossary sentence.
- Citations by domain type info "how" (`aiOverview.sourcesTracking.domainTypes.infoHow`): says the areas are grouped by who owns
  the domain, and that finer types are not classified yet (OV-CIT-03); the glossary lists all six domain types.
- Run calendar info "how" (`aiOverview.activity.calendar.info.how`): says each cell is one day; the glossary says one weekly
  run. It stays until the weekly run log exists (OV-CAL-01), because the glossary sentence would be wrong for a daily cell.
- Rate by platform over time and Key changes info: the glossary text with the number of days as a variable
  (`{days}`), not the fixed 28.
- `aiOverview.headline.facts.*` (the tile tooltip `The platforms in this scope do not classify this measure`, the
  `Not enough data: a position needs at least 4 answers that give your brand a place` family and the note `Not classified`):
  glossary S4 and S6 give the pattern, not these sentences.

Replaced by the glossary text in the same pass: the competitor drawer trend "how" now says the weeks are the previous and the
current period (`aiOverview.competitorDrawer.trend.info.how`).

## 3. Preview changes after the register header not yet in the real app

The header commit is `7050439d`. Preview commits after it, newest `36d32e13`:

| Commit                                                                                | Touches the Overview                                        | In the real app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fff09a26` Citations page replaces Sources                                            | `index.html`, `interactions.js` (sidebar)                   | Yes: the navigation has Overview, Prompts, Citations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `3d6a8843`, `f4c672b3`, `e4c433ff` Prompts and Citations trend icons                  | No                                                          | Not an Overview change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `d54204f8` Citations page                                                             | No                                                          | Not an Overview change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `45cf3fcb`, `2b582033` Internal links                                                 | No                                                          | Not an Overview change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `15bd576c` trend icon for a group against all groups and for you against a competitor | `aiov-cards-more.js`, `aiov-competitor.js`, `aiov-parts.js` | Yes: the group against all groups card, the drawer Gap column and the drawer By platform rows show the icon with its sentence and `Not tested for detectability` (OV-GRP-12, OV-DRW-10, OV-DRW-12 name the remaining wording differences).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `36d32e13` glossary applied to the mock                                               | every `aiov-*.js`, `index.html`, `interactions.js`          | Mostly: every `aiov-info.js` string and every card string equals the real app's. Not in the real app: (a) the heat map thin-cell tooltip `Too few valid answers for a rate (fewer than 4)` (the real cell prints `3 ans`, OV-GRP-05); (b) the preset descriptions (OV-LAY-04 to OV-LAY-06) and the registry descriptions of five cards (OV-LAY-01); (c) the average tooltip `The equal-weight average of the platforms that have this measure. Platforms are never pooled` (the real app says `Average of N platforms: ...`); (d) the Key changes detail `cited at least twice, none before` (the real feed has its own words, OV-CHG-02); (e) the customize toasts and dialog strings of the mock (OV-CUST-09 to OV-CUST-16, a different design). The top bar label `Period: ...` is in the real app. |

No row was added: each difference above already has a row, and its status now names it.

## 4. Rows that remain `todo`, and why

| Row                    | Why                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| OV-KEEP-13             | The spec text still says the old rule (documentation).                                    |
| OV-SOVT-05             | The `Not collected yet` state of Share of voice over time is not built (section 2).       |
| OV-KEY-02              | One axe violation (section 2); the page scan across widths and themes is the e2e rewrite. |
| OV-E2E-01 to OV-E2E-07 | `e2e rewrite in progress`: another package rewrites the specs.                            |

## 5. Tally by status

Rows with a status column: 223 (the register also has 66 rows without one: OV-NOPORT 16, OV-DATA 31, OV-OPEN 19).

Total: before `todo` 139, `done` 47, `differs` 37; after `todo` 10, `done` 126, `differs` 87.

| Area  | Rows | todo before | done before | differs before | todo after | done after | differs after |
| ----- | ---- | ----------- | ----------- | -------------- | ---------- | ---------- | ------------- |
| SHELL | 17   | 15          | 1           | 1              | 0          | 9          | 8             |
| SCOPE | 14   | 10          | 2           | 2              | 0          | 8          | 6             |
| KEEP  | 13   | 8           | 4           | 1              | 1          | 10         | 2             |
| HEAD  | 21   | 14          | 6           | 1              | 0          | 17         | 4             |
| TREND | 14   | 11          | 0           | 3              | 0          | 6          | 8             |
| OUT   | 5    | 4           | 1           | 0              | 0          | 4          | 1             |
| SOV   | 7    | 0           | 4           | 3              | 0          | 4          | 3             |
| SOVT  | 5    | 5           | 0           | 0              | 1          | 3          | 1             |
| GAP   | 7    | 0           | 4           | 3              | 0          | 4          | 3             |
| GRP   | 14   | 14          | 0           | 0              | 0          | 5          | 9             |
| CIT   | 7    | 0           | 4           | 3              | 0          | 4          | 3             |
| PT    | 4    | 0           | 4           | 0              | 0          | 4          | 0             |
| TRF   | 6    | 0           | 3           | 3              | 0          | 3          | 3             |
| CHG   | 2    | 0           | 0           | 2              | 0          | 0          | 2             |
| CAL   | 2    | 0           | 0           | 2              | 0          | 0          | 2             |
| INFO  | 5    | 3           | 1           | 1              | 0          | 4          | 1             |
| LAY   | 12   | 11          | 0           | 1              | 0          | 10         | 2             |
| CUST  | 20   | 19          | 0           | 1              | 0          | 8          | 12            |
| DRW   | 22   | 0           | 13          | 9              | 0          | 12         | 10            |
| KEY   | 8    | 8           | 0           | 0              | 1          | 4          | 3             |
| RESP  | 9    | 8           | 0           | 1              | 0          | 5          | 4             |
| TERM  | 2    | 2           | 0           | 0              | 0          | 2          | 0             |
| E2E   | 7    | 7           | 0           | 0              | 7          | 0          | 0             |

## 6. Not verified

- Google AI Mode and Google AI Overview scopes: the real app cannot select them (AI Mode falls back to All platforms), so
  their placeholders (OV-KEEP-04) rest on the unit tests.
- Production behaviour: the real app ran on the mock API. The Cited domains tab of the drawer, the per-brand weekly cells
  and the facts (position, sentiment, recommendation) are fixtures there; the `Not collected yet` states are tested in
  vitest, not seen in the browser.
- The hover tooltips of the info buttons and of figures (headless hover showed none; the unit tests and the sr text cover
  them), drag and drop in customize mode, the drawer's overlay and sheet modes at 1280, 768 and 390 px, the heights of the
  header and row of the gap table (OV-GAP-01), the 40 px rows and 96 px value column of the share of voice bars
  (OV-SOV-05).
- Dark theme was looked at on the top of the default page only.

## 7. Update of 2026-11-17 (branch `port/gap-overview`)

Closed since the pass above: OV-SOVT-05 (`2a60dae9`), OV-KEY-02 (`ae512e8a`), OV-KEY-04 (`a25b36c9`), OV-KEEP-13
(`2b26aeb4`), OV-TREND-08 (`0d8b01ec`, the legend under the chart with the latest values; the Table button of OV-TREND-02
has its icon). Rows still `todo` after this update: 7 (the seven e2e rows). Backend requests 11 (weekly cells for mention
position, recommendation and sentiment, OV-HEAD-14) and 12 (run number and last run per platform, OV-SHELL-07 and
OV-HEAD-16) were added to `docs/ai-visibility/backend-requests-overview.md`. Left as they are, on purpose:

- DECIDED 2026-11-17 (owner decision 12): the trend card draws its point markers again, a shape for each line, in the
  chart and in the legend, and the preview now draws the same (OV-TREND-04, OV-TREND-08). It had drawn none to match a
  preview with none.
- The Table switch of a card staying on when the scope changes (OV-TREND-10): the state lives in the shared frame.
  Accepted by the owner 2026-11-17 (decision 13), no change.
- The freshness line against the Runs tile (OV-HEAD-16): two different facts (the newest answer, the newest finished run).
