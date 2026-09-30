# ADR-DS-014: Custom /design-system route instead of Storybook

Status: Accepted
Date: 2026-09-29

## Context
We need to inspect primitives, variants, tables, charts, states, both themes and densities. Research (2026-09-29): Storybook 10 with nextjs-vite runs on Vite rather than the app's Turbopack build and has limited next/font support; Ladle is barely maintained; Lost Pixel is archived.

## Decision
A gated `/design-system` route in the Next app renders every component state in both themes and densities, using the real build, fonts and providers. Visual regression runs against it.

## Alternatives considered
Storybook 10, Ladle.

## Tradeoffs
No standalone catalogue for other teams; component docs live in markdown plus the route.

## Revisit trigger
Other teams or external contributors need an isolated component catalogue.
