# ADR-DS-021: Customizable layouts from a catalog of cards

Status: accepted, 2026-09-30.

## Context

Every person saw the same Overview and the same inspector. The product owner asked for per-account customization: a person should be able to hide a card they do not use (Rank distribution was the example), add others, and arrange them. The specification is [the layout customization design](../../superpowers/specs/2026-09-30-layout-customization-design.md).

Three shapes were considered for each of the main choices.

| Choice | Options | Chosen |
|---|---|---|
| Who owns a layout | One per workspace; one per person; one per person with a team default | Per person, with a team default an owner or admin can save |
| What can be added | A catalog of ready-made cards; a catalog now and a builder later; a card builder | A catalog. No builder |
| Layout freedom | Show, hide and reorder; reorder plus preset widths; a free canvas | Reorder plus four preset widths |
| Scope | Per project; per workspace; per workspace with per-project exceptions | Per workspace: one layout in every project |

## Decision

1. Dashboard pages, headline number strips and the inspector's Overview tab are rendered from a **layout document**: an ordered list of cards (type, width, options) and numbers (metric, engine).
2. Cards and numbers come from a **catalog in code**. A card type is a reviewed component that owns its query, formatting, denominators and method note. People choose which cards to show and a few enum options; they never choose how a number is computed.
3. A stored layout is a **full snapshot**, not a diff against a default. Resolution is personal, else team default, else built-in. Whatever is resolved is **sanitized** against the catalog, so a stale or damaged document still renders.
4. Card options name **global things only** (an engine, a row count), never a project's own competitor or topic. That is what lets one layout work in every project.
5. Layout is a **12-column grid with four widths** (4, 6, 8, 12). Cards flow in order and are never stretched. Heights belong to the card type.
6. Editing happens **in place** in customize mode, with a catalog dialog and a save bar. Every drag has a menu and a keyboard equivalent.
7. Limits: 12 cards and 6 numbers per screen.

## Reasons

- A catalog keeps the data rules true on every possible page: no rate without its counts, no pooled AI value, no chart without its method. A builder would let people make misleading cards, and would multiply the states to design and test.
- Preset widths in a flow grid always produce a tidy page, work at every breakpoint without a second layout, and are fully usable from the keyboard. A free canvas needs a separate phone layout and lets charts become too small to read.
- Snapshots make reading a layout one lookup with no merge, and mean a change to the built-in default cannot silently rearrange a page someone set up.
- One layout per workspace suits agencies with many projects: arrange once.

## Consequences

- Panels must adapt to their own width with container queries, not viewport breakpoints: a half-width card on a wide screen is narrow.
- Page templates describe built-in defaults. "At most 5 major sections" binds defaults, not customized pages.
- New storage, routes and one permission key (`layouts:manage`): docs/04 section 11.6a, docs/19 section 3.11.5c, docs/24 section 3.2.
- A new card type is a product decision with a design review, not a configuration change.
- Not included, and possible later without changing the document format: a card builder, several named layouts, per-project overrides, editing on phones.

## Revisit trigger

Customers ask for cards the catalog cannot express more than occasionally, or for different layouts per project.
