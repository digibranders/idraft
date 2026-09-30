# Generation Brief

Status: Reference (design-system v1)
Last updated: 2026-09-29

The prompts that produced the screens in [README.md](README.md). Send the shared brief first, then one screen request per message. The hex values match [02-color-system.md](../02-color-system.md); if tokens change, update this brief before generating new screens.

## 1. Shared brief (first message)

```text
I need high-fidelity UI design reference images for a premium B2B analytics web app called Sightline. It tracks Google rankings and AI answer visibility (ChatGPT, Gemini, Google AI Mode, Google AI Overview) for SEO teams. Engineers will build from these images, so render each one crisp, pixel-precise and realistic, like a real production screenshot of a shipped product, not a Dribbble shot. Generate ONE image per message, landscape 1536x1024, desktop at 1440px wide. Legible text is critical: keep labels short and real.

VISUAL LANGUAGE (applies to every image in this chat): premium, instrument-grade product UI in the tier of Linear, Vercel, Stripe Dashboard and Mercury. Calm, precise, confident, expensive through restraint. Light theme. Canvas #F9FAFB. Panels and tables #FDFDFE. Left sidebar #F4F5F7. Hairline 1px borders: #E6E8EA inside panels, #DADCE0 around panels. No drop shadows on panels, no gradients, no glow, no glassmorphism, no illustrations, no emojis.

ONE accent only: cobalt #2763D7. Use it only for the primary button, the current nav item, the active tab underline, links, focus and the own-brand chart line. Selected nav item and selected table row use a pale cobalt tint #E9F1FF. Text near-black #171A1E, secondary #474B51, metadata #5F636A.

Typography: Geist Sans everywhere (Geist Mono only for URLs and IDs). 13px base, page title 20px semibold with tight tracking, section titles 14px semibold. Sentence case everywhere, no uppercase letter-spaced labels. All numbers tabular and right-aligned in tables.

Radius: 6px buttons and inputs, 8px panels, 4px badges. No pill shapes anywhere. Badges are small neutral gray rectangles (#EEF0F3 fill, #474B51 text) for categories like intent, engine and topic. Color appears only for real state: muted green #1F7A4D for improved or cited, muted red #B42318 for lost, amber #A15C07 for warnings.

Summary numbers sit in ONE horizontal metric strip: a single bordered panel split into 4 to 6 cells by hairline vertical dividers. Each cell has a 12px gray label, a 22px medium tabular value and a small change such as ↑3 or +2.1 pts. No separate KPI cards, no icon tiles, no colored card backgrounds.

Charts: thin 1.5px lines. Own brand is cobalt. Competitors or other engines use muted orange #C2671B, teal #2F8F9D, plum #7A3E7F and olive #8A7A2E. Faint dashed gridlines, small gray axis labels, no area fills, no donut or pie charts. Rank charts use an inverted y axis with 1 at the top.

Tables: 32px rows, 1px horizontal hairlines only, no zebra striping. Sticky header on #F4F6F8 with 12px gray header text. The own-domain row is highlighted with the pale cobalt tint. Icons: Lucide outline, 16px, stroke 1.75, gray.

App shell: a 216px left sidebar with:
- a workspace switcher at the top (square monogram plus project name "fieldnote.io")
- grouped navigation: Overview; SEO (Rankings, Keywords, SERP features, Pages); AI visibility (Prompts, Citations, Engines); Competitors; Changes; Reports; Settings
- a one-line collection status at the bottom: "Last run 06:12 · 1,284 keywords"

A 48px top bar holds a breadcrumb, a search field with a ⌘K hint, a date range button, a location selector ("United States") and a small avatar. Real data starts high on the page. The layout is dense but calm, getting its polish from strict alignment and a 4px spacing grid rather than big padding. When a record is selected, a 480px right inspector panel appears, separated by a left border with no shadow.

Use realistic, varied data. Own domain fieldnote.io; competitors hubspot.com, pipedrive.com, attio.com, folk.app; keywords like "best crm for startups", "crm for small business", "sales pipeline software".
```

## 2. Screen requests

### Screen 1

