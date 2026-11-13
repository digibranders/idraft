import { act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLayoutAnnouncer, type LayoutAnnouncer } from './announcements';
import { announce } from '@/lib/a11y/announcer';
import type * as Announcer from '@/lib/a11y/announcer';
import { renderWithProviders } from '@/test/render';

/** The real announcer, watched: the live region still gets every message. */
vi.mock('@/lib/a11y/announcer', async (importOriginal) => {
  const original = await importOriginal<typeof Announcer>();
  return { ...original, announce: vi.fn(original.announce) };
});

let latest: LayoutAnnouncer | null = null;

function Probe(): null {
  const announcer = useLayoutAnnouncer();
  useEffect(() => {
    latest = announcer;
  }, [announcer]);
  return null;
}

const current = (): LayoutAnnouncer => {
  if (latest === null) throw new Error('The probe has not rendered');
  return latest;
};

const polite = (): string => document.getElementById('live-region-polite')?.textContent ?? '';

beforeEach(() => {
  latest = null;
  vi.mocked(announce).mockClear();
});

const CASES: ReadonlyArray<readonly [string, (announcer: LayoutAnnouncer) => void, string]> = [
  [
    'pickedUp',
    (a) => {
      a.pickedUp('Top movers');
    },
    'Top movers picked up. Use the arrow keys to move, Space to drop, Escape to put it back.',
  ],
  [
    'over',
    (a) => {
      a.over({ card: 'Top movers', position: 3, total: 12, row: 2 });
    },
    'Top movers, position 3 of 12, row 2',
  ],
  [
    'overGap',
    (a) => {
      a.overGap({ card: 'Top movers', row: 4 });
    },
    'Top movers, empty space in row 4',
  ],
  [
    'first',
    (a) => {
      a.first('Top movers');
    },
    'Top movers is already first',
  ],
  [
    'last',
    (a) => {
      a.last('Top movers');
    },
    'Top movers is already last',
  ],
  [
    'dropped',
    (a) => {
      a.dropped({ card: 'Top movers', position: 1, total: 8 });
    },
    'Top movers dropped at position 1 of 8',
  ],
  [
    'putBack',
    (a) => {
      a.putBack('Top movers');
    },
    'Top movers put back',
  ],
  [
    'moved',
    (a) => {
      a.moved({ card: 'Top movers', position: 2, total: 8 });
    },
    'Top movers, position 2 of 8',
  ],
  [
    'hidden',
    (a) => {
      a.hidden('SEO and AI matrix');
    },
    'SEO and AI matrix hidden. Add it back from the catalog.',
  ],
  [
    'width of two thirds',
    (a) => {
      a.width({ card: 'Rank distribution', width: 'two_thirds' });
    },
    'Rank distribution width: Two thirds',
  ],
  [
    'width of half',
    (a) => {
      a.width({ card: 'Rank distribution', width: 'half' });
    },
    'Rank distribution width: Half',
  ],
  [
    'option',
    (a) => {
      a.option({ card: 'Top movers', option: 'Rows', value: '10 rows' });
    },
    'Top movers: Rows 10 rows',
  ],
  [
    'added',
    (a) => {
      a.added({ card: 'Top movers', position: 9, total: 9 });
    },
    'Top movers added, position 9 of 9',
  ],
  [
    'entered',
    (a) => {
      a.entered('Overview');
    },
    'Customizing Overview. Drag cards to reorder, or use the Move menu of each card.',
  ],
  [
    'undone',
    (a) => {
      a.undone();
    },
    'Change undone',
  ],
  [
    'redone',
    (a) => {
      a.redone();
    },
    'Change redone',
  ],
  [
    'saved',
    (a) => {
      a.saved();
    },
    'Layout saved',
  ],
  [
    'say',
    (a) => {
      a.say('Reset to the team default');
    },
    'Reset to the team default',
  ],
];

describe('useLayoutAnnouncer', () => {
  it.each(CASES)('speaks %s through the polite live region', async (_name, speak, text) => {
    renderWithProviders(<Probe />);
    act(() => {
      speak(current());
    });
    await waitFor(() => {
      expect(polite()).toBe(text);
    });
  });

  it('speaks every message under one key, so a debounced newer one replaces an older one that is waiting', () => {
    renderWithProviders(<Probe />);
    act(() => {
      current().undone();
      current().say('Reset to the team default');
    });
    expect(announce).toHaveBeenNthCalledWith(1, 'Change undone', { key: 'layouts' });
    expect(announce).toHaveBeenNthCalledWith(2, 'Reset to the team default', { key: 'layouts' });
  });

  it('keeps one announcer for as long as the messages do not change', () => {
    const { rerender } = renderWithProviders(<Probe />);
    const first = current();
    rerender(<Probe />);
    expect(current()).toBe(first);
  });
});
