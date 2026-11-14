import { describe, expect, it } from 'vitest';

import { parseScope } from './scope-model';
import { drillHref, type DrillKind } from '@/features/ai-overview/drilldown/drill-links';
import type { OverviewScope } from '@/features/ai-overview/scope/scope-model';

/**
 * The links the Overview's cards write to this page (`drillHref('competitors', ...)`), read back by this page's own
 * parser: a rename of a key on either side fails here and not for the person who follows a link.
 */

const TOPIC = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b';
const ALL = ['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const;
const PROJECT = { workspace: 'acme', project: 'eventus' };

function overviewScope(patch: Partial<OverviewScope> = {}): OverviewScope {
  return {
    range: { from: '2026-10-16', to: '2026-11-12', days: 28 },
    rangeValue: { kind: 'preset', preset: '28d' },
    compare: true,
    previous: { from: '2026-09-18', to: '2026-10-15' },
    country: null,
    engines: null,
    topic: null,
    branded: 'excluded',
    ...patch,
  };
}

/** The address the page would be opened at, as the keys `parseScope` and the range parser read. */
function query(kind: DrillKind, scope: OverviewScope, engine?: string): Record<string, string | null> {
  const href = drillHref(kind, scope, engine === undefined ? {} : { engine }, PROJECT);
  if (href === null) throw new Error('The competitors page is not a live destination');
  expect(new URL(href, 'http://localhost').pathname).toBe('/acme/eventus/competitors');
  const search = new URL(href, 'http://localhost').searchParams;
  return Object.fromEntries(
    ['win', 'from', 'to', 'cmp', 'country', 'engine', 'topic', 'branded', 'tab'].map((key) => [key, search.get(key)]),
  );
}

describe('the Overview links to the Competitors page', () => {
  it('a link with no narrowing opens the default scope', () => {
    const search = query('competitors', overviewScope());
    expect(parseScope(search, ALL)).toMatchObject({
      tab: 'comparison',
      compare: true,
      country: null,
      engines: [],
      topic: null,
      branded: 'excluded',
    });
  });

  it('narrowed engines, country, topic, branded, cmp off and a custom range are read back into the same scope', () => {
    const search = query(
      'competitors',
      overviewScope({
        rangeValue: { kind: 'custom', from: '2026-10-01', to: '2026-10-20' },
        range: { from: '2026-10-01', to: '2026-10-20', days: 20 },
        compare: false,
        country: 'DE',
        engines: ['gemini_web', 'chatgpt_web'],
        topic: TOPIC,
        branded: 'included',
      }),
    );
    expect(search.from).toBe('2026-10-01');
    expect(search.to).toBe('2026-10-20');
    expect(parseScope(search, ALL)).toMatchObject({
      compare: false,
      country: 'DE',
      engines: ['gemini_web', 'chatgpt_web'],
      topic: TOPIC,
      branded: 'included',
    });
  });

  it('a preset window is carried as win', () => {
    expect(query('competitors', overviewScope()).win).toBeNull();
    const search = query('competitors', overviewScope({ rangeValue: { kind: 'preset', preset: '90d' } }));
    expect(search.win).toBe('90d');
  });

  it("an engine's own number opens that engine as the engine in scope", () => {
    const search = query('competitors', overviewScope({ engines: ['chatgpt_web', 'gemini_web'] }), 'google_ai_mode');
    const read = parseScope(search, ALL);
    expect(read.engines).toEqual(['google_ai_mode']);
    expect(read.engineScope).toEqual(['google_ai_mode']);
    expect(read.eng).toBe('google_ai_mode');
  });
});
