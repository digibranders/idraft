# 03. Typography

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Implementation: composite `type-*` utilities and `num` in [`globals.css`](../../apps/web/src/styles/globals.css)

## 1. Typefaces

| Family | Use | Loading |
|---|---|---|
| **Geist Sans** | All interface text: labels, table cells, numbers, headings, buttons | The `geist` npm package through `next/font/local` (variable font, weight axis 100 to 900; we use 400, 500, 600), `display: swap`, CSS variable `--font-geist-sans`. Not `next/font/google`: its Geist subset drops OpenType features beyond `tnum` (verified 2026-09-29, `research/09-frontend-stack.md`) |
| **Geist Mono** | URLs and domains in tables, IDs, API keys, tokens, provider task ids, raw queries and payloads, code, hashes, cron expressions, CSS/JSON snippets | Same, variable `--font-geist-mono`, weights 400 and 500 |

Geist Mono is **not** used for ordinary numbers or other table content. Tabular alignment comes from Geist Sans tabular figures (section 4), which keeps numbers readable and the table typographically uniform.

Weights: **400** (regular text and labels), **500** (badges, emphasized values, button labels, active navigation and tabs), **600** (titles and metric values). Weight 700 and above is not used; bold paragraphs are not used.

## 2. Type scale

Every text element uses exactly one composite utility. Composites set size, line height, weight and letter spacing together, so they cannot drift apart. There are 15 composites, and one more for a single case: `type-input-touch` (16 / 24 px, 400) is the text of fields and one-time code cells below 768 px, so iOS Safari does not zoom the page on focus ([19-responsive-behavior.md](19-responsive-behavior.md) section 10). The base body size is 14 px (`body` in `globals.css` is 14 / 20). Table cells stay at 13 / 20 (`type-table`) so dense tables keep their column capacity. Values follow [reference/visual-spec.md](reference/visual-spec.md) section 3.

| Utility | Size / line height | Weight | Tracking | Default color | Use |
|---|---|---|---|---|---|
| `type-page-title` | 24 / 32 px | 600 | -0.015em | `foreground` | One per page, in the page header ("Rankings", "Prompts") |
| `type-inspector-title` | 18 / 26 px | 600 | -0.01em | `foreground` | Inspector titles and right-column titles ("best crm for startups", "Alert rules") |
| `type-section-title` | 16 / 24 px | 600 | -0.005em | `foreground` | Panel titles ("Topics", "Ranking history", "AI answers") |
| `type-subsection-title` | 14 / 20 px | 600 | 0 | `foreground` | Section titles inside panels and inspectors ("Position history (90 days)", "Sources"), day headers in the change feed ("Today"), rule titles, the project switcher name in the sidebar, the chart tooltip date |
| `type-body` | 14 / 20 px | 400 | 0 | inherits | Default UI text: sidebar labels, buttons, inputs, tabs, menu items, form values |
| `type-body-strong` | 14 / 20 px | 500 | 0 | inherits | Button labels, active tab, active nav item, emphasized inline values, entity names in feeds |
| `type-inline-strong` | inherits | 500 | inherits | inherits | A span inside running text that must keep the size and line height of its text: the own brand's mention highlight in answers ([23-application-patterns.md](23-application-patterns.md) section 5.3) |
| `type-prose` | 14 / 22 px | 400 | 0 | inherits | AI answer text in inspectors, methodology text, help articles, empty-state explanations longer than two lines |
| `type-table` | 13 / 20 px | 400 | 0 | inherits | Table body cells |
| `type-meta` | 13 / 20 px | 400 | 0 | `foreground-tertiary` | Meta line under titles, timestamps ("6h ago"), metric strip labels, descriptions, helper text, values after bar-list bars |
| `type-label` | 12 / 16 px | 400 | 0 | `foreground-tertiary` | Table header text, key-value labels, legends, axis labels, sidebar group labels, form field labels |
| `type-micro` | 12 / 16 px | 500 | 0 | inherits | Badges (22 px) and count badges. Filter chips use `type-body` ([13-filters-search.md](13-filters-search.md) section 2); keyboard hints use `type-kbd` |
| `type-metric` | 24 / 32 px | 600 | -0.02em | `foreground` | Metric strip values, tabular |
| `type-metric-sm` | 18 / 24 px | 600 | -0.01em | `foreground` | Inspector key-value grid values, tabular |
| `type-mono` | 13 / 20 px | 400 | 0 | inherits | Geist Mono values: URLs and domains in tables, IDs, code |
| `type-kbd` | 11 / 16 px | 500 | 0 | inherits | Keyboard shortcut glyphs ("⌘K"), in Geist Sans |

