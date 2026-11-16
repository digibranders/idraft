'use client';

import { useEffect } from 'react';

import { namesSeveralPlatforms, normalizeEngines, type ScopePatch } from './scope-model';

export interface PlatformLinkFallbackInput {
  /** The engines the address names, as the scope model read them. */
  linked: readonly string[] | null;
  /** The platforms that are on; empty until they are known. */
  enabled: readonly string[];
  setScope: (patch: ScopePatch) => void;
}

/**
 * An old link names several platforms (`engine=a,b`), which the page's one Platform select cannot hold. The scope
 * already reads it as All platforms; this writes that back to the address and returns `true` once, so the page can
 * say so. A link that names every platform that is on already meant All platforms, so it is tidied without a word. A
 * link that also names a platform that is off is left to the filter bar's own check, which drops that one and says so.
 * It holds no words itself: it is read where the provider has no translations (a card's test).
 */
export function usePlatformLinkFallback({ linked, enabled, setScope }: PlatformLinkFallbackInput): boolean {
  // What the project has on is needed to tell "every platform" from "several"
  const several =
    linked !== null &&
    namesSeveralPlatforms({ engines: linked }) &&
    enabled.length > 0 &&
    linked.every((code) => enabled.includes(code));
  const said = several && normalizeEngines(linked, enabled) !== null;
  useEffect(() => {
    if (several) setScope({ engines: null });
  }, [several, setScope]);
  return said;
}
