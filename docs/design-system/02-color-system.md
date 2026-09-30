# 02. Color System

Status: Accepted (design-system v2)
Last updated: 2026-09-29
Visual source: [reference/visual-spec.md](reference/visual-spec.md) section 2. Implementation: [`tokens.css`](../../apps/web/src/styles/tokens.css). Verification: [`tokens.contrast.test.ts`](../../apps/web/src/lib/design/tokens.contrast.test.ts) (220 tests, 110 per theme). The web package suite (`pnpm --dir apps/web run test`: this file plus the formatter tests) passes with 241 of 241 tests on 2026-09-29.

## 1. Philosophy

- **Neutral first.** Surfaces, text and borders are cool neutrals (OKLCH hue 254 to 265, chroma at most 0.022). About 95% of any screen is neutral. The canvas is a very light cool gray, panels are near white, and the sidebar is one step darker than the canvas.
- **One accent.** A vivid cobalt (OKLCH hue 261 to 263) marks the primary action, the current navigation item, selection, focus, links and the own-brand series. No second accent exists.
- **Semantic color is meaning.** Positive (green, hue 153 to 159), negative (red, hue 28), warning (amber, hue 70 to 85). Info reuses the accent hue so it never adds a new color.
- **Charts have their own palette**, validated for color-vision deficiencies and kept away from the semantic green and red hues.
- **OKLCH everywhere.** Perceptually even lightness steps make light and dark themes predictable. Every value is inside the sRGB gamut; hex equivalents below are for design tools only.

Why cobalt: it is serious and legible on both themes, distinct from the semantic hues, and avoids the purple-glow palette of "AI products". Hue 261 to 263 sits far enough from the violet range (around 290 to 300) to read as blue.

**How the hex values were produced.** Every hex value in this document is computed from the OKLCH value in `tokens.css` with culori (`formatHex`, sRGB, rounded to the nearest integer per channel). The OKLCH value is canonical. [visual-spec.md](reference/visual-spec.md) section 2 lists the hex values measured from the reference screens; the OKLCH tokens reproduce them to within 3 of 255 per channel. Where the two differ, the table below shows the computed value: `--surface` `#FEFEFF` (screen `#FEFEFE`), `--primary` and `--chart-1` `#1E65E3` (`#1D65E3`), `--primary-text` and `--link` `#175AD0` (`#1A5AD0`), `--border-strong` `#81878F` (`#81868F`), `--chart-2` `#DD6A21` (`#DD6A22`), `--chart-3` `#1B969C` (`#1C969C`), `--chart-4` `#8A3C9B` (`#8A3C9C`).

## 2. Light theme

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `--background` | `0.979 0.003 265` | `#F7F8FA` | App canvas behind page content |
| `--sidebar` | `0.964 0.003 265` | `#F2F3F5` | Left navigation, one step darker than the canvas |
| `--surface` | `0.997 0.001 255` | `#FEFEFF` | Panels, top bar, inspector, inputs, tables |
| `--surface-subtle` | `0.979 0.003 265` | `#F7F8FA` | Table header, quote boxes, wells, code blocks (same tone as the canvas) |
| `--surface-elevated` | `0.997 0.001 255` | `#FEFEFF` | Popovers, menus, dialogs, chart tooltips (with shadow) |
| `--surface-hover` | `0.963 0.003 255` | `#F1F3F5` | Row and item hover |
| `--surface-selected` | `0.957 0.019 263` | `#EAF1FE` | Selected row, active nav item |
| `--surface-disabled` | `0.958 0.003 255` | `#F0F1F3` | Disabled control fill |
| `--foreground` | `0.204 0.011 261` | `#14171C` | Primary text and values |
| `--foreground-secondary` | `0.389 0.020 263` | `#3F4550` | Navigation labels, secondary values |
| `--foreground-tertiary` | `0.522 0.021 258` | `#626A76` | Meta, labels, table headers, axis labels, placeholders |
| `--foreground-muted` | `0.620 0.010 260` | `#83868C` | Non-text only (inactive icons, separator glyphs, the "not mentioned" engine dot) |
| `--foreground-disabled` | `0.720 0.006 260` | `#A2A5A8` | Disabled text (exempt from contrast rules) |
| `--foreground-inverse` | `0.985 0.002 255` | `#F9FAFB` | Text on primary and inverse fills |
| `--link` | `0.503 0.193 261` | `#175AD0` | Links |
| `--border-subtle` | `0.948 0.005 258` | `#ECEEF1` | Row dividers, inner separators, key-value grid cells |
| `--border` | `0.924 0.006 255` | `#E3E6EA` | Panel, popover and button outlines |
| `--border-strong` | `0.620 0.014 258` | `#81878F` | Checkbox, radio and form control outlines (3:1 required) |
| `--ring` | `0.560 0.200 261` | `#266BE7` | Focus ring |
| `--primary` | `0.542 0.204 261` | `#1E65E3` | Primary button, checked controls, active tab underline, switch track when on |
| `--primary-hover` | `0.490 0.195 261` | `#1156CC` | Primary hover and pressed |
| `--primary-foreground` | `0.985 0.002 255` | `#F9FAFB` | Text on primary |
| `--primary-text` | `0.503 0.193 261` | `#175AD0` | Accent text and icons (active nav item, active tab, selected row key text) |
| `--primary-subtle` | `0.957 0.019 263` | `#EAF1FE` | Accent tint (selected segment, current page button, brand highlight in answers) |
| `--primary-border` | `0.842 0.064 262` | `#B5CCF6` | Accent outline (selected segment) |

