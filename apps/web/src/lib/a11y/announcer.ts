/**
 * Speaks a message to screen readers without moving focus (20-accessibility.md section 10.1): the result
 * of an action, a count after a filter change, an error that appears away from the focused control.
 * Components never create live regions of their own; they call `announce`.
 */
export type Politeness = 'polite' | 'assertive';

export interface AnnounceOptions {
  /** `assertive` interrupts, so it is for errors that block the person. Default `polite`. */
  politeness?: Politeness;
  /** Messages about the same thing share a key: a newer one replaces an older one that is still waiting. */
  key?: string;
  /** Wait this long before speaking, so a value that changes quickly (a selection count) is spoken once. */
  debounceMs?: number;
}

/** The two live regions `LiveRegions` renders once, at the root of the app. */
export const LIVE_REGION_ID: Readonly<Record<Politeness, string>> = {
  polite: 'live-region-polite',
  assertive: 'live-region-assertive',
};

/** A region is emptied this long after a message, so the same text can be announced again later. */
const CLEAR_AFTER_MS = 1_000;
/** When the region still holds the same text, it is emptied first and filled after this pause: a change is what gets announced. */
const REPEAT_PAUSE_MS = 50;

const waiting = new Map<string, number>();
const clearing = new Map<Politeness, number>();

function cancel<Key>(timers: Map<Key, number>, key: Key): void {
  const timer = timers.get(key);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  timers.delete(key);
}

function speak(message: string, politeness: Politeness): void {
  const region = document.getElementById(LIVE_REGION_ID[politeness]);
  if (!region) return;
  cancel(clearing, politeness);
  const write = (): void => {
    region.textContent = message;
    clearing.set(
      politeness,
      window.setTimeout(() => {
        region.textContent = '';
        clearing.delete(politeness);
      }, CLEAR_AFTER_MS),
    );
  };
  if (region.textContent !== message) {
    write();
    return;
  }
  region.textContent = '';
  clearing.set(politeness, window.setTimeout(write, REPEAT_PAUSE_MS));
}

export function announce(message: string, { politeness = 'polite', key, debounceMs = 0 }: AnnounceOptions = {}): void {
  if (message.trim() === '') return;
  // Without a key, messages of one politeness are about "the last thing that happened" and replace each other
  const slot = `${politeness}:${key ?? ''}`;
  cancel(waiting, slot);
  if (debounceMs <= 0) {
    speak(message, politeness);
    return;
  }
  waiting.set(
    slot,
    window.setTimeout(() => {
      waiting.delete(slot);
      speak(message, politeness);
    }, debounceMs),
  );
}
