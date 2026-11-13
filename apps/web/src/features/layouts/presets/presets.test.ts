import { describe, expect, it } from 'vitest';

import { definePresets, presetItems, type LayoutPreset } from './presets';
import { SCREENS, type LayoutDocument } from '@/lib/layouts';

const EXECUTIVE: LayoutDocument = {
  schema: 1,
  numbers: [{ id: 'visibility', metric: 'seo.visibility_volume' }],
  cards: [
    { id: 'trend', type: 'trend.visibility_mentions', width: 'full' },
    { id: 'matrix', type: 'cross.matrix_summary', width: 'half' },
    { id: 'opportunities', type: 'cross.opportunities', width: 'half', options: { rows: '5' } },
  ],
};
const SEO_FOCUS: LayoutDocument = {
  schema: 1,
  numbers: [{ id: 'top10', metric: 'seo.top10_count' }],
  cards: [{ id: 'ranks', type: 'seo.rank_distribution', width: 'half' }],
};

const LABELS = { builtin: 'Built-in default', team: 'Team default' };
const TEAM: LayoutDocument = { schema: 1, numbers: [], cards: [{ id: 't1', type: 'ai.by_engine', width: 'full' }] };

describe('definePresets', () => {
  it('keeps documents that sanitize unchanged for the screen', () => {
    const presets = definePresets('overview', [
      { id: 'executive', label: 'Executive summary', document: EXECUTIVE },
      { id: 'seo', label: 'SEO focus', document: SEO_FOCUS },
    ]);
    expect(presets.map((preset) => preset.id)).toEqual(['executive', 'seo']);
    expect(presets[0]?.document).toEqual(EXECUTIVE);
  });

  it('throws on a document that sanitizing would change', () => {
    // A typo in a card type: the person would see a layout other than the one written, so the page's test fails
    const typo: LayoutDocument = {
      ...EXECUTIVE,
      cards: [{ id: 'trend', type: 'trend.visibility_mention', width: 'full' }],
    };
    expect(() => definePresets('overview', [{ id: 'executive', label: 'Executive summary', document: typo }])).toThrow(
      'Preset executive is not a valid overview layout',
    );
  });

  it('throws on a width the card type does not allow', () => {
    const wide: LayoutDocument = {
      ...EXECUTIVE,
      cards: [{ id: 'ranks', type: 'seo.rank_distribution', width: 'full' }],
    };
    expect(() => definePresets('overview', [{ id: 'wide', label: 'Wide', document: wide }])).toThrow(
      'Preset wide is not a valid overview layout',
    );
  });

  it('throws on an id used twice, and on the ids of the built-in and team entries', () => {
    const twice: LayoutPreset[] = [
      { id: 'a', label: 'A', document: EXECUTIVE },
      { id: 'a', label: 'B', document: SEO_FOCUS },
    ];
    expect(() => definePresets('overview', twice)).toThrow('Preset id a is used twice');
    expect(() => definePresets('overview', [{ id: 'builtin', label: 'A', document: EXECUTIVE }])).toThrow(
      'Preset id builtin is reserved',
    );
    expect(() => definePresets('overview', [{ id: 'team', label: 'A', document: EXECUTIVE }])).toThrow(
      'Preset id team is reserved',
    );
  });
});

describe('presetItems', () => {
  const presets = definePresets('overview', [
    { id: 'executive', label: 'Executive summary', document: EXECUTIVE },
    { id: 'seo', label: 'SEO focus', document: SEO_FOCUS },
  ]);

  it('lists Built-in default, Team default when one exists, then the presets of the page in order', () => {
    const items = presetItems({ teamDefaultExists: true, teamDocument: TEAM }, 'overview', presets, LABELS);
    expect(items.map((item) => item.label)).toEqual([
      'Built-in default',
      'Team default',
      'Executive summary',
      'SEO focus',
    ]);
    expect(items[0]?.document).toEqual(SCREENS.overview.builtin);
    expect(items[1]?.document).toEqual(TEAM);
  });

  it('leaves Team default out while no team default exists', () => {
    const items = presetItems({ teamDefaultExists: false, teamDocument: null }, 'overview', presets, LABELS);
    expect(items.map((item) => item.label)).toEqual(['Built-in default', 'Executive summary', 'SEO focus']);
  });

  it('gives a copy of the built-in layout, so choosing it can never edit the catalog', () => {
    const [builtin] = presetItems({ teamDefaultExists: false, teamDocument: null }, 'overview', [], LABELS);
    expect(builtin?.document).not.toBe(SCREENS.overview.builtin);
  });
});
