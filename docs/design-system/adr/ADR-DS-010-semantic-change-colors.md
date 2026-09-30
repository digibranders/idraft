# ADR-DS-010: Green and red for changes, gated by detectability

Status: Accepted
Date: 2026-09-29

## Context
The earlier frontend spec used blue and vermillion for deltas to avoid a red-green pair. The design-system brief asks for green for improvement and red for decline. Coloring every small change would signal false precision.

## Decision
Positive (hue 153 to 159, `#197A43` text) and negative (hue 28, `#C8322B` text) with different lightness, always paired with an arrow or sign and an accessible label. Changes are colored only when detectable (AI rates), beyond normal movement (ranks), or beyond 2 standard deviations (SEO aggregates); money and volume changes are never colored. This supersedes `docs/20-frontend-specification.md` section 4.7 delta colors.

## Alternatives considered
Blue and vermillion deltas (colorblind-friendlier but conflicts with the accent and with user expectations), color every change (false signal).

## Tradeoffs
Red-green color-vision deficiency is covered by arrows, signs, labels and lightness difference, not by hue.

## Revisit trigger
Accessibility testing with colorblind users shows confusion despite the redundant cues.
