# AI visibility engine section refresh

**Goal:** Replace the sparse three-card engine section on `/ai-visibility` with the site's established illustrated engine presentation.

**Design direction:** Reuse the homepage's large rounded cards, original engine illustrations, official logos, cream/cobalt palette, and Geist type. Show Google AI Overviews and Google AI Mode separately, alongside ChatGPT and Gemini. Keep scroll-driven horizontal storytelling on desktop, native swiping on mobile, and the reduced-motion grid. This applies the same visual language the user approved elsewhere on the site.

**Implementation:** Add an optional `withWaves` prop to `HorizontalEngines`, defaulting to `true` to preserve the homepage. Wrap its two decorative section waves conditionally. Replace the AI visibility page's duplicated three-card markup and data with `<HorizontalEngines withWaves={false} />`. Remove the page's unused `Image` import. Keep page metadata, hero, capability list, closing statement, and CTA intact. No new dependencies, raster assets, or parallel design system.

**Verification:** Run site lint, TypeScript, and production build. Check the AI page at 375px, 390px, 768px, 1024px, and 1440px, all four engine labels and visible illustrations, native swipe/keyboard access, completion of the desktop sequence, and reduced motion. Verify the homepage still has both waves and the existing card sequence. Run an accessibility scan on the refreshed section, review the scoped diff, and save mobile/desktop previews.