Two sizes on the reference screens fall between utilities and are mapped to one: the project name in the sidebar switcher (about 15 px on the screens) and the chart tooltip date (13 px on the screens) both use `type-subsection-title` (14 / 20 px, 600), which is within the 2 px tolerance and keeps the scale at 15 utilities ([reference/visual-spec.md](reference/visual-spec.md) section 6; [11-navigation.md](11-navigation.md) section 2, [15-data-visualization.md](15-data-visualization.md) section 10). Percentage labels inside 100% stacked bars are 12 px, white or `foreground` by contrast ([15-data-visualization.md](15-data-visualization.md) section 5.2).

Rules:
- Nothing is smaller than 12 px, except the 11 px keyboard hint (`type-kbd`). Nothing in the application shell is larger than 24 px.
- Heading levels are semantic (`h1` for the page title, `h2` for sections, `h3` for panels) independent of the visual utility. Every page has exactly one `h1`.
- Uppercase text is not used for labels, headers or badges. Sentence case everywhere ([22-content-formatting.md](22-content-formatting.md) section 1).
- Letter spacing is never set outside the composites.
- Line length for prose is capped at 720 px (`max-w-reading`). Analytics content is not width-capped.

## 3. Text color hierarchy

| Step | Token | Use |
|---|---|---|
| 1 | `foreground` | Values, primary text, titles, the thing the user came to read |
| 2 | `foreground-secondary` | Navigation labels, secondary columns, secondary values |
| 3 | `foreground-tertiary` | Meta lines, timestamps, labels, table header text, axis labels, placeholders, units, "n of m" |
| (non-text) | `foreground-muted` | Icons that sit next to text, separators; never for text |
| disabled | `foreground-disabled` | Disabled controls only |

Within a table row, the identity column (keyword, prompt, domain) uses `foreground`, value columns use `foreground`, and context columns (updated time, source) use `foreground-tertiary`. In a selected row the identity text switches to `primary-text`. The active navigation item and the active tab use `primary-text` weight 500.

## 4. Numbers

1. **Tabular figures everywhere numbers are compared**: table numeric cells, metric values, deltas, ranks, percentages, currency, counts, axis labels, timestamps in tables. Apply the `num` utility (sets `font-variant-numeric: tabular-nums` and `tnum`). `type-metric` and `type-metric-sm` include it.
2. **Right-align numeric columns** so digits line up; left-align text; center nothing except the checkbox column ([12-tables.md](12-tables.md) section 4).
3. Proportional figures remain in running prose ("Rank improved from #8 to #4 on Sep 29").
4. The minus sign is the typographic minus (U+2212), which has the same advance width as the plus sign in tabular figures. `@/lib/format` inserts it; never type a hyphen as a minus in UI text.
5. Units follow values with a space where the unit is a word (`14 pts`, `1,240 keywords`) and without a space for symbols (`47.2%`, `$24.18`).

Font features (verified in the font files on 2026-09-29): Geist Sans digits are proportional by default and the `tnum` feature makes all digits 600 units wide, so `num` is required on every compared number. Neither Geist Sans nor Geist Mono has a `zero` (slashed zero) feature, so `slashed-zero` is not used; where 0 and O must be distinguished (IDs, keys), Geist Mono is used. A Playwright check in the design-system preview asserts equal rendered width for `111,111` and `888,888` in a `num` cell.

## 5. Truncation and wrapping

| Content | Rule |
|---|---|
| Table cells | Single line, ellipsis at the end, full value in a tooltip on hover and focus ([22-content-formatting.md](22-content-formatting.md) section 6) |
| URLs and paths | Middle truncation keeping host and last segment |
| Prompts in tables | Single line, ellipsis; full text in the inspector |
| Titles | Page and section titles never truncate; they wrap to a second line at most |
| Buttons and badges | Never wrap; labels are short by rule (3 words for buttons) |
| Prose | Wraps; `text-wrap: pretty` for paragraphs, `balance` for titles |

## 6. Localization readiness

English only in V1, but layouts must tolerate 30% longer strings: labels are never fixed-width, table columns size to content up to their maximum, and buttons grow rather than truncate.
