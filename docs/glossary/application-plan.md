# Application plan

For the session that applies the approved glossary. Written 2026-11-16. Nothing here has been applied: no file under
`apps/web` or `design-preview` was edited by the research session.

Baseline measured: branch `port/real-app` at commit `6ffe86e2` (real app), branch `develop` at `7050439d` plus the
uncommitted Prompts files in the main checkout (design preview), and the parity registers on `port/real-app`
(`docs/superpowers/parity/`). Re-run the counts of `research/00-term-inventory.md` before starting; both branches move.

## 0. What changes if the owner takes the recommendations

The four provisional words of the real app (**Platform, Group, Location, Prompts**) are all confirmed by the
recommendations (D1, D2, D3). So the real app changes only for the other terms, and the design preview and the parity
registers change for the four provisional words because the preview still says Engine, Topic and Country in places.

| Area | Size of the change |
|---|---|
| `apps/web/messages/en.json` | About 640 string edits across 15 key lists (section 3; a string in two lists is counted twice, so fewer distinct strings). Largest: Window to Period (162), Source (81), Taxonomy words (81), Named (77), Entity (47) |
| Real app components | None expected: no visible string is hard-coded in a `.tsx` file (checked 2026-11-16). The exception is code that builds a label from a key name, found by the tests |
| Real app tests | Tests render with the real `en.json` and assert literal text (`getByText('None')`, `getByRole('img', { name: 'Check failed' })`). Every renamed string whose old text is asserted needs its test edited. Upper bound by files that contain the old word: Source 48, Named 192, Insufficient 71, Entity 48, Own 81, n/a 82, Window 287, AI Overview 27, Country 24. The Window and Named numbers are inflated by JavaScript uses of those words; expect about a third |
| End-to-end (`apps/web/e2e`) | Upper bound by files: Source 8, Named 18, Insufficient 4, Entity 3, Own 9, Window 34, Country 4 |
| Design preview | The Prompts mock: Engine to Platform (31 occurrences in 6 files), Topic to Group (49 in 11 files). Keywords and Performance mocks: Country to Location (12 in 7 files). The info texts file `aiov-info.js` is rewritten from `terms.md` section 10 |
| Parity registers | Rule 6 of `README.md` stays true. Rows that quote an old word are edited: see section 6 |
| Specs and docs | Doc 16 sections 4 and 5 (D17 and D18), the Overview spec D1 wording, the parity README, a pointer in `AGENTS.md` |

## 1. Order

Apply in this order. Each wave is one commit on a short-lived branch, reviewed, and merged into `develop` (never main).
A wave is independent of the later ones, except where it says so.

| Wave | What | Decision | Size | Depends on |
|---|---|---|---|---|
| W0 | Owner answers `decisions-for-owner.md`; backend answers D17 and D18; terms.md edited to the answers | all | the owner's time | none |
| W1 | The guard script and its test (section 2) | none | S | W0 |
| W2 | Mechanical renames in `en.json`: AK-07 window to period, AK-05 and AK-06 empty states, AK-10 workload, trigger, panel, AK-11 casing, AK-12 Google AI Overview, AK-13 interim and read, AK-14 topic leftovers | D7, D9, D10, D11, D15, D21 | M | W1 |
| W3 | Grammar-sensitive renames: AK-03 named to mentioned (and the outcome labels), AK-04 own to your or the brand name, AK-08 entity to brand, AK-01 country to location | D3, D6, D12, D16 | M | W2 |
| W4 | Sources fold into Citations and the Keywords filter "Added from" (section 4.4) | D4 | M | W3 |
| W5 | Settings Taxonomy page to Tags (section 4.5) | D8, D19 | L | W2 |
| W6 | Info texts: add keys, wire the "i" buttons (section 4.6) | D17, D18 | M | W3, W4 |
| W7 | Design preview and `aiov-info.js` | all | M | W2 to W6 decided, not applied |
| W8 | Parity registers, specs, docs, AGENTS.md pointer | all | S | W7 |

W7 can start as soon as W0 is done: the preview is the source of truth for the two screens, so a preview change
without a register change is unfinished (parity README rule 1). Do W7 and W8 in one commit per touched preview file
group, and say the register IDs in the commit message.

