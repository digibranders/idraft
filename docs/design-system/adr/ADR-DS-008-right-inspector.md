# ADR-DS-008: Right inspector for record detail

Status: Accepted
Date: 2026-09-29

## Context
Users inspect many records in sequence and must not lose list context (scroll, filters, selection).

## Decision
A docked, resizable (360 to 640 px; 400 px default, 440 px for prompt, citation and answer evidence), URL-addressable right inspector (`?inspect=type:id`) opens from table rows; Back closes it; previous and next record navigation; full pages only for deep objects. It overlays when docking at its 360 px minimum would leave the main column narrower than 720 px, and becomes a full-screen sheet below 768 px ([16-drawers-dialogs-popovers.md](../16-drawers-dialogs-popovers.md) section 2.6).

## Alternatives considered
Modal dialogs for detail (block context), full-page navigation for everything (loses context), expandable rows (cramped for rich detail).

## Tradeoffs
The shell must handle three columns; tables must tolerate width changes without losing scroll.

## Revisit trigger
Analytics show users mostly open full pages instead, or the inspector becomes a second application.
