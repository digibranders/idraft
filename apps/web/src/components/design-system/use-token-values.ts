'use client';

import { useSyncExternalStore } from 'react';

/** Tells React when the theme class on `<html>` changes, which is when every token may have a new value. */
function subscribe(notify: () => void): () => void {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
const themeClass = (): string => document.documentElement.className;
/** On the server there is no stylesheet to read, so the first render shows no values. */
const noTheme = (): null => null;

/**
 * Reads custom properties of the document as the browser resolves them in the current theme:
 * `read('surface')` gives the declared value of `--surface`, with any `var()` inside it resolved. It gives
 * an empty string on the server, before hydration, and where no stylesheet is loaded.
 */
export function useTokenValues(): (name: string) => string {
  const theme = useSyncExternalStore(subscribe, themeClass, noTheme);
  if (theme === null) return () => '';
  const styles = getComputedStyle(document.documentElement);
  return (name) => styles.getPropertyValue(`--${name}`).trim();
}