## 2. How to apply one rename (the recipe)

1. Change `terms.md` first: label, banned list, where used, change log line (`README.md` rule).
2. Open the key list for that rename in `docs/glossary/application-keys/` (tab separated, key and current text, taken
   from `en.json` of `port/real-app`). Regenerate it first if `en.json` has changed: the list is only a start.
3. Edit each string in `apps/web/messages/en.json` by hand with the file tools, not with a global replace. Reason: the
   change often needs a new article ("a answer" to "an answer"), a changed verb ("names" to "mentions"), a plural form
   or a re-ordered sentence. ICU variables (`{engine}`, `{count, plural, ...}`) keep their names: variable names are code.
   Keep the key. Renaming a key is a separate, optional step and is not needed.
4. Run `pnpm test` in `apps/web`. Each failing test names an assertion on the old text. Edit the text of the assertion
   to the new string (not the string back). Then `pnpm test` for the e2e project as `apps/web/e2e/README.md` says.
5. Search the preview (`apps/web/design-preview`) and the parity registers for the old word and apply section 5 and 6.
6. Run the guard (section 3 of this file, "Guard"), then `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
   && pnpm build` in `apps/web` (the AGENTS.md checks).
7. Commit with the decision IDs in the message, for example "Glossary W3: named to mentioned (D6)".

## 3. The `en.json` renames, in detail

Key lists are in `application-keys/` (655 lines in total). The count is the number of strings to edit. "Pattern" says
what the new text should look like. Anything not named is left alone.

| ID | Decision | Rename | Strings | Namespaces (top) | Pattern |
|---|---|---|---|---|---|
| AK-07 | D21 | window to period | 162 | aiOverview 87, prompts 26, citations 26, fanout 11, keywordDetail 6 | "this window" to "this period"; "Date window" (the control) to "Period"; "previous window" to "previous period" |
| AK-05 | D9 | insufficient, too few, not enough to one phrase | 34 | aiOverview 26, prompts 6 | The label is "Not enough data". The tooltip keeps the reason and the minimum, for example "3 valid answers; a rate needs at least 4" |
| AK-06 | D9 | n/a | 18 | citations 9, rankings 4, aiOverview 2 | Keep "n/a" only as a table cell text, and only with a tooltip that gives the reason. Spell it out elsewhere |
| AK-10 | D15 | workload, trigger, panel | 13 | projectSettings 4, costs 4, rankings 2 | "Job type", "Started by", "schedule". Include `workloads.*` labels |
| AK-11 | D7 | "AI Visibility" title case | 1 | navigation | `navigation.groups.ai` to "AI visibility". Also rename the headline number label to "AI visibility rate" in the Overview strings (find by key `aiOverview.numbers.*` and the hero title) |
| AK-12 | D11 | bare "AI Overview" | 21 | rankings 14, keywordDetail 6, workloads 1 | "Google AI Overview" in every label, filter, column and tooltip. The platform label in the `aiOverview.*` and `aiEngines.*` strings is checked by the guard, because those strings often take the name from data |
| AK-13 | D10 | interim test; "read" for a check | 13 | prompts 4, aiOverview 4, rankings 2 | "Provisional"; "checked" for "read" in the refresh dialog hints |
| AK-14 | D1 | Topic left over | 5 | rankings 3 (import), taxonomySettings 2 | Import field "Topic" to "Group"; `topicInvalid` to "A group path is at most 10 names..." (matches `groupPathInvalid`) |
| AK-15 | D15 | Group in Budgets and Schedules | 18 | projectSettings 12, budgets 6 | Budgets: "Scope and job type". Schedule selector mode "Groups and terms" to "Groups and tags" |
| AK-03 | D6 | named, naming, linked | 77 | aiOverview 48, prompts 13, citations 7, integrations 4 | "mentioned" and "cited". The integrations strings use "linked" for connected accounts: leave them. The four outcome labels become Mentioned and cited, Mentioned only, Cited only, Neither |
| AK-04 | D16 | own, owned | 41 | aiOverview 10, prompts 8, entitySettings 6, projectSettings 3 | "your brand", "your site", "your pages" in sentences, empty states and info texts; the real brand name in tables and legends. The role label "Own brand" in settings becomes "Your brand" |
| AK-08 | D12 | entity | 47 | entitySettings 36, citations 5, prompts 3 | "brand" and "alias". Page title "Entities and aliases" to "Brands and aliases". The Type values: see D12 |
| AK-01 | D3 | country | 28 | rankings 12, prompts 8, aiEngines 6 | "Location" for the field; "country" stays as the level word in help text, the picker placeholder and `common.location.placeholder`. Platform settings: "Countries of {engine}" to "Locations of {engine}", with the note "AI answers are collected at country level" |
| AK-02 | D4 | source | 81 | citations 34, aiOverview 33, prompts 8 | Section 4.4 |
| AK-09 | D8 | vocabulary, taxonomy, term, kind | 81 | taxonomySettings 53, rankings 12, projectSettings 11 | Section 4.5 |