In the light theme `--surface-selected` and `--primary-subtle` have the same value, and `--surface-subtle` equals `--background`.

## 3. Dark theme

Dark mode is designed as layered neutral surfaces: the sidebar is the darkest layer, the canvas next, then panels, then elevated overlays. Text steps are chosen for contrast against the lightest surface they appear on (hover and selected).

| Token | OKLCH | Hex | Relationship |
|---|---|---|---|
| `--sidebar` | `0.158 0.007 258` | `#0B0D10` | Darkest layer, near black but not black |
| `--background` | `0.175 0.005 260` | `#0F1113` | Canvas |
| `--surface` | `0.195 0.006 260` | `#131518` | Panels, top bar, tables |
| `--surface-subtle` | `0.215 0.006 260` | `#181A1C` | Table header, wells |
| `--surface-elevated` | `0.235 0.007 260` | `#1C1E21` | Popovers, dialogs (plus 1 px border in the shadow token) |
| `--surface-hover` | `0.245 0.007 260` | `#1E2124` | Hover |
| `--surface-selected` | `0.274 0.050 263` | `#1A2740` | Selected row, active nav item (dark blue tint) |
| `--surface-disabled` | `0.290 0.006 260` | `#2A2B2E` | Disabled. Lighter than `--surface-elevated` so a disabled button keeps its shape on dialogs and popovers |
| `--foreground` | `0.945 0.004 255` | `#EBEDEF` | Primary text (not pure white) |
| `--foreground-secondary` | `0.800 0.008 255` | `#BABEC3` | Navigation labels, secondary values |
| `--foreground-tertiary` | `0.690 0.010 255` | `#979CA2` | Meta, labels |
| `--foreground-muted` | `0.580 0.010 255` | `#767B80` | Non-text only |
| `--foreground-disabled` | `0.460 0.008 255` | `#55585D` | Disabled |
| `--foreground-inverse` | `0.215 0.010 260` | `#171A1E` | Text on inverse fills |
| `--link`, `--primary-text` | `0.740 0.125 262` | `#7FAAFA` | Accent text, checks and own-series text |
| `--border-subtle` | `0.255 0.006 260` | `#212326` | Dividers inside panels |
| `--border` | `0.300 0.007 260` | `#2C2E31` | Outlines around panels |
| `--border-strong` | `0.560 0.010 260` | `#71757A` | Checkbox, radio and form control outlines |
| `--ring` | `0.680 0.160 262` | `#6095FA` | Focus |
| `--primary` | `0.560 0.180 262` | `#356DDC` | Primary fill |
| `--primary-hover` | `0.510 0.180 262` | `#265ECB` | Hover darkens (keeps 4.5:1 for white text) |
| `--primary-foreground` | `0.985 0.002 255` | `#F9FAFB` | Text on primary |
| `--primary-subtle` | `0.265 0.050 262` | `#18253D` | Accent tint |
| `--primary-border` | `0.420 0.100 262` | `#2E4B83` | Accent outline |

