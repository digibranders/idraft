# ADR-DS-005: TanStack Table v9 and TanStack Virtual for DataTable

Status: Accepted
Date: 2026-09-29

## Context
Tables are the primary instrument: sorting, pinning, resizing, reordering, visibility, selection, grouping, virtualization, server and client modes, keyboard grid behavior. TanStack Table v9 became stable on 2026-08-04 with a new `useTable` API and TanStack Store state.

## Decision
One `DataTable` component built on TanStack Table v9 (headless) and TanStack Virtual 3 with fixed row heights per density. We own markup, ARIA grid behavior and styling. Column helpers (`col.*`) encode column types.

## Alternatives considered
AG Grid (full features, own DOM and theme that fights tokens, license for advanced features), MUI X Data Grid (framework coupling), TanStack Table v8 (most examples, but superseded).

## Tradeoffs
We implement keyboard grid navigation, column menus and resize alternatives ourselves. Most online examples are v8; v9's `useLegacyTable` shim exists for porting examples.

## Revisit trigger
A requirement such as spreadsheet-like editing or pivoting appears that would take more than a quarter to build.
