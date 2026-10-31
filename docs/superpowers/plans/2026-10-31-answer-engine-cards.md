# Answer engine card refresh

**Goal:** Replace the oversized, sparse answer-engine panels with compact illustrated cards that work on phones and desktops.

**Design:** Keep the site's Geist typography, cream surfaces, cobalt accent, real engine logos, and existing engine illustrations. Group each logo with its engine category, place a substantial illustration immediately below, and finish with the title and description. Show illustrations at every viewport width. Use a four-column desktop grid, a two-column tablet grid, and a native scroll-snap row with the next card peeking in on phones. Remove this section's pinned horizontal scroll because all four cards fit on desktop.

**Architecture:** Keep the existing `HorizontalEngines` export and page composition. Static card data stays in the component. Remove its GSAP lifecycle and refs; use CSS for responsive layout and native touch scrolling. Reuse existing artwork without changing other sections that consume it. No new dependencies or product claims.

## Implementation

- [x] Update `apps/site/src/components/horizontal-engines.tsx`: introduce compact card headers, visible full-width art, closely grouped copy, responsive grid/scroll-snap, and mobile swipe guidance.
- [x] Update `apps/site/src/app/globals.css`: remove the obsolete engine pin-spacer background rule.
- [x] Inspect the live section at 375px, 390px, 768px, 1024px, and 1440px; verify artwork, legible copy, native swipe, keyboard access, reduced motion, and no page overflow. Save phone and desktop previews.
- [x] Run the site's required checks: `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- [x] Review the final diff for scope, types, semantics, responsiveness, and unintended changes.

## Verification notes

## Follow-up: restore the horizontal story

Latest sizing direction: enlarge the pinned desktop cards to 34–42rem wide, with taller viewport-aware artwork and larger titles/body copy. Keep the approved vertical card composition, compact internal spacing, original illustrations, mobile sizing, and static fallbacks. Verify that cards still fit a 640px-high desktop viewport and that the last card remains reachable.

The user prefers the original scroll-driven desktop presentation. Preserve the redesigned vertical cards and mobile swipe row. On desktop with normal motion and sufficient viewport height, pin the section and move the introduction and four cards horizontally with GSAP. Apply the horizontal layout only after initialization, so reduced motion, short viewports, and disabled JavaScript retain the accessible static layout. Revert the layout attribute and animation on breakpoint changes/unmount. Verify desktop movement, the final card, mobile swipe, reduced motion, resizing, and the required lint, TypeScript, and build checks.

- Independent review approved the scoped implementation.
- The accessibility scan identified the existing AI Mode prompt bubble's white-on-violet contrast as 4.34:1. Change its background to the existing cobalt token in `apps/site/src/components/art/illustrations.tsx`. This illustration is used only in this section.
- At 320px the redesigned section fits the viewport; the existing Roles section elsewhere on the page overflows. That unrelated section is outside this change.

**Testing scope:** This is a reversible presentation change. Use real browser layout and interaction checks rather than adding unit tests for markup or CSS.