```text
SCREEN 1 of 7: AI visibility overview. The page header has the title "AI visibility", the meta line "412 prompts · 4 engines · updated 12m ago", and on the right a segmented control (7d / 30d / 90d) and an Export button. Below it, a metric strip with 5 cells: Mention rate 38.4% (+2.1 pts), Citation rate 21.7% (+0.8 pts), First-mention rate 12.9%, Share of voice 17.3%, Prompts with answers 409 of 412. Then a two-column row:
- left (60%): a line chart "Mention rate by engine" over 90 days, with four lines (ChatGPT cobalt, Gemini orange, AI Mode teal, AI Overview plum) and a clean legend
- right (40%): a panel "Share of voice vs competitors" with horizontal bars for fieldnote.io (cobalt), hubspot.com, pipedrive.com, attio.com and folk.app (gray bars), with a percentage at the end of each bar

Below that, a full-width table "Topics" with columns Topic, Prompts, Mention rate, Citation rate, Change, Top competitor. It has 8 rows, and the Change column uses neutral text except for one green and one red value.
```

### Screen 2

The first paragraph carries the corrections that apply to every later screen. Its 32 px sidebar rows match the v2 spec ([visual-spec.md](visual-spec.md) section 4).

```text
Excellent, this is the right direction. Keep this exact visual language for every remaining screen, with these corrections: never use a dash glyph for no change (write 0 or 0 pts in neutral gray); sidebar nav rows 32px tall and slightly tighter; the highlighted nav item must match the current page. Generate a brand new image, do not edit the previous one.

SCREEN 2 of 7: SEO rankings with the keyword inspector open. Breadcrumb 'SEO > Rankings'. Page title 'Rankings', meta line '1,284 keywords · Google US desktop · checked 06:12'. Metric strip with 5 cells: Avg position 14.2 (↑0.8), In top 3: 96, In top 10: 311, In AI Overview: 142, Visibility 23.4% (+1.2 pts). Below it a filter bar: search input, filter buttons 'Tag', 'Intent', 'Position', 'SERP feature', two removable neutral gray chips 'Tag: crm' and 'Position: 1 to 20', and a 'Columns' button on the right. Main table on the left (about 900px wide) with columns: checkbox, Keyword, Intent (neutral badge), Volume, Position, Change (↑3 in green only when significant, ↓2, 0 neutral), URL (mono, truncated), SERP features (a row of small gray icons), AI Overview (small check or 'cited' marker), Updated. 14 rows; row 3 'best crm for startups' is selected with the pale cobalt tint. On the right a 480px inspector for 'best crm for startups': header with the keyword, close and open-full-page icon buttons, and badges 'Commercial' and 'crm'; a tab row (Overview, SERP, AI answers, History) with Overview active; a compact 2x3 key-value grid (Position 3 ↑2, Volume 8,100, CPC $12.40, Difficulty 62, Ranking URL /crm/startups, First seen Jan 12); a small 90-day position history line chart with inverted axis (own line cobalt, two competitor lines muted); an 'AI Overview' section showing 'Cited · source 2 of 5' with a two-line quoted answer excerpt and small source domain chips; and a 'Top 5 results' mini list with rank, domain and title.
```

### Screen 3

```text
Same visual language and corrections as before. Generate a brand new image, do not edit a previous one.

SCREEN 3 of 7: full keyword detail page for 'best crm for startups' (no inspector).

Header:
- breadcrumb 'SEO > Keywords > best crm for startups'
- the keyword as the page title, with neutral badges 'Commercial' and 'crm'
- on the right, a secondary button 'Recheck' and a primary cobalt button 'Add to report'

A metric strip with 6 cells: Position 3 (↑2 vs 7d), Search volume 8,100, GSC clicks 1,184 (+18%), CPC $12.40, SERP features 6, AI Overview 'Cited, source 2'.

A tab row: Overview (active), Ranking history, SERP, AI answers, Competitors, Related keywords (count 42), Pages (count 6).

The content uses a 12-column grid. Left, 8 columns:
- a 'Ranking history' line chart over 6 months with an inverted axis (ticks 1, 3, 10, 20, 50), the own line in cobalt, three muted competitor lines, and one hover tooltip listing positions on that date
- below it, a 'Top ranking URLs' table: #, URL (mono), Title, Domain, Est. traffic, First seen, Last seen; 10 rows, with the fieldnote.io row tinted

Right, 4 columns:
- an 'AI answers' panel listing ChatGPT, Gemini, AI Mode and AI Overview, each with a small status badge (Cited in muted green, Mentioned neutral, Not mentioned neutral outline) and its mention order; one answer is expanded as a short excerpt with 3 cited source domains
- a compact 'SERP features' list (AI Overview, People also ask 4, Sitelinks, Video 2, Images), each marked present or absent, with an 'Owned' marker where fieldnote.io holds it
- a small 'Recent changes' timeline with tabular gray dates on the left and one-line events
```