The count of strings per rename overlaps: one string can sit in two lists. Edit each key once, for all renames, in the
wave order above.

### 3.1 Strings the key lists do not catch

- Strings built from a data value, not from `en.json`: platform names, domain types, intent labels, outcome labels,
  tag sets. The mock fixtures (`apps/web/src/mocks`, for example `entity-fixtures.ts` with a vocabulary named "Topics"
  and a location type "Country") hold some. Fixture names are visible in the mock server only; fix them so the tests
  and the demo agree, but they are not a release item.
- Export headers (`rankings.export.*`, citation export columns) share the strings above; check them by opening one
  export of each page after the wave.
- Email subjects and bodies (`auth.*`) use none of the renamed words; not in scope.
- The word "Overview" in `navigation.items.aiOverview` and `navigation.items.overview`: both stay "Overview"; the page
  title and breadcrumb take the group name. Check `navigation.inGroup = {group}: {item}` yields "AI visibility:
  Overview" and "SEO: Overview" (the key already exists).

## 4. Specific changes that need more than a text edit

### 4.1 Group (D1): nothing to rename in the real app

Keep the existing strings. Add the one-group rule in the prompt group picker: new string "A prompt is in one group, so
group numbers add up to the total." Under `prompts.add.topicPicker`. The keywords bulk dialog already says "Each
keyword leaves its other groups and joins the one you choose": leave it. The keys named `topic*` are code names; keep.

### 4.2 Platform (D2): nothing to rename in the real app

Check that the Settings page title is "Platforms" (`aiEngines.title`, already so) and that the setup step reads "Select AI
platforms" (`setupChecklist.engines.name`, already so). No visible "Engine" is left in `en.json`: the one hit in
`dataRetention` is "Search engine results pages", which is the correct Search engine use (P6). Rename the `aiEngines`
namespace only if someone wants to; it is a code name.

### 4.3 Location and Country (D3)

Besides the key list: the Keywords add dialog fields `rankings.add.countries*` and the AI add field `prompts.add.country*`
become "Location" and "Locations". The picker for the AI side lists countries only: the placeholder stays "Search
countries", with the helper "AI answers are collected at country level". `rankings.scope.country`,
`rankings.filters.country`, `rankings.columns.country` become "Location". The Keywords page today has both
`rankings.filters.country` ("Country") and `rankings.filters.location` ("Location"); after the rename two filters would
carry one label. Check in the component whether they filter different things (a country against a city) and either
merge them or name them "Location" and "City". Tests: the `rankings` and `prompts` filter tests assert both labels.

### 4.4 Sources fold into Citations (D4)

1. `navigation.items.sources` and the `sources` namespace (0 strings) are removed from the navigation list in the
   shell (the page has no content). The route, if it exists, redirects to Citations.
2. Citations tabs stay "Domains" and "Pages". Rename strings: "Third party sources" to "Third party domains" and
   "Competitor sources" to "Competitor domains" (`citations.views.*`); "Source share" to "Citation share"; the inspector type "Source" (`citations.inspectors.source.type`) to "Page";
   `citations.inspectors.domain.type` stays "Domain".
3. Category filter in Citations: `citations.table.category` and "Category n/a" become "Domain type".
4. Keywords: `rankings.filters.source` and `rankings.filters.sources.*` become "Added from", with the values By hand, CSV
   import, Paste, API, Search Console, Discovery (the current text "Added by hand" becomes "By hand").
