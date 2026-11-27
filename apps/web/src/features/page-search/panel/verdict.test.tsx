import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Verdict, type VerdictProps } from './verdict';
import type { PageHealth, PageNumbers } from '../types';
import { renderWithProviders } from '@/test/render';

const numbers = (clicks: number, impressions: number, position: number | null = 5): PageNumbers => ({
  clicks,
  impressions,
  ctr: impressions === 0 ? null : clicks / impressions,
  position,
});

const health = (verdict: PageHealth['verdict'], patch: Partial<PageHealth> = {}): PageHealth => ({
  verdict,
  basis: 'clicks',
  change: null,
  absolute: 0,
  small: false,
  flags: [],
  ...patch,
});

const WINDOW = { from: '2026-10-01', to: '2026-10-31', days: 31 };
const COMPARE = { from: '2026-09-01', to: '2026-09-30', days: 30 };

function show(patch: Partial<VerdictProps> & Pick<VerdictProps, 'health'>): void {
  renderWithProviders(
    <Verdict
      current={numbers(317, 41_200)}
      previous={numbers(412, 39_000)}
      window={WINDOW}
      compareWindow={COMPARE}
      {...patch}
    />,
  );
}

describe('Verdict', () => {
  it.each<[string, VerdictProps['health'], Partial<VerdictProps>, string, string]>([
    [
      'lost',
      health('lost'),
      { current: numbers(0, 900) },
      'Lost traffic',
      'Lost all search traffic: no clicks, against 412 in Sep 1 to Sep 30, 2026.',
    ],
    [
      'sharp_drop',
      health('sharp_drop', { change: -0.55 }),
      {},
      'Sharp drop',
      'Clicks are down 55% (412 to 317) against Sep 1 to Sep 30, 2026.',
    ],
    [
      'declining on impressions',
      health('declining', { change: -0.26, basis: 'impressions' }),
      { current: numbers(317, 29_000), previous: numbers(412, 39_000) },
      'Declining',
      'Impressions are down 26% (39,000 to 29,000) against Sep 1 to Sep 30, 2026.',
    ],
    [
      'growing',
      health('growing', { change: 0.4 }),
      {},
      'Growing',
      'Clicks are up 40% (412 to 317) against Sep 1 to Sep 30, 2026.',
    ],
    [
      'growing from nothing',
      health('growing', { change: null }),
      { previous: numbers(0, 0, null) },
      'Growing',
      'Clicks are up from none to 317 against Sep 1 to Sep 30, 2026.',
    ],
    [
      'stable',
      health('stable', { change: 0.01 }),
      {},
      'Stable',
      'Clicks are steady (412 to 317) against Sep 1 to Sep 30, 2026.',
    ],
    [
      'stable without a comparison',
      health('stable'),
      { previous: null, compareWindow: null },
      'Stable',
      '317 clicks and 41,200 impressions in Oct 1 to Oct 31, 2026.',
    ],
    [
      'new',
      health('new'),
      { current: numbers(12, 900), previous: numbers(0, 0, null) },
      'New',
      'New in search: 12 clicks, none in Sep 1 to Sep 30, 2026.',
    ],
    [
      'low data',
      health('low_data'),
      { current: numbers(2, 40), previous: numbers(1, 30) },
      'Not enough data',
      'Too little traffic to judge: 3 clicks and 70 impressions over both periods.',
    ],
    [
      'small numbers',
      health('low_data', { small: true, change: 1 }),
      { current: numbers(2, 40), previous: numbers(1, 30) },
      'Not enough data',
      'Small numbers: Clicks went from 1 to 2, too few to count as a real change.',
    ],
    [
      'no data',
      health('no_data'),
      { current: numbers(0, 0, null) },
      'Not collected yet',
      'Google reported no impressions for this page in this period.',
    ],
  ])('says the %s verdict in a sentence', (_name, verdictHealth, patch, badge, sentence) => {
    show({ health: verdictHealth, ...patch });
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('does not say both periods when the page has no numbers to compare with', () => {
    show({ health: health('low_data'), current: numbers(2, 40), previous: null });
    expect(
      screen.getByText('Too little traffic to judge: 2 clicks and 40 impressions in Oct 1 to Oct 31, 2026.'),
    ).toBeInTheDocument();
  });

  it('adds one sentence per flag', () => {
    show({
      health: health('declining', { change: -0.2, flags: ['position_slipped', 'ctr_fell_impressions_rose'] }),
      current: numbers(317, 41_200, 5.9),
      previous: numbers(412, 39_000, 3.8),
    });
    expect(screen.getByText('Average position slipped 2.1 places.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Impressions rose but fewer people clicked. Check the title and the snippet, and whether an AI answer now sits above the result.',
      ),
    ).toBeInTheDocument();
  });

  it('says the position improved when it did', () => {
    show({
      health: health('growing', { change: 0.3, flags: ['position_improved'] }),
      current: numbers(500, 41_200, 3.8),
      previous: numbers(412, 39_000, 5.9),
    });
    expect(screen.getByText('Average position improved 2.1 places.')).toBeInTheDocument();
  });

  it('says the counts are per day only when the two periods differ in length', () => {
    const per = 'Counted per day, because the two periods differ in length.';
    show({ health: health('declining', { change: -0.2 }) });
    expect(screen.getByText(per)).toBeInTheDocument();
  });

  it('leaves the per day note out when the periods have the same length', () => {
    show({ health: health('declining', { change: -0.2 }), compareWindow: { ...COMPARE, days: 31 } });
    expect(screen.queryByText(/Counted per day/)).not.toBeInTheDocument();
  });
});