### Screen 4

```text
Same visual language and corrections as before. Generate a brand new image, do not edit a previous one.

SCREEN 4 of 7: AI visibility > Prompts, with the prompt inspector open.

Title 'Prompts', meta line '412 prompts · 4 engines · last run 06:12'. A filter bar with a search field and the filters 'Topic', 'Engine' and 'Status'.

The table has these columns: Prompt (a truncated question), Topic (neutral badge), ChatGPT, Gemini, AI Mode, AI Overview, Mention rate, Change. Each engine cell shows one small status glyph: a filled cobalt dot for cited, a hollow cobalt ring for mentioned, a small light gray dot for not mentioned. A tiny legend for these glyphs sits above the table. 16 rows, with row 2 selected.

A 480px inspector on the right for the prompt 'What is the best CRM for an early stage startup?':
- metadata rows: Topic, Tracked since, Runs 28, Last run
- an engine segmented control with ChatGPT active
- the latest answer as clean readable text (14px, about 60 characters per line), with the brand name 'fieldnote' highlighted by a pale cobalt background and inline citation markers [1] [2] [3]
- a 'Sources' list below: number, domain, page title, and an 'Owned' badge on the fieldnote.io source
- at the bottom, 'Mention rate by engine': four tiny sparkline rows, each with its current value
```

### Screen 5

```text
Same visual language and corrections as before. Generate a brand new image, do not edit a previous one.

SCREEN 5 of 7: AI visibility > Citations.

Title 'Citations', meta line '2,842 citations across 604 domains · 90 days'. A metric strip: Citations 2,842, Cited domains 604, Owned citation share 8.4% (+1.1 pts), Pages cited 1,236.

Then a two-panel row:
- left: 'Citation share by domain type', drawn as ONE horizontal 100% stacked bar with labeled segments (Media, Review sites, Owned, Competitors, Community, Other) in the muted chart palette, with a compact legend table beneath showing count and share
- right: 'Citations over time', a line chart with 3 lines (All in gray, Owned in cobalt, Competitors in orange)

Then a full-width table 'Cited domains' with columns: Domain, Type (neutral badge), Citations, Share, Engines (four tiny squares, filled when that engine cites the domain), Pages, First seen, Last seen, and a 90-day trend sparkline (gray, cobalt for the owned row). 12 rows, including g2.com, techradar.com, reddit.com, forbes.com, capterra.com, hubspot.com, zapier.com and fieldnote.io (owned, row tinted).
```

### Screen 6

```text
Same visual language and corrections as before. Generate a brand new image, do not edit a previous one.

SCREEN 6 of 7: Changes, a feed of what moved.

Title 'Changes', meta line 'Last 30 days · 128 events'. A segmented control: All 128, Rankings 64, AI answers 41, Citations 17, Competitors 6.

The main column is a feed grouped by day, with sticky day headers ('Today', 'Yesterday', 'Sep 26'). Each row is 40px tall:
- time (tabular gray)
- a gray Lucide event icon
- a one-line event with the object name in medium weight, for example: 'best crm for startups moved ↑4 to position 3', 'Gemini stopped citing fieldnote.io/pricing', 'attio.com entered the top 10 for crm for small business', 'AI Overview appeared for sales pipeline software'
- a neutral type badge
- the engine or source
- a right-aligned 'View' link

Only the movement values use muted green or red. On the right, a 320px column 'Alert rules': a simple list of 4 rules, each with a toggle and a one-line description, plus a secondary 'New rule' button.
```

### Screen 7

```text
Same visual language and corrections as before. Generate a brand new image, do not edit a previous one.

SCREEN 7 of 7: the Rankings screen from screen 2, now in DARK theme and without the inspector (the table runs full width with 18 rows).

Dark tokens:
- surfaces: sidebar #0B0C0E, canvas #0F1113, panels #131518, table header #181A1C, row hover #1E2124, selected row #1A2539
- borders: #212326 inside panels, #2C2E31 around panels
- text: #EBEDEF, secondary #BABEC3, metadata #979CA2
- accent: fill #356DDC; accent text and the own chart line #7FAAFA
- semantic: green #4CC38A, red #F1707B

No pure black, no glow, no gradients. Layered surfaces create depth instead of shadows.
```