5. Footnotes that name where a number comes from keep "Source: ...".
6. Test harnesses: `citations-lists-harness.tsx`, `rankings-harness.tsx`.

### 4.5 Tags page (D8, D19)

Rename in the Settings shell: page title "Taxonomy" to "Tags" (`settings.*` and `taxonomySettings.title`). Inside the
page: "Vocabulary" to "Tag set", "Term" to "Tag", "Kind" to "Type". Remove the kinds Topics and Clusters from
`taxonomySettings.kinds` and from the create dialog; rename "Markets" to "Segments"; keep Products, Services,
Campaigns, Personas, Tags (not a type: remove), Custom. This touches `entitiesCodec` kinds in
`src/mocks/entities-codec.ts` only if the API value changes; it does not, so only the visible labels change. Keep
the route and key names. Rankings import: "Vocabulary for tags" becomes "Tag set for
tags"; "Vocabulary for topics" and the field "Topic" go, because the import already has a "Group" column (decide with the
import design whether the two columns merge). Schedules: "Groups and terms" becomes "Groups
and tags" (AK-15).

### 4.6 Info texts (W6)

The real app has no card info texts yet: only `chart.info.about` and `chart.info.how` exist, and `aiov-info.js` in the
preview holds 27 cards, 9 measures and 9 competitor-drawer texts. The glossary writes all of them in `terms.md`
section 10, plus the new SEO ones.

1. Add one `info` namespace with `info.cards.<cardKey>.what` and `.how` for each card key (the registry keys:
   `ai.visibility_split`, `ai.rate_trend_by_engine`, ...), `info.measures.<key>.what` and `.how` for the measures, and
   `info.seo.<key>.what` and `.how` for Rank, Search volume, Keyword difficulty, CPC, SEO visibility and Average
   position.
2. Add the "i" button to the card toolbar and the tiles as the preview does (tooltip with both parts; a click opens a
   popover with two paragraphs; `infoText()` joins them for screen readers).
3. A test per card: the text is present and no figure other than the fixed rule numbers appears. A snapshot of the
   whole namespace keeps the texts from drifting.
4. D17 and D18 must be settled first; the texts in `terms.md` follow doc 16 for Share of voice and spec D4 for the group
   total.

## 5. Design preview changes

The preview is the source of truth for two screens, so these are edits to source, not to a copy. Do them in the main
checkout on `develop`, after the other session's uncommitted Prompts files are committed (`index.html`, `preview.css`,
`prompts-data.js`, `prompts.js`, `prompts-add.js`, `prompts-add-model.js` showed as modified or untracked on
2026-11-16). Do not touch the file names; `prompts-topics.js` stays (a code name).

Counts are occurrences of the word in the file, upper bounds: many are code (`window`, `Panel`) and are not edited.

| Rename | Files and occurrences |
|---|---|
| Engine to Platform | `index.html` 16, `prompts.js` 6, `prompts-extra-cells.js` 5, `prompts-topics.js` 2, `prompts-add.js` 1, `prompts-data.js` 1. Includes the select label "Engine", the filter "Engines", the column "Engine gap", the Settings table "Engines" |
| Topic to Group | `index.html` 17, `prompts-topics.js` 9, `prompts.js` 6, `prompts-topic-inspector.js` 5, `prompts-add.js` 5, `prompts-state.js` 2, and 1 each in `prompts-data.js`, `prompts-cells.js`, `kw-grouped.js`, `interactions.js`, `il-model.js`. Includes the tab "Topics" to "Groups", "Topic drawer", "Topic details", "Topics and prompts" to "Groups and prompts", the aria labels |
| Country to Location | `kw-grouped-model.js` 4, `perf-filters.js` 2, `prompts-add.js` 2, and 1 each in `kw-grouped-drawer.js`, `kw-grouped-menus.js`, `perf-detail.js`, `kw-grouped.js` |
| Source (keyword origin) to Added from | the Keywords filter in `kw-grouped-*.js` (find "Source") |
| Named to mentioned | `aiov-*.js`, `cit-data.js`, `prompts-*.js` (about 70 strings; `named` in code identifiers is left) |
| Entities to Brands | `index.html` 5 (settings), `aiov-data.js` 1, `prompts-inspector.js` 1, `prompts-topic-inspector.js` 1 |
| Taxonomy and vocabulary | `index.html` 2 |
| Insufficient and "Not enough" to one phrase | `aiov-cards-core.js` 10, `aiov-cards-more.js` 8, and a few others |
| Window to Period | only label strings, not the JavaScript `window` global |
| AI Overview to Google AI Overview | `prompts-data.js` 28 (platform name data), `index.html` 14, others |
| Info texts | rewrite `aiov-info.js` from `terms.md` section 10; add the SEO texts to the Keywords and Performance mocks |

