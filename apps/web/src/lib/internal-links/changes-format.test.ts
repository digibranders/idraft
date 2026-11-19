import { describe, expect, it } from 'vitest';

import {
  type AlertWords,
  alertText,
  alertTierText,
  depthMove,
  formatDelta,
  priorityTone,
  sinceText,
} from './changes-format';

const tierWords: AlertWords = {
  none: () => 'none',
  lost: (count, tiers) => `${count} lost to ${tiers}`,
  tierPair: (a, b) => `${a} and ${b}`,
  tierRange: (a, b) => `${a} to ${b}`,
};

describe('changes format', () => {
  it('names the important tiers through the words it is given', () => {
    expect(alertTierText(1, tierWords)).toBe('T1');
    expect(alertTierText(2, tierWords)).toBe('T1 and T2');
    expect(alertTierText(4, tierWords)).toBe('T1 to T4');
    expect(alertTierText(8, tierWords)).toBe('T1 to T8');
    expect(alertTierText(0, tierWords)).toBe('T1');
    expect(alertTierText(-3, tierWords)).toBe('T1');
    expect(alertTierText(Number.NaN, tierWords)).toBe('T1');
    expect(alertTierText(2.5, tierWords)).toBe('T1');
    expect(alertTierText(Number.POSITIVE_INFINITY, tierWords)).toBe('T1');
    expect(alertTierText(2, { ...tierWords, tierPair: (a, b) => `${a} et ${b}` })).toBe('T1 et T2');
  });

  it('tones a priority: T1 negative unless a menu still links it, T2 warning, the rest neutral', () => {
    expect(priorityTone('lost_to_t1', null)).toBe('negative');
    expect(priorityTone('lost_to_t1', 'navigation')).toBe('warning');
    expect(priorityTone('lost_to_t2', null)).toBe('warning');
    expect(priorityTone('lower', null)).toBe('neutral');
    expect(priorityTone('none', null)).toBe('neutral');
  });

  it('formats a change with its sign, and depth the other way round (deeper is worse)', () => {
    expect(formatDelta(2, 'in')).toEqual({ text: '+2', tone: 'positive' });
    expect(formatDelta(-3, 'in')).toEqual({ text: '−3', tone: 'negative' });
    expect(formatDelta(1200, 'in')).toEqual({ text: '+1,200', tone: 'positive' });
    expect(formatDelta(0, 'in')).toBeNull();
    expect(formatDelta(2, 'depth')).toEqual({ text: '+2', tone: 'negative' });
    expect(formatDelta(-1, 'depth')).toEqual({ text: '−1', tone: 'positive' });
    expect(formatDelta(null, 'in')).toBeNull();
    expect(formatDelta(Number.NaN, 'in')).toBeNull();
  });

  it('sizes a depth move, with levels only', () => {
    expect(depthMove({ depth_state: null, depth_delta: -3 })).toBe(3);
    expect(depthMove({ depth_state: null, depth_delta: 2 })).toBe(2);
    expect(depthMove({ depth_state: null, depth_delta: null })).toBe(0);
    expect(depthMove({ depth_state: 'lost', depth_delta: null })).toBe(0);
    expect(depthMove({ depth_state: 'found', depth_delta: 4 })).toBe(0);
  });

  it('says since when, in the project time zone, and never throws on a bad date', () => {
    expect(sinceText('2026-11-07T03:12:00Z', 'UTC')).toBe('7 Nov');
    expect(sinceText('2026-11-07T23:30:00Z', 'Asia/Kolkata')).toBe('8 Nov');
    expect(sinceText(null, 'UTC')).toBeNull();
    expect(sinceText('not a date', 'UTC')).toBeNull();
  });

  it('writes the alert sentence from its count and the tiers it covers', () => {
    const alert = { threshold: 1, max_position: 2, lost_links: 0 };
    expect(alertText(alert, tierWords)).toBe('none');
    expect(alertText({ ...alert, lost_links: 1 }, tierWords)).toBe('1 lost to T1 and T2');
    expect(alertText({ ...alert, lost_links: 12400, max_position: 4 }, tierWords)).toBe('12,400 lost to T1 to T4');
    expect(alertText({ ...alert, lost_links: 3, max_position: Number.NaN }, tierWords)).toBe('3 lost to T1');
  });

  it('says nothing for a time zone it does not know', () => {
    expect(sinceText('2026-11-07T03:12:00Z', 'Bad/Zone')).toBeNull();
  });
});
