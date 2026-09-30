/**
 * Which layout a person sees (spec section 6.3): their own, else the team default, else the built-in default.
 * Whatever is chosen is sanitized, so a stale or damaged stored document still produces a usable page.
 */
import { SCREENS } from './catalog';
import { isLayoutDocument, sanitizeLayout } from './sanitize';
import type { LayoutDocument, LayoutSource, ScreenKey } from './types';

export interface StoredLayouts {
  /** The person's own layout for this screen; null or undefined when they have not customized. */
  personal: unknown;
  /** The workspace's team default for this screen; null or undefined when no admin has set one. */
  team: unknown;
}

export interface ResolvedLayout {
  source: LayoutSource;
  document: LayoutDocument;
}

/**
 * A stored value that is not a layout document at all (null, text, another schema) counts as absent, so the
 * next source is used. A broken personal layout must not hide the team default behind the built-in one.
 */
export function resolveLayout(stored: StoredLayouts, screen: ScreenKey): ResolvedLayout {
  if (isLayoutDocument(stored.personal))
    return { source: 'personal', document: sanitizeLayout(stored.personal, screen).document };
  if (isLayoutDocument(stored.team)) return { source: 'team', document: sanitizeLayout(stored.team, screen).document };
  return { source: 'builtin', document: structuredClone(SCREENS[screen].builtin) };
}

/** What "Reset to default" returns to: the team default when one exists, otherwise the built-in default. */
export function defaultLayout(team: unknown, screen: ScreenKey): ResolvedLayout {
  return resolveLayout({ personal: null, team }, screen);
}
