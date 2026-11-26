import { describe, expect, it } from 'vitest';

import { assistantName, referralBars, referralsStanding, type ReferralsResponse } from './referrals-model';

const META: ReferralsResponse['meta'] = {
  connected: true,
  collected_through: '2026-11-11',
  collected_since: '2026-08-28',
  last_success_at: null,
  window: { from: '2026-10-15', to: '2026-11-11', timezone: 'UTC' },
  compare_window: null,
  window_collected: true,
  rules_version: 1,
  lower_bound: true,
  notes: [],
};
const ROW: ReferralsResponse['data'][number] = {
  key: 'chatgpt',
  own_rules: { sessions: 5, engaged_sessions: 3, key_events: null, previous: null },
  ga4_ai_assistant_channel: null,
  difference: null,
};

const standing = (data: ReferralsResponse['data'], meta: Partial<ReferralsResponse['meta']>): string =>
  JSON.stringify(referralsStanding({ data, meta: { ...META, ...meta } }));

describe('referralsStanding, the one place that tells a zero from visits not collected', () => {
  it('is not connected, not collected, or a real zero only when the route says the period is collected in full', () => {
    expect(standing([], { connected: false, collected_through: null, window_collected: false })).toBe(
      '{"kind":"not_connected"}',
    );
    expect(standing([], { collected_through: null, window_collected: false })).toBe('{"kind":"not_collected"}');
    expect(standing([], { window_collected: true })).toBe('{"kind":"zero"}');
  });

  it('is never a zero when the period is not collected in full, whatever the last collected day is', () => {
    expect(standing([], { collected_through: '2026-11-10', window_collected: false })).toBe(
      '{"kind":"before_period_end","through":"2026-11-10"}',
    );
    // The first collected day is after the start of the period: the days before it were never read
    expect(standing([], { collected_since: '2026-11-01', window_collected: false })).toBe(
      '{"kind":"before_period_end","through":"2026-11-11"}',
    );
  });

  it('shows rows, and says how far they are collected only when the period is not collected in full', () => {
    expect(standing([ROW], {})).toBe('{"kind":"rows","through":null}');
    expect(standing([ROW], { collected_through: '2026-11-03', window_collected: false })).toBe(
      '{"kind":"rows","through":"2026-11-03"}',
    );
  });
});

describe('referralBars', () => {
  it('orders by the visits of the chosen classifier, then by name, and leaves out a classifier with no count', () => {
    const rows: ReferralsResponse['data'] = [
      ROW,
      { ...ROW, key: 'gemini', own_rules: { sessions: 9, engaged_sessions: 3, key_events: null, previous: null } },
      {
        ...ROW,
        key: 'claude',
        own_rules: null,
        ga4_ai_assistant_channel: { sessions: 7, engaged_sessions: 1, key_events: null, previous: null },
      },
      // An unknown count is left out of the bars, never drawn as 0
      { ...ROW, key: 'grok', own_rules: { sessions: null, engaged_sessions: null, key_events: null, previous: null } },
    ];
    expect(referralBars(rows, 'own_rules').map((bar) => bar.name)).toEqual(['Gemini', 'ChatGPT']);
    expect(referralBars(rows, 'ga4_ai_assistant_channel').map((bar) => bar.name)).toEqual(['Claude']);
  });

  it('keeps an unknown previous unknown, never 0', () => {
    expect(referralBars([ROW], 'own_rules')[0]?.previous).toBeNull();
  });
});

describe('assistantName', () => {
  it('uses the fixed names and title-cases a code it does not know', () => {
    expect(assistantName('meta_ai')).toBe('Meta AI');
    expect(assistantName('chatgpt')).toBe('ChatGPT');
    expect(assistantName('new_assistant')).toBe('New Assistant');
  });
});
