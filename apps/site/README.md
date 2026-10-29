# idraft.ai marketing site

A static Next.js site, separate from the product app in `apps/web`. Light theme only.

```bash
pnpm --dir apps/site dev      # http://localhost:3100
pnpm --dir apps/site lint
pnpm --dir apps/site typecheck
pnpm --dir apps/site build
```

## Design language

- Colors and type come from the product tokens (`apps/web/src/styles/tokens.css`): paper `#F7F8FA`, ink `#14171C`, one cobalt accent `#1E65E3`, Geist Sans and Geist Mono.
- Shape rule: buttons are full pills; cards are a 32px outer shell with a 6px bezel and a concentric inner radius.
- The idea is the staircase (the rank ladder). It appears as the brand mark, the hero image, the climbing chart in the pinned story, the rungs on the page edge that light as you scroll, and the lifting wordmark in the footer.
- Motion is limited to the places where it says something: the hero entrance and tilt (hierarchy and depth), the pinned story (storytelling), the reveals (reading order), the card spotlight (feedback), the footer wordmark (delight, once). Everything honors `prefers-reduced-motion`.
- Illustrative charts say so on the chart. There are no invented customers, quotes or numbers.

## Images

`public/images/*.png` were generated with the `agy` CLI (see prompts in the git history of this folder). Replace any of them in place; the layout does not depend on their content, only on their aspect ratios (hero 3:2, lens 1:1, sources 4:3, contour 16:9).

## Links

The call to action opens an email to `hello@idraft.ai` until there is an access request form. `Sign in` goes to `https://app.idraft.ai`.
