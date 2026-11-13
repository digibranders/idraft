/**
 * Presets (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md, T9, owner decision D-01): built-in
 * layout documents that a person applies to the draft from the Start from menu. A preset is code, never a stored
 * layout: the person saves the result as their own layout, or as the team default, and the spec's one layout per
 * person per screen stays true.
 */
import { SCREENS, sanitizeLayout, type LayoutDocument, type ScreenKey } from '@/lib/layouts';

export interface LayoutPreset {
  /** Stable within the page's presets; never `builtin` or `team`, which the menu adds itself. */
  id: string;
  /** What the menu says, from the page's messages. */
  label: string;
  document: LayoutDocument;
}

/** The ids of the entries the menu adds itself. */
const RESERVED = ['builtin', 'team'] as const;

/**
 * Checks a page's presets once, when its module loads. A document that sanitizing would change (a typo in a card
 * type, a width the type does not allow) is a mistake in the page, so it fails the page's own test and never
 * reaches a person as a layout other than the one that was written.
 */
export function definePresets(screen: ScreenKey, presets: readonly LayoutPreset[]): readonly LayoutPreset[] {
  const seen = new Set<string>();
  for (const preset of presets) {
    if ((RESERVED as readonly string[]).includes(preset.id)) throw new Error(`Preset id ${preset.id} is reserved`);
    if (seen.has(preset.id)) throw new Error(`Preset id ${preset.id} is used twice`);
    seen.add(preset.id);
    if (sanitizeLayout(preset.document, screen).changed) {
      throw new Error(`Preset ${preset.id} is not a valid ${screen} layout`);
    }
  }
  return presets;
}

/** What the menu needs of the resolved layout: whether a team default exists, and its document. */
export interface PresetSource {
  teamDefaultExists: boolean;
  teamDocument: LayoutDocument | null;
}

export interface PresetLabels {
  builtin: string;
  team: string;
}

/**
 * The entries of the Start from menu: the built-in layout, the team default while one exists, then the presets of
 * the page in the order it gave them. The built-in layout is a copy, so applying it can never edit the catalog.
 */
export function presetItems(
  source: PresetSource,
  screen: ScreenKey,
  presets: readonly LayoutPreset[],
  labels: PresetLabels,
): LayoutPreset[] {
  return [
    { id: 'builtin', label: labels.builtin, document: structuredClone(SCREENS[screen].builtin) },
    ...(source.teamDefaultExists && source.teamDocument !== null
      ? [{ id: 'team', label: labels.team, document: source.teamDocument }]
      : []),
    ...presets,
  ];
}
