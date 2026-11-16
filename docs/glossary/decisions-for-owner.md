# Decisions for the owner

Written 2026-11-16 by the glossary research session. Nothing here is applied.

**Decision record (2026-11-16):** the owner chose Group for D1 and asked the session to take its best decision on every
other open choice. Each recommendation below was therefore taken as the decision, except D17, D18 and D20, which are
facts or unspecified screens and stay open. The one list of results is `final-list.md`. The reasoning below is kept so
a later change is made with the same evidence in view. If the owner reverses any word, `terms.md` changes first (see
`README.md`). Added decisions made on the way: D12 Type values stay five and become Brand, Product, Company (was Organization), Person, Other; D19 as written;
the WP-61 page keeps the working name "Citation opportunities" until it is built.

How the glossary was made: an inventory of the real app, the design preview and the docs
(`research/00-term-inventory.md`); competitor and user-language research on 19 tools
(`research/02-competitor-research.md`); three independent proposals made without seeing each other: Opus
(`research/03-proposal-opus.md`), Fable (`research/04-proposal-fable.md`) and Codex
(`research/05-opinion-codex.md`). A fourth outside opinion through ChatGPT was planned and not obtained: the
permission check blocked typing into it, so nothing was sent.

Vote key: **O** Opus, **F** Fable, **C** Codex, **R** what the competitor research found, **B** the baseline in the real
app today (Platform, Group, Location, Prompts, as provisional words). The three models share a model family or a vendor
bias, so their agreement is a signal, not proof. R is the only outside evidence, and it is tool documentation, not user
interviews: no forum thread could be fetched.

Correction (2026-11-16, found while applying): the per-string counts in D3 to D21 came from a first pass that matched
capitalised words only, so they are 10 to 40 percent low. The corrected counts are in `application-plan.md` section 3.

Counts: "uses" and bare numbers are word occurrences in the visible text of `en.json` (ICU variables removed);
"strings" are `en.json` entries that contain the word, which is the number of edits. Both are on branch `port/real-app`
at commit `6ffe86e2`.

## Part 1. The five that matter most

These change how users read the product. They are listed first, in order of impact.

1. **D1 Group or Topic**, and one word for both keywords and prompts. **Decided: Group.**
2. **D3 Location or Country.**
3. **D4 What happens to "Source"**, and the Citations and Sources pages.
4. **D5 Rank or Position**, and what the AI order of a mention is called.
5. **D8 What the Settings "Taxonomy" page is called** (Tag set, Label set, Group set, Classification).

Before any information text ships you must also settle two facts, not words: **D17** (what Share of voice computes)
and **D18** (whether group numbers add up). If those are wrong, the info text is wrong in every language.

## Part 2. Confirm in one go

For these, no proposal chose a different word, and the baseline agrees or the baseline word is only replaced by a
glossary word that all three share. Say "confirmed" and they stay as written in `terms.md`. Where a proposal differed
on a detail of the same term (Query, Check), the detail is in D22, not here.

| # | Term | Proposed |
|---|---|---|
| D2 | Where prompts are asked | **Platform** (never Engine); **Search engine** on the keyword side; **Model** is the version inside a platform. Votes O F C B agree; R: platform, model and engine tie in the market. Cost to choose Engine: about 400 visible strings, 38 test files, 31 preview occurrences. |
| | Prompt and Keyword | Prompt on the AI side; Keyword on the SEO side. R: 13 of 14 AI tools say prompt. (The word for a Search Console query is in D22.) |
| | Mention, Citation | The two counting words. R: the market uses both the same way. |
| | Answer and Valid answer | Answer for one reply; Valid answer is the base of every rate; Failed answer is added. R: tools say "response" (5 of 14) or "answer", both fine; the app already says answer. |
| | Run | Run for a scheduled collection pass; "Read" is not used for a check. (How a rank reading is named is in D22.) |
| | Tag stays separate from Group | A tag has no tree and never adds up. R: the market splits topic (container) from tag (label). |
| | Competitor, Brand, Your brand | Brand replaces Entity in visible text (see D12 for the one open part). |
| | Tracked, Not tracked, Paused, Archived | Four states, one word each. |
| | Branded, Non-branded | Same on both sides. |
| | Panel is banned | Use Schedule, or "the prompts on this schedule" (see D15). |
| | Google AI Overview, Google AI Mode | Always written in full with Google. |
| | Mention position vs Rank | The two numbers never share a word on screen (see D5 for the SEO word). |
| | Recommendation rate | Kept. Note: no tool in the research uses "recommendation" as a metric label, so users have no habit for it. |
| | Workspace and Project | Project is one brand and its site; Client is never a level. |