The mock Prompts page also needs the one-group helper line in the add dialog (4.1).

## 6. Parity registers

The registers describe one preview state, row by row. Edit rows as follows. Rule 6 of `README.md` stays as written
(Platform, Group, Location, Prompts). Rule 2 says a real-app change that differs from the mock is a register change.

| Register | Rows that quote old words (word counts in the file) | Action |
|---|---|---|
| `prompts-page-parity.md` | Engine 43, Topic 82, Country 10, Platform 57, Group 54, Location 36 | The preview source text becomes the new wording (W7). Rows quoting the old text "Engine" or "Topic" are rewritten to the new text and marked `todo` again if the real app string changed |
| `overview-parity.md` | Platform 42, Group 36, Engine 3, Topic 5, Country 2, Location 7 | Same |
| Both | the strings of the cards' info texts | Each "i" row quotes the text from `terms.md`; its status stays `todo` until W6 |

Add a row per card for the "i" button where the register has none, and one row for each new glossary-driven string
(the primary group helper, the Not enough data tooltip).

## 7. Docs and process

- `docs/16-metrics-methodology.md` section 4 (group totals, D18) and section 5 (Share of voice, D17) are edited to match
  the owner's answers, in the same commit as the info texts.
- `docs/superpowers/specs/2026-11-16-ai-overview-redesign-design.md` D1 wording of the four outcomes (if D6 is accepted)
  and the "Not decided yet" list.
- `docs/superpowers/parity/README.md` rule 6: replace the last sentence of the "Terminology" decision with a link to
  `docs/glossary/terms.md` and state that the glossary replaces the provisional words.
- `AGENTS.md` under "Where things are": a row "Visible words | `docs/glossary/`: read before writing a string". Not done
  in this session because it is a shared file.
- Docs that use "engine", "topic", "observation" and "panel" as code or data-model words stay as they are. Add one line
  to `docs/glossary/README.md` (already there): code names do not follow the glossary.

## 8. Guard

A script `apps/web/scripts/check-glossary-words.mjs` (new in W1), wired into `pnpm lint`:

1. Read the banned words of `terms.md`. The source of truth is the "Banned" column, so the script parses the markdown
   tables of sections 1 to 8 and splits the column on commas.
2. Fail when a banned word appears, as a whole word and case insensitive, in a string of `messages/en.json` (ICU
   variables removed first), or in a string literal of `apps/web/design-preview/*.js` and `index.html` text nodes.
3. Allow a list of exceptions in `docs/glossary/guard-exceptions.json`, each with a reason: for example "Source" in
   "Source: Google Analytics", "linked" in the integrations strings, "window" in JavaScript identifiers.
4. Print the key and the term, not only a count.

A unit test feeds it three strings: one clean, one banned, one with a banned word inside an ICU variable (must pass).

## 9. Verification after each wave

- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build` in `apps/web`.
- The guard passes with the exceptions file.
- Open the preview route and the real app side by side for Overview and Prompts (parity README); no screen shows two
  words for one concept.
- Open one export of Keywords and one of Citations and read the column headers.
- Count again with `research/00-term-inventory.md` method; the banned words are at zero in `en.json`.

## 10. Risks

- Grammar breaks after a mechanical change ("a answer", "No window" to "No period" reads wrong). Edit by hand.
- A test that asserts the old text passes for the wrong reason if the string was not changed. Run the guard.
- The Prompts preview files are uncommitted in the main checkout and belong to another session. Do not start W7 until
  they are committed.
- D17 and D18 are facts about the backend, not words. Shipping info texts before they are settled prints a wrong
  definition in every language.
