/**
 * The presets of the AI visibility screen (the redesign of 2026-11-16; `design-preview/aiov-layout.js`). The row
 * tables below are written out by hand from the preview and checked against `packRows`, so a preset that leaves a row
 * part empty at 1280 px fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  SCREENS,
  cardType,
  packRows,
  sanitizeLayout,
  type Breakpoint,
  type LayoutDocument,
} from '@/lib/layouts';
import {
  ANALYST_LAYOUT,
  COMPETITIVE_LAYOUT,
  EXECUTIVE_LAYOUT,
  OVERVIEW_PRESET_LAYOUTS,
  PRESET_IDS,
  buildOverviewPresets,
  type PresetId,
} from './presets';

const LABELS: Readonly<Record<PresetId, string>> = {
  executive: 'Executive',
  analyst: 'Analyst',
  competitive: 'Competitive',
};

const spansOf = (document: LayoutDocument, breakpoint: Breakpoint): number[][] =>
  packRows(document.cards ?? [], breakpoint).map((row) => row.map((placed) => placed.span));

/** Row numbers (1 based) whose cards do not fill the 12 columns. */
const partEmptyRows = (document: LayoutDocument, breakpoint: Breakpoint): number[] =>
  spansOf(document, breakpoint).flatMap((row, index) => (row.reduce((a, b) => a + b, 0) < 12 ? [index + 1] : []));

interface Packing {
  name: string;
  document: LayoutDocument;
  wide: number[][];
  medium: number[][];
  /** The part empty rows at 768 to 1279 px, by 1 based row number: a third takes half of the row there. The preview accepts them. */
  acceptedMedium: number[];
}

const PACKINGS: readonly Packing[] = [
  {
    name: 'Default',
    document: SCREENS.ai_overview.builtin,
    wide: [[12], [8, 4], [6, 6], [12], [4, 4, 4], [8, 4]],
    medium: [[12], [12], [6, 6], [6], [12], [6, 6], [6], [12], [6]],
    acceptedMedium: [4, 7, 9],
  },
  {
    name: 'Executive',
    document: EXECUTIVE_LAYOUT,
    wide: [[12], [8, 4], [6, 6], [8, 4], [6, 6], [12]],
    medium: [[12], [12], [6, 6], [6], [12], [6, 6], [6], [12]],
    acceptedMedium: [4, 7],
  },
  {
    name: 'Analyst',
    document: ANALYST_LAYOUT,
    wide: [[12], [8, 4], [6, 6], [6, 6], [12], [6, 6], [12]],
    medium: [[12], [12], [6, 6], [6, 6], [6], [12], [6, 6], [12]],
    acceptedMedium: [5],
  },
  {
    name: 'Competitive',
    document: COMPETITIVE_LAYOUT,
    wide: [[12], [8, 4], [6, 6], [12], [6, 6], [6, 6]],
    medium: [[12], [12], [6, 6], [6], [12], [6, 6], [6, 6]],
    acceptedMedium: [4],
  },
];

const PRESET_PACKINGS = PACKINGS.filter((packing) => packing.name !== 'Default');

describe('buildOverviewPresets', () => {
  const presets = buildOverviewPresets(LABELS);

  it('lists the three presets in the order of the Start from menu, with the labels it was given', () => {
    expect(PRESET_IDS).toEqual(['executive', 'analyst', 'competitive']);
    expect(presets.map((preset) => preset.id)).toEqual([...PRESET_IDS]);
    expect(presets.map((preset) => preset.label)).toEqual(['Executive', 'Analyst', 'Competitive']);
    expect(presets.map((preset) => preset.document)).toEqual(PRESET_PACKINGS.map((packing) => packing.document));
  });

  it('has unique ids and labels, and none is builtin or team', () => {
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length);
    expect(new Set(presets.map((preset) => preset.label)).size).toBe(presets.length);
    for (const preset of presets) expect(['builtin', 'team']).not.toContain(preset.id);
  });

  it('has no Default entry: the built-in layout is the Default', () => {
    expect(Object.keys(OVERVIEW_PRESET_LAYOUTS).sort()).toEqual([...PRESET_IDS].sort());
  });
});

describe.each(PRESET_PACKINGS.map((packing) => [packing.name, packing.document] as const))('%s', (_name, document) => {
  it('sanitizes unchanged for ai_overview', () => {
    expect(sanitizeLayout(document, 'ai_overview')).toEqual({ document, changed: false });
  });

  it('has the headline first, at most 12 cards and no numbers', () => {
    expect(document.cards?.[0]?.type).toBe('ai.visibility_split');
    expect(document.cards?.length).toBeLessThanOrEqual(LIMITS.cards);
    expect(document.numbers).toEqual([]);
  });

  it('uses only card types that exist and list ai_overview in their screens', () => {
    for (const card of document.cards ?? []) {
      const type = cardType(card.type);
      expect(type, card.type).toBeDefined();
      expect(type?.screens, card.type).toContain('ai_overview');
      expect(type?.widths, card.type).toContain(card.width);
    }
  });

  it('has unique card ids', () => {
    const ids = (document.cards ?? []).map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the built-in layout of ai_overview', () => {
  it('is the Default of the preview: eleven cards in order', () => {
    const { cards } = SCREENS.ai_overview.builtin;
    expect(cards?.map((card) => card.type)).toEqual([
      'ai.visibility_split',
      'ai.rate_trend_by_engine',
      'ai.outcome_mix',
      'ai.share_of_voice',
      'ai.lost_to_competitor',
      'ai.topic_heatmap',
      'sources.top_domains',
      'ai.position_distribution',
      'ai.sentiment_by_engine',
      'traffic.ai_referrals',
      'ai.fanout_top',
    ]);
  });

  it('is not one of the presets', () => {
    for (const document of Object.values(OVERVIEW_PRESET_LAYOUTS))
      expect(document).not.toEqual(SCREENS.ai_overview.builtin);
  });
});

describe('the presets, as rows', () => {
  it.each(PACKINGS.map((packing) => [packing.name, packing] as const))(
    '%s packs as the table says',
    (_name, packing) => {
      expect(spansOf(packing.document, 'wide')).toEqual(packing.wide);
      expect(spansOf(packing.document, 'medium')).toEqual(packing.medium);
    },
  );

  it.each(PACKINGS.map((packing) => [packing.name, packing] as const))(
    '%s fills every row at 1280 px, and at 768 to 1279 px leaves only the accepted rows part empty',
    (_name, packing) => {
      expect(partEmptyRows(packing.document, 'wide')).toEqual([]);
      expect(partEmptyRows(packing.document, 'medium')).toEqual(packing.acceptedMedium);
    },
  );
});

describe('the options of the presets', () => {
  const optionsOf = (document: LayoutDocument, type: string): Record<string, string> | undefined =>
    document.cards?.find((card) => card.type === type)?.options;

  it('open the trend and the heat map on AI Visibility', () => {
    for (const document of Object.values(OVERVIEW_PRESET_LAYOUTS)) {
      expect(optionsOf(document, 'ai.rate_trend_by_engine')).toEqual({ metric: 'visibility' });
    }
    expect(optionsOf(EXECUTIVE_LAYOUT, 'ai.topic_heatmap')).toEqual({
      metric: 'visibility',
      rows: '10',
      level: 'top',
      sort: 'prompts',
    });
  });

  it('keep the competitor cards free of an engine', () => {
    for (const document of Object.values(OVERVIEW_PRESET_LAYOUTS))
      for (const card of document.cards ?? []) expect(card.options?.engine, card.type).toBeUndefined();
  });
});