## Part 3. The decisions

### D1. Group or Topic, and one word for keywords and prompts

The owner's own example. Today: Keywords says Group, the Prompts mock says Topic, and the real app says Group on both.

| Option | What users see | For | Against |
|---|---|---|---|
| **A. Group on both sides** (recommended) | "Groups" tab, "Group" column and filter on Prompts and Keywords; Subgroup; the Overview select "Group" | One word to learn. Real app already has it 257 times (Topic 5). Keywords already has the group tree manager. Fits what agencies file: products, services and campaigns, not only subjects. Cost to move the preview Prompts mock: 49 Topic occurrences in 11 files and about 82 mentions in the Prompts parity register | The market says Topic. R: Topic is the container word in about 10 of 14 AI tools (Profound, Peec, AthenaHQ, Scrunch, SE Visible, Semrush, Sistrix, Similarweb, Goodie, Writesonic); "prompt group" only at Rankscale. A user arriving from Peec looks for Topics |
| B. Topic on both sides | "Topics" everywhere | Matches the AI market and the owner requirements R-09. "Topic" suits prompts well | A keyword group such as "Brand terms" or "Competitor terms" is not a topic. Moves 257 visible strings, 44 and 35 test files, 9 and 9 end-to-end files, and the Keywords preview |
| C. Topic on Prompts, Group on Keywords | Today's conflict | Matches the market for AI and for SEO tools (SE Ranking says groups) | The owner's complaint: two words for one idea, and "SEO against AI per group" (spec D4) needs one word |

Votes: O A, F A, C A, R leans B, B A.

Two things the word does not fix, so read before choosing:

