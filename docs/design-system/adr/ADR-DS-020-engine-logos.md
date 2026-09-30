# ADR-DS-020: Engine logos beside engine names

Status: accepted, 2026-09-30. Replaces the "no engine or vendor logos in V1" rule of ADR-DS-004 and 07-icons.md section 5.

## Context

Engines were text-only, for two reasons: logo use can need trademark permission, and logos add noise in dense tables. After the inspector was rebuilt as a card drawer (ADR-DS-019), the product owner asked for the engine logos that the reference drawer shows. In a list of four engines, the marks are faster to scan than four similar words.

Lucide has no brand icons. Simple Icons has no OpenAI mark. `@lobehub/icons-static-svg` (MIT, 2.4 MB) has full-color marks for every engine we track.

## Decision

1. `EngineLogo` renders the vendor's mark at 16 px, immediately left of the engine's name. It never appears alone, so the image is decorative and the name stays the label.
2. Marks come from `@lobehub/icons-static-svg` at a pinned version (1.95.1). It is a dev dependency of `apps/web`; only the marks in use are bundled. No other component may import it.
3. Marks are not recolored, cropped or placed on colored tiles. The OpenAI mark is monochrome and follows the text color.
4. Google AI Mode and Google AI Overview both use the Google mark.
5. Logos appear in engine lists and engine columns. They do not appear in chart legends (the series color dot is the key) or in the column headers of dense keyword tables.
6. `EngineLogo` takes a `hidden` prop, and `EngineBadge` a `logo` prop, so logos can be switched off in one place.

## Consequences

- One more dependency, used by one component.
- Two engines share a mark; their names tell them apart.
- The marks are trademarks of their owners. Using a mark to name the product it belongs to is ordinary practice, but each vendor publishes brand guidelines: these must be checked before public launch, and rule 6 is the fallback if any vendor objects.

## Revisit trigger

A vendor objects to the use of its mark, a tracked engine has no mark in the package, or Google ships distinct marks for AI Mode and AI Overview.