Dark-mode rules:
1. Elevation is shown by lighter surfaces plus a 1 px `--border`, because shadows are nearly invisible on dark backgrounds. Overlay shadow tokens in dark mode include a 1 px ring.
2. No pure black (`#000`) and no pure white (`#fff`) anywhere.
3. Semantic text colors are lighter and less saturated than in light mode to avoid glowing.
4. Charts use the dark chart palette (section 7); gridlines drop to `--chart-grid` (`0.255`).
5. The workspace monogram is a cobalt square with a white letter in dark mode (a near-black square in light mode) ([11-navigation.md](11-navigation.md)).

## 4. Semantic colors

Light theme:

| Family | `-text` | `-subtle` | `-border` | `-solid` |
|---|---|---|---|---|
| Positive | `0.512 0.122 153` `#197A43` | `0.954 0.024 159` `#E3F5EA` | `0.840 0.070 155` `#A7D9B7` | `0.580 0.140 153` `#1C9150` |
| Negative | `0.551 0.188 28` `#C8322B` | `0.962 0.017 28` `#FEEEEC` | `0.840 0.070 28` `#F5BAB1` | `0.560 0.190 28` `#CC342D` |
| Warning | `0.520 0.110 70` `#915C08` | `0.965 0.034 85` `#FEF2DA` | `0.840 0.100 80` `#EDC47D` | `0.640 0.140 70` `#C17A00` |
| Info | `0.503 0.193 261` `#175AD0` | `0.957 0.019 263` `#EAF1FE` | `0.842 0.064 262` `#B5CCF6` | (uses `--primary`) |
| Neutral | `0.415 0.022 261` `#454C58` | `0.954 0.005 258` `#EEF0F3` | `0.924 0.006 255` `#E3E6EA` | n/a |

Dark theme:

| Family | `-text` | `-subtle` | `-border` | `-solid` |
|---|---|---|---|---|
| Positive | `0.750 0.130 158` `#5BC78E` | `0.255 0.040 158` `#10291B` | `0.420 0.080 158` `#1E5A3C` | `0.660 0.140 158` `#2CAB70` |
| Negative | `0.720 0.150 28` `#F47C6E` | `0.265 0.050 28` `#3A1B17` | `0.450 0.110 28` `#883931` | `0.640 0.180 28` `#E5564A` |
| Warning | `0.800 0.130 80` `#E9B452` | `0.265 0.045 80` `#312308` | `0.460 0.090 80` `#72510D` | `0.780 0.150 75` `#EFA831` |
| Info | `0.740 0.125 262` `#7FAAFA` | `0.265 0.050 262` `#18253D` | `0.420 0.100 262` `#2E4B83` | (uses `--primary`) |
| Neutral | `0.831 0.008 254` `#C4C8CD` | `0.280 0.009 256` `#26292D` | `0.300 0.007 260` `#2C2E31` | n/a |

Usage within a family:

| Variant | Use | Never |
|---|---|---|
| `-text` | Text, icons, deltas, inline status words | As a large background |
| `-subtle` | Badge background, inline banner background | Behind body paragraphs longer than one line (use a banner with an icon instead) |
| `-border` | Outline badges, banner borders, invalid input (negative uses `-solid` for inputs) | As text |
| `-solid` | Chart marks, meter fills, status dots | As text (warning solid fails text contrast by design) |

Badge colors in v2: the neutral badge is `--neutral-subtle` fill with `--neutral-text` label and an optional 1 px `--neutral-border`; the positive badge ("Cited", "Owned", "Cited · source 2 of 5") is `--positive-subtle` fill with `--positive-text` label and an optional check icon ([14-badges-status.md](14-badges-status.md)).

The positive and negative hues were chosen to differ in lightness as well as hue (positive is darker in light mode), and every state that uses them also carries a sign, arrow, icon or word, so red-green color-vision deficiency never removes information (WCAG 1.4.1).

