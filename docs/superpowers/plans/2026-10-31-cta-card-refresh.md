# Closing CTA card refresh

**Goal:** Replace the sparse blue closing banner with a purposeful illustrated composition while preserving its request-access action and existing page copy.

**Design:** Keep the site typography, cobalt palette, cream surfaces, pill buttons, and concentric card corners. Group the heading, optional paragraph, and button in one left column. Place a bespoke tactile illustration of a ranking staircase, magnifying glass, and answer bubble in a cream right panel, captioned “Search rankings + AI answers.” On phones, show the copy and button before the artwork. Remove the oversized blurred background blobs.

**Scope:** Update only the shared `apps/site/src/components/cta-band.tsx` component and add `apps/site/public/images/scenes/cta-together.webp`. Do not alter the engine-card work or CTA destinations. Keep the title/body props and all consuming pages compatible.

**Implementation:** Generate the illustration using the built-in image-generation tool, inspect and save an optimized WebP in the project, then build the semantic responsive layout using the existing `Button` and `Reveal` components. Use an empty image alt because the illustration is decorative; the visible caption conveys the meaning. Keep this a server component with an explicit return type. No new dependencies.

**Validation:** Check home CTA at 375px, 390px, 768px, 1024px, and 1440px; include the longest title and a page without body copy. Confirm the image loads, text fits, the Request access link resolves to `/request-access`, keyboard focus is visible, and section accessibility scans pass. Run `npm run lint`, `npx tsc --noEmit`, and `npm run build` from `apps/site`, review the scoped diff, and save mobile/desktop screenshots.

**Image prompt:** A premium tactile 3D still life on transparency: an ivory paper ranking staircase, cobalt magnifying glass, ivory answer bubble with three cobalt dots at the top, and a small amber sphere. Orthographic three-quarter studio rendering, soft shadows, no text or logos. Generated with the built-in image tool.
