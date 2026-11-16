'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';

import { namesSeveralPlatforms, normalizeEngines, type ScopePatch } from './scope-model';
import { toast } from '@/components/ui/toast';

export interface PlatformLinkFallbackInput {
  /** The engines the address names, as the scope model read them. */
  linked: readonly string[] | null;
  /** The platforms that are on; empty until they are known. */
  enabled: readonly string[];
  setScope: (patch: ScopePatch) => void;
}

/**
 * An old link names several platforms (`engine=a,b`), which the page's one Platform select cannot hold. The scope
 * already reads it as All platforms; this writes that back to the address and says so once. A link that names
 * every platform that is on already meant All platforms, so it is tidied without a word. A link that also names a
 * platform that is off is left to the filter bar's own check, which drops that one and says so.
 */
export function usePlatformLinkFallback({ linked, enabled, setScope }: PlatformLinkFallbackInput): void {
  const t = useTranslations('aiOverview.shell');
  const said = useRef<string | null>(null);
  useEffect(() => {
    // What the project has on is needed to tell "every platform" from "several"
    if (linked === null || !namesSeveralPlatforms({ engines: linked }) || enabled.length === 0) return;
    if (!linked.every((code) => enabled.includes(code))) return;
    setScope({ engines: null });
    const key = linked.join(',');
    if (normalizeEngines(linked, enabled) === null || said.current === key) return;
    said.current = key;
    toast({ type: 'info', title: t('severalPlatformsTitle'), description: t('severalPlatformsDescription') });
  }, [linked, enabled, setScope, t]);
}
