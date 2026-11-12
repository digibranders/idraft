# AI prompt tracking fixtures

`eventus-security.json` defines, once, a complete AI prompt tracking data set for an illustrative project called
Eventus Security. Two consumers read it:

1. The web mock API (`apps/web/src/mocks`), which generates 92 days of answers from it. The mocks validate the file
   with a zod schema when they load it (`apps/web/src/mocks/ai-prompt-definition.ts`).
2. The backend session, which can use it to seed the real development database: the project, the brand and
   competitors, the topics, the prompts and the engines.

Everything in the file is invented test data. The companies, their domains, the pages and the claims in the answer
sentences are fiction. Public bodies (a central bank, a national CERT, a standards body) appear only as generic
sources with generic page titles. Nothing in the file describes a real company.

## Top level

| Key | Meaning |
|---|---|
| `schema_version` | Always `1`. |
| `note` | A reminder that the data is fiction. |
| `project` | `name`, `slug`, `host`, `language_code` (`en`), `default_country` (`IN`), `timezone` (`Asia/Kolkata`). |
| `brand` | The own entity: `key`, `name`, `aliases` (the names an answer may use), `domains` (hosts that count as the own domain). |
| `competitors` | 8 entities. Each has `key`, `name`, `aliases`, `domains`, and optionally `ambiguous` plus `disambiguation_hints` (a name that is also a common word, so some of its matches are uncertain). |
| `engines` | The enabled engines: `engine_code` (`chatgpt_web`, `gemini_web`), the `countries` they run in (ISO 3166 alpha 2: `IN`, `AE`, `SA`) and the `model` they report. |
| `model_change` | One engine model change inside the history: `engine_code`, the new `model`, the `effective_date` (UTC date) and `mention_delta`, which shifts every own mention probability of that engine from that date on. |
| `topics` | The topic vocabulary, two levels: 7 parents, each with 3 or 4 `children`. Every node has a `slug` (unique across the tree) and a `name`. |
| `sources` | The domains an answer may cite: `key`, `host`, `name`, `role`, `category` and `pages` (`path`, `title`). |
| `competitor_pages` | The pages a cited competitor domain has. `{name}` in a title stands for the competitor's name. |
| `phrases` | The sentences answers are built from (see below). |
| `prompts` | 72 prompts, each with a visibility profile per engine. |

## Sources

`role` is `own`, `competitor` or `third_party`, as the API's citation `domain_role` is. There is exactly one `own`
source, `key` `own`, whose host is the brand's domain. Its pages carry a `topic` (a parent topic slug, or `null`) so
an answer cites the page that fits the prompt. A competitor domain is not listed here: a profile names it by the
competitor's `key`, and its pages are `competitor_pages`.

`category` is a label for the kind of site, for readers of the data and for the seeding session. It is one of
`own`, `analyst`, `news`, `review`, `forum`, `government`, `standards`, `reference`. The API has no such field on a
citation; it classifies domains separately.

## Prompts

| Key | Meaning |
|---|---|
| `key` | A stable id, `p01` to `p72`. |
| `text` | The prompt, English only. Unique in the file. |
| `country` | `IN`, `AE` or `SA`. It must be one of the countries of every enabled engine. |
| `intent` | `informational`, `commercial`, `navigational`, `transactional`, `local` or `unknown`. |
| `funnel_stage` | `tofu`, `mofu`, `bofu`, `retention` or `unknown`. |
| `prompt_type` | `question`, `comparison`, `recommendation`, `how_to`, `definition`, `local`, `transactional` or `other`. |
| `importance` | 1 to 5. |
| `branded` | `true` when the text names the brand. The summary leaves branded prompts out unless asked. |
| `topics` | One or two topic slugs. They may be children or parents. |
| `profile` | One entry per enabled engine code, described next. |

### Visibility profile

Each `profile` entry drives how that engine answers that prompt on every run day. All numbers are probabilities from
0 to 1 unless noted.

| Key | Meaning |
|---|---|
| `mention` | The chance an answer names the brand. |
| `cite` | The chance an answer cites a page of the brand's own domain. |
| `order` | The typical place of the brand among the named entities (1 is first). A run moves it by at most one place. |
| `competitors` | Pairs of `[competitor key, chance]`: which competitors the answer tends to name. |
| `sources` | Pairs of `[source key, chance]`: which other domains the answer tends to cite. The key is a `sources` key or a competitor key. |

The profiles give a spread on purpose: a few prompts the brand wins (mention 0.75 or more), many partial ones, a tail
where it is nearly absent (mention 0.12 or less) and two prompts where the engines disagree (`p14` and `p10`).

## Phrases

`intro` is chosen by prompt type and `outro` by funnel stage. `own` and `competitor` are lists of sentence templates
with one `{name}` placeholder, which an answer fills with the brand or competitor name or one of its aliases.
`repeat_own` is an optional second sentence naming the brand. `inline` is the sentence that quotes a cited address
(`{url}`), and `cut_off` ends an answer the provider cut short.

## What the mocks generate from it

Monday and Thursday at 02:00 UTC, for the last 92 days, every prompt on every engine gets one answer, chosen by a
hash of the prompt, the engine and the day, so the same request always gives the same answer. About 3 percent of
answers are not valid (a provider error, an unreadable answer, a refusal or an empty answer), about 2 percent are
cut off but still count, and a few mentions are uncertain matches. Offsets in the mocks are UTF-16 units.

## Seeding the backend

A consumer that wants only the static parts needs `project`, `brand`, `competitors`, `engines`, `topics` and
`prompts[].{text, country, intent, funnel_stage, prompt_type, importance, topics}`. The profiles, `sources`,
`phrases` and `model_change` exist only to make answers for the mocks.
