# ADR-DS-002: Tailwind CSS v4 with a reset default theme and token utilities

Status: Accepted
Date: 2026-09-29

## Context
Utility CSS is fast to write but drifts when any color, size or radius is available. Tailwind 4.3 supports CSS-first configuration, `@theme inline` mapping to CSS variables, and resetting default namespaces.

## Decision
Tailwind 4 with `--color-*: initial`, `--text-*: initial`, `--radius-*: initial`, `--shadow-*: initial` and related resets; only design tokens are registered as utilities (`bg-surface`, `text-foreground-secondary`, `h-control`), plus composite `type-*` utilities. Allowed spacing steps and arbitrary-value bans are enforced by eslint-plugin-better-tailwindcss.

## Alternatives considered
CSS Modules (more files, no utility speed), vanilla-extract (typed but a second styling system beside shadcn), keeping Tailwind defaults with lint only (defaults leak into code).

## Tradeoffs
Copied shadcn components must be converted (their `text-sm`, `rounded-*`, `bg-accent` classes) before use. Forbidden classes simply do not exist, which catches drift at build and lint time. Verified: `bg-red-500`, `text-sm`, `rounded-2xl` generate nothing with our globals.css.

## Revisit trigger
Tailwind changes theme reset semantics, or the team adopts a design-token pipeline (for example Style Dictionary) that should generate tokens.css.
