import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { previousText, runsNote, scopeText } from './board-text';
import messages from '../../../messages/en.json';
import type { Schemas } from '@/lib/api/types';

const t = createTranslator({ locale: 'en', messages, namespace: 'citations' });
const ZONE = 'Europe/Berlin';
const LATEST = '2026-09-28T00:15:00.000Z';
/** Weekly slots, slot 1 on Sep 28 back to slot 8 on Aug 10, at 02:10 Berlin time. */
const DAYS = ['09-28', '09-21', '09-14', '09-07', '08-31', '08-24', '08-17', '08-10'];
const slot = (n: number): Schemas['RunSlot'] => ({
  slot: n,
  first_at: `2026-${DAYS[n - 1] ?? ''}T00:10:00.000Z`,
  last_at: `2026-${DAYS[n - 1] ?? ''}T00:15:00.000Z`,
  answers: 10,
});
const TREND = [8, 7, 6, 5, 4, 3, 2, 1].map(slot);

describe('the words of the Citations scope', () => {
  it('notes each Runs choice from the trend slots (C 116)', () => {
    expect(runsNote(4, TREND, ZONE, LATEST, t)).toBe('28 days');
    expect(runsNote(2, TREND, ZONE, LATEST, t)).toBe('Sep 21 to Sep 28');
    expect(runsNote(1, TREND, ZONE, LATEST, t)).toBe('Sep 28');
  });

  it('names the slots that exist when there are fewer than the choice', () => {
    expect(runsNote(2, [slot(1)], ZONE, LATEST, t)).toBe('Sep 28');
    expect(runsNote(4, [slot(2), slot(1)], ZONE, LATEST, t)).toBe('14 days');
    expect(runsNote(4, [], ZONE, LATEST, t)).toBeNull();
  });

  it('says what every change compares with (C 99 to 104)', () => {
    expect(previousText(4, [5, 6, 7, 8].map(slot), ZONE, LATEST, t)).toEqual({
      full: 'the previous 4 runs (Aug 10 to Aug 31)',
      short: 'the previous 4 runs',
    });
    expect(previousText(2, [3, 4].map(slot), ZONE, LATEST, t).full).toBe('the 2 runs before (Sep 7 to Sep 14)');
    expect(previousText(1, [slot(2)], ZONE, LATEST, t).full).toBe('the run before (Sep 21)');
    expect(previousText(4, [], ZONE, LATEST, t)).toEqual({ full: 'the previous 4 runs', short: 'the previous 4 runs' });
  });

  it('writes the scope of the empty states (C 106 to 108)', () => {
    expect(scopeText({ platform: 'ChatGPT', group: 'Pricing', runs: 2 }, t)).toBe('ChatGPT, Pricing, Last 2 runs');
  });
});
