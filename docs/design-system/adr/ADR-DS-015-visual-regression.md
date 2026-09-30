# ADR-DS-015: Playwright screenshots in Docker for visual regression

Status: Accepted
Date: 2026-09-29

## Context
UI drift must be caught cheaply. Chromatic is tied to Storybook; Percy's paid pricing is unpublished; Argos is MIT with a free tier; Playwright is already used for E2E.

## Decision
Playwright `toHaveScreenshot` against the preview route and page templates in a pinned Playwright Docker image, fixed clock, fonts ready, animations disabled, light and dark, two densities. Argos can be added later for review UX.

## Alternatives considered
Chromatic, Percy, no visual testing.

## Tradeoffs
Baselines live in the repository; updates require a design-system document change in the same pull request.

## Revisit trigger
Review of screenshot diffs becomes a bottleneck, then add Argos.
