'use client';

import { useSyncExternalStore } from 'react';

import { useMediaQuery } from '@/lib/dom/use-media-query';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The in-app setting: `ApplyPreferences` puts `data-motion="reduced"` on `<html>`, which tokens.css turns into zero durations. */
function subscribeToSetting(notify: () => void): () => void {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    observer.disconnect();
  };
}
const settingIsOn = (): boolean => document.documentElement.dataset.motion === 'reduced';

/**
 * Whether the person asked for less motion, in the operating system or in the app's own setting. CSS follows both
 * through the duration tokens; what runs in script (the drop animation of a drag, the scroll to a card that took
 * focus) asks here.
 */
export function useReducedMotion(): boolean {
  const system = useMediaQuery(REDUCED_MOTION);
  const setting = useSyncExternalStore(subscribeToSetting, settingIsOn, () => false);
  return system || setting;
}