### 4.1 Component-specific color tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--negative-button`, `--negative-button-hover`, `--negative-button-foreground` | `0.540 0.190 28` `#C52C26`, `0.490 0.180 28` `#B01F1C`, `0.985 0.002 255` `#F9FAFB` | `0.540 0.180 28` `#C1332C`, `0.490 0.170 28` `#AC2722`, `0.985 0.002 255` `#F9FAFB` | Solid destructive button in confirmation dialogs only ([09-buttons-controls.md](09-buttons-controls.md)); white text meets 4.5:1 in both themes (tested). The shadcn aliases `--destructive` and `--destructive-foreground` point at `--negative-button` and `--negative-button-foreground` |
| `--entity-1-highlight` to `--entity-6-highlight`, `--entity-other-highlight` | `color-mix(in oklch, var(--chart-n) 18%, transparent)` | same formula on dark chart colors | Evidence highlights behind competitor mention spans in AI answers; `foreground` on each tint composited over `surface` meets 4.5:1 (tested). The own brand in answer text uses `--primary-subtle` behind `--primary-text` weight 500 instead |
| `--scrim` | `0.215 0.010 260 / 0.32` | `0.100 0.005 260 / 0.56` | Modal dialog backdrop |
| `--theme-switch-day`, `--theme-switch-night` | `0.915 0.040 238` `#CBE8FB`, `0.360 0.085 258` `#1F3D69` | same | `ThemeSwitch` track: day (light theme) and night (dark theme). The switch always shows the current theme, so each value renders in one theme only |
| `--theme-switch-sun`, `--theme-switch-moon`, `--theme-switch-knob` | `0.580 0.130 58` `#B26417`, `0.900 0.165 100` `#F8E048`, `0.995 0.002 265` `#FDFDFE` | same | `ThemeSwitch` glyphs and knob. Sun on day 3.5:1, moon on night 8.2:1 (tested) |

## 5. Where color is allowed

| Element | Color |
|---|---|
| Page and panel backgrounds | Neutral surfaces only |
| Current navigation item | `surface-selected` background; label in `primary-text` weight 500 and icon in `primary-text` |
| Selected table row | `surface-selected` background; the key text (keyword, prompt, domain) in `primary-text` |
| Underline tabs | Active label in `primary-text` weight 500 with a 2 px `primary` underline; a 1 px `border` runs under the tab row |
| Segmented control, selected segment | `primary-subtle` fill, `primary-border` outline, `primary-text` label weight 500 (v1 used a neutral selected segment) |
| `CountTabs`, selected item | Solid `primary` with a `primary-foreground` label and a deeper blue count badge; other items have neutral count badges |
| Applied filter chips | `neutral-subtle` fill, no border, value in `foreground` weight 500. Accent is not used, so chips do not compete with selection |
| Primary button | Solid `primary`. At most one per view region (page header, dialog footer, inspector footer) |
| Checkbox checked, switch on | Solid `primary` with a white check; `primary` track |
| Pagination, current page | `primary-subtle` fill with `primary-text` |
| Links | `link`, underline on hover and focus |
| Focus | `ring` |
| Rank and metric deltas | `positive-text` or `negative-text` only when emphasized (section 6); otherwise `foreground-secondary` ("0" in neutral) |
| Status badges | Semantic subtle background plus text |
| Categorical badges (engine, intent, type) and domain chips | Neutral only (`neutral-subtle` fill, `neutral-text`) |
| Engine status glyphs and presence squares | `primary` for cited (filled), mentioned (ring) and present; `foreground-muted` dot for not mentioned; `border` square for absent |
| AI answer text | Own brand: `primary-subtle` behind `primary-text` 500. Citation markers "[1]": `primary-text` on `primary-subtle`. Competitors: entity highlight tokens (section 4.1) |
| Charts | Chart palette (section 7), semantic only for gains and losses |
| Change feed icons | `positive-text` or `negative-text` for rank moves, `foreground-tertiary` otherwise |
| Errors | `negative-*` with icon and text |

## 6. Semantic color rules for changes

Color is a claim that a change is real. The rules:

