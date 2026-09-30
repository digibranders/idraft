# ADR-DS-009: Neutral color system with one cobalt accent (OKLCH)

Status: Accepted
Date: 2026-09-29

## Context
Analysts work for hours; color must carry meaning. Default AI-product palettes (purple glow) and multi-accent dashboards reduce signal.

## Decision
Cool neutrals (hue 255 to 265) for about 95% of pixels, one cobalt accent (hue 261, `#1E65E3`, values from [reference/visual-spec.md](../reference/visual-spec.md) section 2) exposed as `primary`, semantic positive, negative, warning; info reuses the accent. All tokens in OKLCH, clamped to sRGB, tested for WCAG 2.2 AA in both themes by an automated test.

## Alternatives considered
shadcn neutral defaults (no semantic status tokens, gray chart colors), a brand palette with several accents, HSL tokens (uneven perceived lightness).

## Tradeoffs
Hex equivalents are documented for design tools. New colors require a system change with tests.

## Revisit trigger
Brand identity work introduces a different accent, or contrast testing moves to APCA as a normative standard.