1. **Different rules.** A keyword may be in several groups; a prompt is in exactly one (its primary group) so group
   numbers add up. The word is the same, the rule is stated where it matters: in the prompt group picker ("A prompt is in
   one group, so group numbers add up to the total").
2. **Two stores in the backend today.** Keyword groups live in `seo.keyword_groups` (many per keyword, a tree). Prompt
   groups are terms of the `topic` taxonomy vocabulary. The Settings page edits the second kind and the Keywords page
   the first. One visible word over two stores is fine as long as no screen mixes them. If you want one group list for
   both sides (spec D4 says "Keywords share the same groups"), the backend must unify them; that is not a glossary
   change.

Recommendation: **A**. The strongest argument for B is the market, and the cost of B is large for a gain that only
users who come from another tool feel. Revisit if onboarding interviews show users hunting for "Topics".

**DECIDED 2026-11-16 by the owner: Group (option A).** Group is the one word for keywords and prompts, with Subgroup,
and Tag stays separate. The real app needs no rename for it; the design preview Prompts mock changes from Topic to
Group (`application-plan.md` section 5). Open dependency, not a word: whether the backend unifies keyword groups and
prompt groups into one list (spec D4).

### D3. Location or Country

Today: Keywords says Country (add dialog, filter, column) and Location (settings, import, row name). Prompts says
Location in the column and top bar, Country in the add dialog and platform settings.

| Option | Label | For | Against |
|---|---|---|---|
| **A. Location on both sides** (recommended) | "Location: Germany"; "Country" and "City" only as the level words in help text and in the picker placeholder; "All locations" | One filter name across the project. True for countries and cities, and keywords can already be a city. O F agree. R: Location is used by Semrush, Ahrefs, Peec, AthenaHQ | On AI screens every value is a country today, so "Location" promises cities that cannot be picked (C's point). Fix: the AI picker lists countries only and says "AI answers are collected at country level" |
| B. Country where only countries exist (AI), Location on SEO | Two labels | Exact on each side (C) | Two names for one filter: a setting made on one page seems not to carry over to the next |
| C. Country everywhere | | Simple today | Wrong once cities are used, and they are on Keywords already |

Votes: O A, F A, C B, R tie, B mixed. Cost of A: 28 `en.json` strings say Country (rankings 12, prompts 8, platform
settings 6, two others; list in `application-keys/AK-01-country-to-location.tsv`) and 12 preview occurrences in 7
files; Location is already in 50 places.

Recommendation: **A**, with the country-only helper on AI screens. Region and Market are not used as labels.

### D4. "Source", and the Citations and Sources pages

The word has three meanings today: the website an answer cites ("Source share", "Third party sources", nav "Sources"),
how a keyword was added (the Keywords filter "Source"), and in the market the pages an AI read but did not cite.

| Option | What users see | For | Against |
|---|---|---|---|
| **A. Source leaves the AI side** (recommended) | Page "Citations" with tabs Domains and Pages; "Cited domain" and "Cited page"; "Citation share"; the keyword filter becomes "Added from"; "Source" survives only in "Source: Google Analytics" footnotes. The planned WP-61 page gets a name for its job (working name "Citation opportunities") | One word, one meaning. Keeps "Source" free for the "retrieved but not cited" metric (doc 16 C8, ChatGPT only) if it ships. `en.json` strings to review: 81 (citations 34, aiOverview 33, prompts 8, three others), listed in `application-keys/AK-02-source-leaves-ai-side.tsv` | R: "Sources" is the nav word at Peec, Semrush, AthenaHQ, SE Visible and Sistrix; users of those tools expect it. Citation beats source only by a small margin (8 tools to 5). The Sources page is not a duplicate of Citations (see below), so it needs its own name and that name is not decided |
| B. Keep "Sources" as the name of the opportunities page, and rename only the keyword origin | Pages "Citations" and "Sources"; Source means "a website you could be cited on" | Matches Peec, Semrush, SE Visible. Only 8 keyword strings and the cited-website strings (AK-02) change where they say "source" for a citation | "Source" stays vague between "pages used" and "pages cited", and the Overview cards already say "source" for cited domains |
| C. Keep both as today | | Zero cost | The ambiguity the owner is trying to remove |

What the Sources page is: the route `/ai/sources` exists as a placeholder that shows the 404 page until work package
WP-61 builds it (`src/app/[workspace]/[project]/ai/sources/page.tsx`, `lib/navigation/registry.ts`). WP-61 is not
Citations again: its goal is "Publishers, Categories, Opportunities", the category override dialog, and source gap and
overlap views on Competitors (`docs/ai-visibility/work-packages/WP-61-sources-page.md`). So the three models' advice
"fold Sources into Citations" does not fit; what they agree on is only that the word "Source" should not name cited
websites. Under A the nav item and the page title are renamed for the job, and the owner names it when WP-61 starts.

Votes on the word "Source" leaving the AI side: O yes, F yes, C yes, R split (Peec, Semrush, AthenaHQ, SE Visible and
Sistrix use Sources; Profound, Otterly, Ahrefs, Scrunch, Rankscale, Goodie, Writesonic and Similarweb use Citations), B
no. On the names that replace it the proposals differ, see D22: tab names Websites (O), Domains and Pages (F), Cited
sites and Cited pages (C). "Added from" (O, C) was chosen over "Added by" (F) because "by" reads as a person.

Recommendation: **A**.

### D5. Rank or Position, and the AI order of a mention

Today: Keywords says Rank (123 visible strings), Position is 11. The AI card says "position distribution". The metrics
doc (doc 09) calls organic rank canonical.

| Option | Google number | AI number | For | Against |
|---|---|---|---|---|
| **A. Rank and Mention position** (recommended) | Rank, Best rank, Top 3 | Mention position, never bare "Position" | Two scales, two words: a client cannot read "2" in an AI report as a Google result. Lowest cost: the app already says Rank. Doc 09 canonical term. Search Console data keeps Google's own label "Average position" | R: Google, Semrush and Ahrefs say Position; users from them search for it. O only |
| B. Position and Mention position | Position, Best position | Mention position | Matches Search Console and the SEO tools (F, and C for compact headers) | Moves about 123 strings and "Top 3" wording. Both numbers contain the word "position", so someone will shorten Mention position to Position in a narrow column |
| C. Position for both | | | Matches the market (Profound, Peec, Semrush AI all say Position for the AI order) | The conflation the owner wants to avoid |

Votes: O A, F B, C B (compact), R Position, B A.

Recommendation: **A**. The vote is 2 to 1 against, but the two for B did not weigh the cost, and "rank tracking" is the
name of the product category. If you choose B, the rule that "Mention position" is never shortened still holds.

### D6. Mention and cite as the only two verbs, and the four outcomes

Today prose says "named" and "linked" (77 `en.json` strings, plus the owner-approved bar labels "named and linked,
named only, cited only, neither" in spec D1) while the metric names say "Mention rate" and "Citation rate". The same
card can say "named" in the sentence and "mentions" in the title.

| Option | Outcome labels | For | Against |
|---|---|---|---|
| **A. Mention and cite** (recommended) | Mentioned and cited, Mentioned only, Cited only, Neither | Sentence, label and metric use one verb. O F C agree on the verbs. Market uses mention and citation | Changes 77 strings and the wording you approved in spec D1. "Named" is plainer for clients (O's own doubt) |
| B. Named and linked in prose, Mention and Citation as metric names | As spec D1 | No change to approved wording | The mismatch stays. "Linked" is wrong for a citation that is listed and not clickable |

Votes: O A, F A, C A, R market uses mention, B B.

Recommendation: **A**.

### D7. "AI visibility": area name, number name and casing

Today the navigation group is "AI Visibility" and the headline number is also "AI Visibility". Doc 16 registry key is
`ai.visibility_rate`. R: "visibility" is defined three different ways across tools (percent of responses, a
position-weighted score, a composite index), so the name carries no shared meaning in the market.

| Option | Area | Number | For | Against |
|---|---|---|---|---|
| **A. Area "AI visibility", number "AI visibility rate"** (recommended) | sentence case | ends in "rate" like Mention rate and Citation rate | The area and the number no longer share a label. Matches the registry key. F | A longer card title. Spec D1 says "AI Visibility is a plain rate" |
| B. Area and number both "AI visibility" | | Shortest; O | Same words for two things |
| C. Both "AI Visibility", title case | | Today; C | Two casings of the same words in one app |

Votes: O B, F A, C C, B C. Cost of A: 8 strings and the Overview hero. Recommendation: **A**.

### D8. What the Settings "Taxonomy" page is called

The page edits "vocabularies" of "terms" with a "kind" (Topics, Clusters, Products, Services, Markets, Campaigns,
Personas, Tags, Custom). The Keywords page already shows these terms as tags (`Persona: Enterprise`). The nouns
"taxonomy", "vocabulary", "term" and "kind" are librarian words; "term" also means "keyword" to SEO users and Termin
(appointment) in German.

| Option | Page, set, value | For | Against |
|---|---|---|---|
| **A. Tags: Tag set / Tag** (recommended, mine) | Settings "Tags"; "Tag set" (Products, Personas...); "Tag" (Enterprise) | Names the page after what the Keywords page already shows. Tag is a known word. R: tags are the standard label in the market | A set that takes one value behaves like a field, not a free tag |
| B. Label set / Label (O) | Settings "Labels" | Neutral | Close to "tag"; Tags appear separately and users will ask why |
| C. Group set / Group (F) | Settings "Groups and tags" | Everything is a group | Breaks "a prompt is in one group" because a Persona is not the group |
| D. Classification / Value (C) | Settings "Classification" | Plain, formal | "Value" is vague; sounds like admin software |
| E. Keep Taxonomy, Vocabulary, Term | | Zero cost | The librarian words above |

Votes: O B, F C, C D, R none use taxonomy, B E. Three models gave three different answers, so this one is open.
Cost of any rename: taxonomySettings 116 strings, rankings import 10, schedules 8.

Recommendation: **A**. The word "Topic" disappears as a kind (it is the Group), and Cluster is dropped (see D19).

### D9. Empty states

Today the app shows "Insufficient data" and its variants "too few" and "not enough" (34 strings), "n/a" (18 strings), the hatched
cell, and "not collected yet". Three different causes need three different texts.

| Option | Texts | For | Against |
|---|---|---|---|
| **A. Not enough data / Not collected yet / n/a with a tooltip** (recommended) | Three states | Each cause has a name. n/a only in table cells, always with a tooltip that spells out the reason. F | n/a does not translate |
| B. Same, and ban n/a (O) | Two states plus "Not available" spelled out | Translates | A spelled-out cell is wide |
| C. Insufficient data, Not applicable, Not collected yet (C) | | The established analytics words | Longer, heavier words |

Votes: O B, F A, C C, B mixed. Recommendation: **A**.

### D10. "Detectable change"

| Option | For | Against |
|---|---|---|
| **A. Detectable change** (recommended) | Already in the app (11 strings, doc 17). Says only what the test says. F C | Statistics jargon; needs the plain gloss in the info text |
| B. Clear change (O) | Plain | "Clear" reads as "large or important" |

"Interim test" becomes "Provisional" (F), with "Early estimate" (O) as the alternative. Votes: O B, F A, C A, B A.
Recommendation: **A** with the gloss "It says the change is likely real, not that it is large or important."

### D11. The page called "Overview", and "Google AI Overview"

Both the SEO home and the AI home are "Overview"; Google's feature is "AI Overview"; the AI home page and the feature
sit side by side in the AI area. R: "Overview" is the home page name at 6 of 14 tools.

| Option | For | Against |
|---|---|---|
| **A. Keep "Overview", titles read "SEO overview" and "AI visibility overview", and the feature is always "Google AI Overview"** (recommended) | Users expect Overview. The prefix removes the clash. O F C all land here | One missing "Google" brings the clash back, so the word-check script must catch bare "AI Overview" |
| B. Rename the AI home page "Summary" | Impossible to clash | An unusual home page name |

Note from C, to settle with the backend: Google AI Overview is read from rank checks, not asked as a prompt. It stays a
platform in the AI screens with the note "read from rank checks". Recommendation: **A**.

### D12. Brand, Entity, Watched brand, Alias

R: "competitors" everywhere; "entity" at Ahrefs and Sistrix only. The real app's settings page is "Entities and
aliases" and its Type field has Brand, Product, Organization, Person and Other.

Recommendation: **Brand** for everything the app looks for in answers; **Competitor**, **Watched brand**, **Alias**;
settings page "Brands and aliases". O wrote "Brands and names", F and C "Brands and aliases". Open part: a Person is not
a brand. Either drop Person from the visible Type list, or rename the values Company, Product, Person, Other. Votes:
O F C Brand, R entity is rare, B Entity (47 strings).

### D13. Fan-out query or fan-out search

| Option | For | Against |
|---|---|---|
| **A. Fan-out query** (recommended, always two words, with the gloss "searches the platform runs to build its answer") | "Query fan-out" is Google's published term and Profound and Peec use it (R). F C. Already in the app | Query also names Search Console queries; the qualifier "fan-out" keeps them apart |
| B. Fan-out search (O) | Plainer | Nobody else says it |

Recommendation: **A**.

### D14. SERP: keep the word or spell it out

| Option | For | Against |
|---|---|---|
| **A. Keep SERP in two labels, "SERP feature" and "SERP snapshot", glossed once** (recommended) | Zero change cost (11 strings already say it). The Keywords users are SEO managers, and Ahrefs and Semrush use "SERP features" (R) | Clients may not know it |
| B. Search feature and Results page snapshot (O F) | Plain | Changes 11 strings and loses a word every SEO tool uses |

Votes: O B, F B (SERP allowed in dense headers), C A (SERP snapshot), B A. This is the one place I overrode the plain
word, because the cost is zero and the audience reads it daily. Reverse if clients read the Keywords page.

### D15. Small words in Runs, Costs and Budgets

| Word today | Proposed | Why | Cost |
|---|---|---|---|
| Panel (3 uses) | **Schedule**, or "the prompts on this schedule". C suggested "Prompt set" | "Panel" is a survey word | with Workload and Trigger, 13 strings in total (`AK-10`) |
| Workload (14 uses) | **Job type** | "Workload" translates as amount of work; Budgets uses "group" for it, a second meaning of Group (6 more strings, `AK-15`) | see above, plus tests |
| Trigger (3) | **Started by** | Plain | 3 strings |
| Window (191 uses) | **Period** (see D21) | One word for a date range | 162 strings, mechanical (`AK-07`) |

Votes on Job type and Started by: O F agree, C silent. Low user impact; skip if the test cost matters.

### D16. "Your brand" for agencies

The brand is the client's, not the account manager's. Exported reports reach the client's boss, and "your" speaks to the
wrong person.

Recommendation: **"your brand" and "your site" only in sentences, empty states and info texts that address the person
using the app. Tables, legends, exports and reports show the real brand name.** F raised it; O and C used "Your brand"
without the exception. B uses "own brand", "own domain", "owned pages" (about 60 strings) which are banned in the
glossary.

### D17. Share of voice: what does the app compute (settle before info texts ship)

The preview info text says "Your mentions divided by all mentions of you and the tracked competitors" (a count share;
C also wrote it). `docs/16-metrics-methodology.md` section 5 defines something else: inside each answer, the brands
mentioned share it equally (`1 / number of brands mentioned`), then your share is averaged over the answers that
mention at least one tracked brand. The doc lists the count share only as an export metric `ai.mention_count_share`.
The glossary text follows the doc. **Decision needed:** which one does the backend compute and which one do you want on
screen? If the count share, change doc 16 and the text; if the doc, change the preview text (the application plan does).

### D18. Do group numbers add up (settle before info texts ship)

Spec D4 and the heat map text say every prompt has one primary group, so groups add up to the total. Doc 16 section 4
still says "a prompt in two topics counts in both; topic values do not sum to the total". Needs the doc updated to D4,
or the heat map info text is false. The glossary text follows D4 and names the term "Primary group" in the add dialog.

### D19. Tag set types

Today's kinds: Topics, Clusters, Products, Services, Markets, Campaigns, Personas, Tags, Custom. Recommendation: drop
**Topic** (it is the Group) and **Cluster** (no screen uses it), rename **Market** to **Segment** (a market is a place
to most users and collides with Location; F), keep Product, Service, Campaign, Persona, Custom. Tags is the page, not a
type.

### D20. Matrix and Discover

Both are navigation items with no strings and no spec read for this work. Name them before the pass. Matrix is not a
plain word (it presumably shows SEO against AI per keyword, doc 15 "cross-channel quadrant"); Discover is a Google
product name too (Google Discover). Suggest a descriptive pair such as "SEO against AI" and "Find prompts" once their
screens exist. Not decided here.

### D21. "Period" or "Window"

The app says "Date window" (the control), "window" (191 uses in 162 strings) and "period" (57 uses) for the same thing, and "28
days" as the default. Recommendation: **Period** (F), because "window" reads as a browser window and "Compare with
previous period" already uses it. Cost: 162 strings, all in `en.json`, mechanical.

### D22. Smaller splits between the proposals

Low user impact each. The recommendation is what `terms.md` uses; reverse any of them without touching the others.

| Term | Opus | Fable | Codex | Recommendation and reason |
|---|---|---|---|---|
| A reading of a keyword rank (U9) | Check, "Check now" | Check, "Check now" | "Rank check" for the reading, "Run now" for the action; bans bare Check | **Check** and "Check now". The Keywords page has 154 uses and no one is confused there; "Run now" would make a rank check sound like an AI run. Codex's point stands if the Runs page ever lists both kinds: then say "Rank check" there |
| A Search Console query (U3) | Query | Query | "Search query" | **Query**, on Pages and performance only, because Search Console shows "Queries". Use "Search Console query" in prose if it sits next to fan-out queries |
| The compare control (P15) | Compare with, Previous period | Compare with, Previous period | "Comparison period"; bans Compare with | **Compare with** (a control starts with a verb); the value is "Previous period" |
| Abbreviations SOV and KD (M5, M13, section 9) | Banned (do not translate) | Allowed in narrow column headers | Keep the full term outside narrow headers (allows in headers) | **Allowed in a narrow column header only**, tooltip carries the full term. The app uses both today. Opus's translation worry is real; translators may spell them out |
| The kind of cited website (C8) | "Category" | "Domain type" | "Source type" | **Domain type**: it matches the Domains tab and avoids both Category (vague) and Source (banned). Fable's word |
| Tab names on Citations (E3, E4) | Websites, Pages | Domains, Pages | Cited sites, Cited pages | **Domains** and **Pages** (existing, SEO users know "domain"). Opus and Codex chose plainer words for clients who do not say "domain" |
| Client (B12) | Allowed only in examples | Never a level | A real term: an agency's customer, which may own several projects | **Not a product level**. Codex's version needs a client level above Project, which the product does not have. Revisit if agencies ask |
| Snapshot of the Google page (U12) | Results page snapshot | Results page snapshot | SERP snapshot | **SERP snapshot** (see D14) |
| The thing a schedule starts (U10) | Schedule | Schedule | "Prompt set" | **Schedule** (see D15) |

## Part 4. What the models disagreed on, in one table

| Choice | O | F | C | R | Recommendation |
|---|---|---|---|---|---|
| Group or Topic | Group | Group | Group | Topic | Group (D1) |
| Location or Country | Location | Location | Country on AI | tie | Location (D3) |
| "Source" names cited websites | no | no | no | split | no; name the WP-61 page for its job (D4) |
| Rank or Position | Rank | Position | Position | Position | Rank (D5) |
| Taxonomy page | Labels | Group sets | Classification | none say taxonomy | Tag sets (D8) |
| Detectable change | Clear change | Detectable | Detectable | | Detectable (D10) |
| Empty states | no n/a | n/a allowed | n/a allowed | | n/a in cells (D9) |
| Fan-out | search | query | query | query | query (D13) |
| Snapshot | Results page | Results page | SERP | | SERP (D14) |
| Panel | Schedule | Schedule | Prompt set | | Schedule (D15) |
| Added from or by | from | by | from | | from (D4) |
| AI visibility casing | sentence | sentence, plus "rate" | title case | | sentence, plus "rate" (D7) |
| Rank reading | Check | Check | Rank check, Run now | | Check (D22) |
| Search Console query | Query | Query | Search query | | Query (D22) |
| Compare control | Compare with | Compare with | Comparison period | | Compare with (D22) |
| SOV and KD | banned | allowed in headers | allowed in headers | | allowed in headers (D22) |
| Cited website kind | Category | Domain type | Source type | | Domain type (D22) |
| Citations tabs | Websites, Pages | Domains, Pages | Cited sites, Cited pages | | Domains, Pages (D22) |
| Client | examples only | never a level | a real term | | not a level (D22) |

## Part 5. Limits of this work

- No end user was asked. R is tool documentation and a few surveys; it has no forum threads (Reddit blocked the fetch
  tool). The terms for the five biggest choices should be tested with five target users before launch.
- Translation notes are judgement, not checked by native speakers. Citation (French and German "quotation") and
  Location (French "emplacement") need a native check.
- The ChatGPT opinion was not obtained.
- Moz, Goodie, Writesonic, Similarweb and SE Ranking Rank Tracker were only partly verified in the research.
