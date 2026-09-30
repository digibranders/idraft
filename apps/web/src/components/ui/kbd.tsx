'use client';

import { createContext, use, useSyncExternalStore, type ComponentProps, type ReactElement } from 'react';

import { cn } from '@/lib/utils';

type Platform = 'mac' | 'other';
type PerPlatform = Readonly<Record<Platform, string>>;
interface KeyNames {
  /** What the key cap shows: glyphs on macOS, words elsewhere (09-buttons-controls.md section 11). */
  cap: PerPlatform;
  /** What a screen reader says. */
  spoken: PerPlatform;
  /** The name `aria-keyshortcuts` expects: a UI Events `KeyboardEvent.key` value. */
  aria: PerPlatform;
  modifier: boolean;
}
const same = (value: string): PerPlatform => ({ mac: value, other: value });
const named = (cap: PerPlatform, spoken: PerPlatform, aria: PerPlatform, modifier = false): KeyNames => ({
  cap,
  spoken,
  aria,
  modifier,
});

const KEYS: Readonly<Record<string, KeyNames>> = {
  mod: named(
    { mac: '⌘', other: 'Ctrl' },
    { mac: 'Command', other: 'Control' },
    { mac: 'Meta', other: 'Control' },
    true,
  ),
  ctrl: named({ mac: '⌃', other: 'Ctrl' }, same('Control'), same('Control'), true),
  alt: named({ mac: '⌥', other: 'Alt' }, { mac: 'Option', other: 'Alt' }, same('Alt'), true),
  shift: named({ mac: '⇧', other: 'Shift' }, same('Shift'), same('Shift'), true),
  enter: named({ mac: '↵', other: 'Enter' }, same('Enter'), same('Enter')),
  esc: named(same('Esc'), same('Escape'), same('Escape')),
  tab: named(same('Tab'), same('Tab'), same('Tab')),
  space: named(same('Space'), same('Space'), same('Space')),
  backspace: named({ mac: '⌫', other: 'Backspace' }, same('Backspace'), same('Backspace')),
  delete: named(same('Del'), same('Delete'), same('Delete')),
  home: named(same('Home'), same('Home'), same('Home')),
  end: named(same('End'), same('End'), same('End')),
  pageup: named(same('PgUp'), same('Page up'), same('PageUp')),
  pagedown: named(same('PgDn'), same('Page down'), same('PageDown')),
  up: named(same('↑'), same('Up arrow'), same('ArrowUp')),
  down: named(same('↓'), same('Down arrow'), same('ArrowDown')),
  left: named(same('←'), same('Left arrow'), same('ArrowLeft')),
  right: named(same('→'), same('Right arrow'), same('ArrowRight')),
  '+': named(same('+'), same('Plus'), same('Plus')),
};
const FUNCTION_KEY = /^f([1-9]|1[0-2])$/;

function namesOf(key: string): KeyNames {
  const id = key.toLowerCase();
  const known = KEYS[id];
  if (known) return known;
  // A function key is written in upper case everywhere. A printable character is shown in upper case and
  // named in lower case for `aria-keyshortcuts`, which is how the key is reported without Shift.
  const upper = key.toUpperCase();
  return FUNCTION_KEY.test(id)
    ? named(same(upper), same(upper), same(upper))
    : named(same(upper), same(upper), same(id));
}

const subscribe = (): (() => void) => () => undefined;
const clientPlatform = (): Platform => (/mac|iphone|ipad/i.test(navigator.userAgent) ? 'mac' : 'other');
const serverPlatform = (): Platform => 'other';
/** The server renders the words. A Mac switches to the glyphs when it hydrates, without a mismatch warning. */
const usePlatform = (): Platform => useSyncExternalStore(subscribe, clientPlatform, serverPlatform);

/** A shortcut that is one printable character, such as `/` or `f`: what WCAG 2.1.4 is about. `F2` and `Esc` are not. */
function isSingleKey(keys: readonly string[]): boolean {
  const id = keys.length === 1 ? keys[0]?.toLowerCase() : undefined;
  return id !== undefined && KEYS[id] === undefined && !FUNCTION_KEY.test(id);
}

/**
 * Whether single-key shortcuts are on (20-accessibility.md section 14, WCAG 2.1.4). The preference lives
 * with the account settings; they provide it here so a hint never shows a shortcut that is switched off.
 */
export const SingleKeyShortcutsContext = createContext(true);

/**
 * The value for `aria-keyshortcuts` of the element that owns the shortcut: `['mod', 'k']` is "Control+k" or
 * "Meta+k". A sequence of two keys pressed one after the other (`['g', 'k']`) cannot be written in that
 * attribute, so it gives `undefined`.
 */
export function useAriaKeyShortcuts(keys: readonly string[] | undefined): string | undefined {
  const platform = usePlatform();
  if (!keys || keys.length === 0) return undefined;
  const names = keys.map(namesOf);
  if (names.filter((name) => !name.modifier).length !== 1) return undefined;
  return names.map((name) => name.aria[platform]).join('+');
}

export interface KbdProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Platform-neutral key ids: `['mod', 'k']`, `['/']`, `['shift', 'f10']`. */
  keys: readonly string[];
  /** `respect-setting` hides a single-character hint while single-key shortcuts are switched off. */
  singleKey?: 'always' | 'respect-setting' | undefined;
  /** Inside an interactive element the hint is hidden from assistive technology: the element carries `aria-keyshortcuts`. */
  decorative?: boolean | undefined;
}

/** A keyboard shortcut as key caps. A screen reader hears the key names, not the glyphs. */
export function Kbd({
  keys,
  singleKey = 'respect-setting',
  decorative = false,
  className,
  ...props
}: KbdProps): ReactElement | null {
  const platform = usePlatform();
  const singleKeysOn = use(SingleKeyShortcutsContext);
  if (keys.length === 0 || (singleKey === 'respect-setting' && !singleKeysOn && isSingleKey(keys))) return null;
  const names = keys.map(namesOf);
  return (
    <span
      data-slot="kbd"
      aria-hidden={decorative || undefined}
      {...props}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {names.map((name, index) => (
        <kbd
          // A sequence may repeat a key (`g g`), so the position is part of the key
          key={`${String(index)}:${name.aria[platform]}`}
          aria-hidden="true"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface-subtle px-1 type-kbd text-foreground-secondary"
        >
          {name.cap[platform]}
        </kbd>
      ))}
      <span className="sr-only">{names.map((name) => name.spoken[platform]).join(' ')}</span>
    </span>
  );
}
