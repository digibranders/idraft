# ADR-DS-019: The inspector is a floating card drawer with card sections

Status: accepted, 2026-09-30. Revises the inspector frame of ADR-DS-008 and ADR-DS-018; the inspector pattern itself (one record beside its list, docked, overlay or sheet) is unchanged.

## Context

Visual v2 (ADR-DS-018) drew the inspector as a flush column: `surface` fill, a hairline on its left edge, no shadow when docked, and sections divided by hairlines with a bordered key-value grid on top. In the preview it sat beside the whole main column, top bar included, so opening it narrowed the top bar and pushed the account button out of view.

The product owner reviewed the preview and chose the drawer from the first batch of reference images instead: a rounded card that floats under the top bar, with three metric cards, then a chart card with a selector and a legend underneath, a bar list card, and a table card with "View all".

## Decision

1. The inspector is a floating card: `background` fill, 1 px `border`, radius 10 px, `shadow-inspector`. It sits 12 px under the top bar and 12 px from the right and bottom window edges, docked or overlaying. Below 768 px it remains a full-screen sheet.
2. The top bar always spans the full width. The inspector is a sibling of the page content below the top bar.
3. Every section is a `surface` card (1 px `border`, radius 8 px, 12 px apart) with an icon, a title and at most one control in its header. The first row is 3 metric cards. This is the single exception to "panels are not nested".
4. Header: title with the command button, More and Close at the right; badges; the context line with Previous and Next; tabs. "Open page" moves into the More menu.
5. Docking keeps the 720 px minimum main column and also reserves the 12 px margin: the inspector docks when viewport minus sidebar minus 720 minus 12 is at least 360 px.

Only the look and structure come from the reference. Content follows the product rules: rates show their counts ("8 of 12"), engines are named, with their logo beside the name (ADR-DS-020), change colors follow the detectability rule, and rank charts keep the inverted axis with the Top 3 and Top 10 guides.

## Consequences

- `--shadow-inspector` changes from a left edge line to a floating shadow, and applies when docked too.
- The docked inspector takes 12 px more than before, so the main column is 12 px narrower at each docked width ([16-drawers-dialogs-popovers.md](../16-drawers-dialogs-popovers.md) section 2.6).
- A keyword shows 3 summary values in cards, with best rank as a note under Rank, where the key-value grid showed 4.
- Popups opened from inside the overlay inspector take its layer so they paint above it.
- Specified in 16 sections 2.1, 2.4 and 2.6; followed by 05, 06, 19, 23, 25 and reference/visual-spec.md.