| Value type | Colored when | Otherwise |
|---|---|---|
| AI rate delta (mention, citation, recommendation) | API reports `is_detectable: true` for the comparison ([17-statistical-methodology.md](../17-statistical-methodology.md) section 6) | `foreground-secondary` text, tooltip "Within normal variation" |
| Single keyword rank change | `abs(change) > max(2, 2 x mean absolute daily change over the last 30 ranked checks)` | Neutral arrow and number |
| Rank entered or left tracked depth ("New", "Lost") | Always | n/a |
| SEO aggregate delta (visibility, top-10 count, average rank) | Change exceeds 2 standard deviations of the metric's own daily changes over the previous 28 days (API supplies `is_detectable`) | Neutral |
| Cost, volume, observation counts | Never green or red: these changes are information, not judgment | Neutral always; budget thresholds use warning |
| Status (run failed, integration error) | Always semantic | n/a |

Polarity is explicit per metric (`higher_is_better`, `lower_is_better`, `neutral`) and implemented in `formatMetricDelta` ([`delta.ts`](../../apps/web/src/lib/format/delta.ts)). Components never pick green or red themselves.

## 7. Data visualization palettes

### 7.1 Categorical (series)

Fixed order. Series 1 is always the project's own brand (or the primary series of a single-subject chart). Competitors take series 2 to 6 by their stored order, so a competitor has the same color on every screen.

| Token | Light | Dark | Name |
|---|---|---|---|
| `--chart-1` | `oklch(0.542 0.204 261)` `#1E65E3` | `oklch(0.698 0.146 262)` `#6A9CF8` | Cobalt (own brand; same value as `--primary` in light) |
| `--chart-2` | `oklch(0.652 0.164 48)` `#DD6A21` | `oklch(0.766 0.138 56)` `#F59A55` | Orange |
| `--chart-3` | `oklch(0.614 0.099 200)` `#1B969C` | `oklch(0.775 0.100 200)` `#5CC9CF` | Teal |
| `--chart-4` | `oklch(0.500 0.163 320)` `#8A3C9B` | `oklch(0.640 0.130 318)` `#AD71BF` | Plum |
| `--chart-5` | `oklch(0.490 0.095 100)` `#6D6111` | `oklch(0.620 0.095 99)` `#94873E` | Olive |
| `--chart-6` | `oklch(0.559 0.160 355)` `#B84379` | `oklch(0.740 0.141 352)` `#ED83B4` | Rose |
| `--chart-other` | `oklch(0.551 0.023 264)` `#6B7280` | `oklch(0.664 0.014 256)` `#8E949C` | "All" and "Other" aggregates; "Other" lines are dashed |
| `--chart-reference` | `oklch(0.66 0.02 255)` `#8A939F` | `oklch(0.50 0.015 255)` `#5E646C` | Previous period, averages, baselines; dashed |
| `--chart-bar-neutral` | `oklch(0.882 0.009 265)` `#D5D8DE` | `oklch(0.362 0.012 258)` `#3A3E44` | Competitor bars in bar lists (share of voice); the own bar uses `--chart-1` |
| `--chart-grid` | `oklch(0.948 0.005 258)` `#ECEEF1` | `oklch(0.255 0.006 260)` `#212326` | Gridlines (1 px dashed) |
| `--chart-axis` | `oklch(0.924 0.006 255)` `#E3E6EA` | `oklch(0.300 0.007 260)` `#2C2E31` | Axis lines |
| `--chart-band` | `oklch(0.955 0.004 255)` `#EEF0F3` | `oklch(0.235 0.007 260)` `#1C1E21` | Depth and confidence bands (with opacity in the chart theme) |

`--chart-positive` and `--chart-negative` point at `--positive-solid` and `--negative-solid`; `--chart-label` points at `--foreground-tertiary`.

Olive (series 5) is deliberately darker than the reference screens show (`#857829`), and the dark plum and olive are slightly darker than the screens too: at the screen values, orange and olive measure a CIEDE2000 difference of 1.3 under red-green color-vision simulation, against a minimum of 8 ([visual-spec.md](reference/visual-spec.md) section 2.3).

Validation (computed 2026-09-29 by `tokens.contrast.test.ts` over the values above, CIEDE2000 minimum pairwise difference among series 1 to 6):

