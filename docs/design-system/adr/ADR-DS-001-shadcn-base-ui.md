# ADR-DS-001: shadcn/ui on Base UI primitives

Status: Accepted
Date: 2026-09-29

## Context
We need accessible primitives (dialogs, menus, comboboxes, popovers, tooltips, toasts) whose visual layer we own completely. The client fixed shadcn/ui and Base UI. Research (2026-09-29): Base UI 1.x is stable since 2025-12, @base-ui/react 1.8 is current, and the shadcn CLI 4.x uses Base UI as its default base (`-b base`, preset `base-nova`).

## Decision
Use shadcn/ui components generated on the Base UI base, copied into `components/ui`, restyled to our tokens before merge. Base UI's `render` prop and data attributes drive composition and state styling. Command palette uses Base UI Autocomplete in a Dialog; toasts use Base UI Toast. No Radix, MUI, Ant, Chakra or Mantine (lint-enforced).

## Alternatives considered
Radix-based shadcn (mature, but not the chosen primitives and now secondary in shadcn); React Aria (strong accessibility, heavier API, different styling model); a full component framework such as MUI or Mantine (brings its own visual language, fights our tokens).

## Tradeoffs
We own every pixel and every component diff. Some shadcn Base-style components still wrap third parties (Calendar: react-day-picker 10; Chart: Recharts, which we replace with ECharts). Restyling on import is a required step.

## Revisit trigger
Base UI loses maintenance momentum, or a needed primitive (data grid, date picker) becomes available in Base UI and should replace a third-party dependency.
