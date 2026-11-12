import { Globe } from 'lucide-react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import {
  CHANGE_FEED_MAX,
  countNewItems,
  groupChangeFeed,
  type ChangeFeedGroup,
  type ChangeFeedItem,
} from './feed-model';

function item(id: string, group: ChangeFeedGroup, at: string): ChangeFeedItem {
  return { id, group, at, glyph: Globe, text: `Item ${id}`, href: '/x' as Route };
}

const names = (items: readonly { id: string }[]): string[] => items.map((entry) => entry.id);

describe('groupChangeFeed', () => {
  it('orders the groups as needs attention, changes, notices and leaves empty groups out', () => {
    const sections = groupChangeFeed([
      item('n1', 'notices', '2026-09-01T10:00:00Z'),
      item('c1', 'changes', '2026-09-01T10:00:00Z'),
      item('a1', 'needs_attention', '2026-09-01T10:00:00Z'),
    ]);
    expect(sections.map((section) => section.group)).toEqual(['needs_attention', 'changes', 'notices']);
    expect(groupChangeFeed([item('n1', 'notices', '2026-09-01T10:00:00Z')]).map((section) => section.group)).toEqual([
      'notices',
    ]);
    expect(groupChangeFeed([])).toEqual([]);
  });

  it('puts the newest first inside a group, comparing instants and not strings', () => {
    const sections = groupChangeFeed([
      item('old', 'changes', '2026-09-01T10:00:00Z'),
      // 11:00 at +05:00 is 06:00 UTC: older than 10:00 UTC although the string sorts later
      item('offset', 'changes', '2026-09-01T11:00:00+05:00'),
      item('new', 'changes', '2026-09-02T00:00:00Z'),
    ]);
    expect(names(sections[0]?.items ?? [])).toEqual(['new', 'old', 'offset']);
  });

  it('breaks a tie by id and puts an unreadable instant last', () => {
    const sections = groupChangeFeed([
      item('b', 'changes', '2026-09-01T10:00:00Z'),
      item('bad', 'changes', 'not a date'),
      item('a', 'changes', '2026-09-01T10:00:00Z'),
    ]);
    expect(names(sections[0]?.items ?? [])).toEqual(['a', 'b', 'bad']);
  });

  it('takes at most 8 items across the groups, in group order', () => {
    expect(CHANGE_FEED_MAX).toBe(8);
    const many = [
      ...Array.from({ length: 3 }, (_, index) => item(`a${String(index)}`, 'needs_attention', '2026-09-01T10:00:00Z')),
      ...Array.from({ length: 4 }, (_, index) => item(`c${String(index)}`, 'changes', '2026-09-01T10:00:00Z')),
      ...Array.from({ length: 5 }, (_, index) => item(`n${String(index)}`, 'notices', '2026-09-01T10:00:00Z')),
    ];
    const sections = groupChangeFeed(many);
    expect(sections.map((section) => section.items.length)).toEqual([3, 4, 1]);
  });

  it('honours a custom max and a max of zero', () => {
    const many = [
      item('a1', 'needs_attention', '2026-09-01T10:00:00Z'),
      item('a2', 'needs_attention', '2026-09-01T11:00:00Z'),
      item('c1', 'changes', '2026-09-01T10:00:00Z'),
    ];
    const sections = groupChangeFeed(many, 2);
    expect(sections).toHaveLength(1);
    expect(names(sections[0]?.items ?? [])).toEqual(['a2', 'a1']);
    expect(groupChangeFeed(many, 0)).toEqual([]);
  });
});

describe('countNewItems', () => {
  it('counts the items whose id was not there before', () => {
    expect(countNewItems(new Set(['a', 'b']), [{ id: 'a' }, { id: 'c' }, { id: 'd' }])).toBe(2);
    expect(countNewItems(new Set(), [{ id: 'a' }])).toBe(1);
    expect(countNewItems(new Set(['a']), [])).toBe(0);
  });
});