| Vision | Light | Dark | Test minimum |
|---|---|---|---|
| Normal | 15.8 | 16.1 | 15 |
| Deuteranopia | 9.6 | 8.2 | 8 |
| Protanopia | 8.2 | 9.5 | 8 |
| Tritanopia (0.7 severity) | 15.9 | 16.4 | 8 |

Every series color, `--chart-other` and `--chart-reference` meets 3:1 against `--surface` (WCAG 1.4.11 graphical objects; lowest: `--chart-reference` 3.08:1 light and 3.05:1 dark, `--chart-2` 3.38:1 light). `--chart-bar-neutral` is not in the 3:1 mark test: bar lists print each value as text after the bar, so the bar is not the only carrier of the value. The palette avoids the semantic green and red hues so a competitor series is never read as "good" or "bad". The test fails CI if a change drops normal-vision separation below 15 or simulated separation below 8.

Maximum simultaneous categorical series: **6**. Beyond that, show the top 5 plus "Other", or switch to small multiples ([15-data-visualization.md](15-data-visualization.md) section 4).

### 7.2 Rank bands (sequential, darker is better in light mode)

| Band | Ranks | Light | Dark |
|---|---|---|---|
| `--rank-band-1` | 1 to 3 | `0.42 0.16 262` `#1545A2` | `0.78 0.11 262` `#91B7FE` |
| `--rank-band-2` | 4 to 10 | `0.55 0.15 262` `#3E6DC8` | `0.66 0.15 262` `#5E8FED` |
| `--rank-band-3` | 11 to 20 | `0.68 0.11 262` `#7398DC` | `0.54 0.14 262` `#3F6BBF` |
| `--rank-band-4` | 21 to 50 | `0.79 0.07 262` `#A2BBE8` | `0.42 0.10 262` `#2E4B83` |
| `--rank-band-5` | 51 to 100 | `0.88 0.035 262` `#CBD8EF` | `0.32 0.06 262` `#223251` |
| `--rank-band-none` | beyond depth or unranked | `0.93 0.004 255` `#E6E8EA`, hatched | `0.255 0.006 260` `#212326`, hatched |

In dark mode the band with the most emphasis (1 to 3) is the lightest, so "stronger = more contrast with the background" holds in both themes.

### 7.3 Sequential and diverging

- Sequential `--seq-1` to `--seq-7` (single cobalt hue) for heatmaps of rates and counts.
- Diverging `--div-neg-3` to `--div-pos-3` around a neutral `--div-zero` for change heatmaps. Diverging uses the semantic hues because the data is a gain or a loss.

| Token | Light | Dark |
|---|---|---|
| `--seq-1` | `0.97 0.012 262` `#F1F5FE` | `0.24 0.02 262` `#1A1F29` |
| `--seq-2` | `0.91 0.040 262` `#D3E2FD` | `0.31 0.06 262` `#1F304F` |
| `--seq-3` | `0.83 0.075 262` `#ADC8F9` | `0.39 0.10 262` `#26437A` |
| `--seq-4` | `0.73 0.110 262` `#82A8ED` | `0.48 0.13 262` `#335AA6` |
| `--seq-5` | `0.62 0.150 262` `#5283E0` | `0.58 0.15 262` `#4777D2` |
| `--seq-6` | `0.51 0.170 262` `#2B5FC6` | `0.69 0.14 262` `#6A9AF2` |
| `--seq-7` | `0.40 0.150 262` `#144097` | `0.80 0.10 262` `#9BBEFF` |
| `--div-neg-3` | `0.52 0.18 28` `#BA2C25` | `0.70 0.16 28` `#F17264` |
| `--div-neg-2` | `0.70 0.12 28` `#DF8074` | `0.50 0.13 28` `#A04037` |
| `--div-neg-1` | `0.87 0.05 28` `#F4C9C2` | `0.32 0.07 28` `#51231E` |
| `--div-zero` | `0.96 0.003 255` `#F0F2F4` | `0.24 0.006 260` `#1E1F22` |
| `--div-pos-1` | `0.88 0.05 158` `#BDE2CB` | `0.32 0.06 158` `#123C27` |
| `--div-pos-2` | `0.72 0.10 158` `#6BB88D` | `0.50 0.10 158` `#24744D` |
| `--div-pos-3` | `0.52 0.11 158` `#1E7C50` | `0.72 0.13 158` `#51BD85` |

## 8. Engines and entities in color

- Engines (ChatGPT, Gemini, AI Mode, AI Overview) have **no brand colors** in the UI. They are shown as neutral badges with a text label ([14-badges-status.md](14-badges-status.md) section 4). In charts that split by engine, engines take the categorical palette in the fixed order ChatGPT, Gemini, AI Mode, AI Overview, then official API engines, and the legend always names them.
- Tracked entities (own brand, competitors) use `project_entities.color_index` (1 to 6) mapped to `--chart-{n}`; the own brand is always 1. Evidence highlights for competitors in answer text use the same index through the `--entity-2-highlight` to `--entity-6-highlight` tokens (section 4.1) plus a 2 px left border. The own brand is highlighted with `--primary-subtle` behind `--primary-text` weight 500.

## 9. Contrast requirements (tested)

Every row below is a test in `tokens.contrast.test.ts`, run for each theme. The suite reads `tokens.css` directly, so a token edit that breaks a pair fails CI.

| Pair type | Minimum | Tests per theme |
|---|---|---|
| Every color token inside the sRGB gamut | n/a | 1 |
| Text (`foreground`, `-secondary`, `-tertiary`, `link`, `primary-text`, `positive-text`, `negative-text`, `warning-text`, `info-text`, `neutral-text`) on every surface (`background`, `surface`, `surface-subtle`, `surface-elevated`, `surface-hover`, `surface-selected`) | 4.5:1 | 60 |
| Text (`foreground`, `-secondary`, `-tertiary`) on `sidebar` | 4.5:1 | 3 |
| Non-text: `border-strong` (control outlines), `ring` (focus), `foreground-muted` (icons) on every surface | 3:1 | 18 |
| Foreground on fill: `primary-foreground` on `primary` and `primary-hover`; `negative-button-foreground` on `negative-button` and `negative-button-hover`; each semantic `-text` on its own `-subtle` (positive, negative, warning, info); `primary-text` on `primary-subtle`; `neutral-text` on `neutral-subtle` | 4.5:1 | 10 |
| Graphical marks on `surface`: `positive-solid`, `negative-solid`, `warning-solid`, `chart-1` to `chart-6`, `chart-other`, `chart-reference` | 3:1 | 11 |
| `foreground` on each entity evidence highlight (18% of `chart-n` over `surface`) | 4.5:1 | 6 |
| Categorical palette separation under normal vision and three color-vision simulations (section 7.1) | CIEDE2000 15 normal, 8 simulated | 1 |

Total: 110 tests per theme, 220 in the file.

Measured values (light): `foreground` on `surface` 17.8:1, `foreground-tertiary` on `surface` 5.4:1, `border-strong` on `surface` 3.6:1, `primary-foreground` on `primary` 5.0:1, `primary-text` on `surface-selected` 5.4:1, `neutral-text` on `neutral-subtle` 7.6:1. The lowest text pair is `negative-text` on `surface-selected` (4.69:1); the lowest non-text pair is `border-strong` on `surface-selected` (3.21:1).

Measured values (dark): `foreground` on `surface` 15.6:1, `foreground-tertiary` on `surface` 6.6:1, `border-strong` on `surface` 3.9:1, `primary-foreground` on `primary` 4.59:1. The lowest text pair is `foreground-tertiary` on `surface-selected` (5.38:1); the lowest non-text pair is `border-strong` on `surface-selected` (3.21:1).

Exempt by WCAG: disabled text (`--foreground-disabled`), decorative dividers (`--border`, `--border-subtle`), logos.

## 10. Rules for developers

1. Never write a color literal in a component: no hex, `rgb()`, `hsl()`, `oklch()` or Tailwind palette class. Lint blocks hex and color functions in code; the Tailwind theme reset removes palette classes.
2. Never pick green or red for a value yourself; use `formatMetricDelta` or `formatRankChange`, which return a tone.
3. Never use opacity to create a new text color (`text-foreground/60`); use the next text token.
4. Chart colors come from the chart theme, never from literals in series options.
5. A new color need (for example a new status) starts as a design-system change: add the token, contrast tests and documentation first.
