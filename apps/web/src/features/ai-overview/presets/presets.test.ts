/**
 * The presets of the AI visibility screen (WP-33 T6; inventory 9.5, final variants). The row tables below are
 * written out by hand from 9.5 and checked against `packRows`, so a preset that leaves a row part empty fails here.
 */
import { describe, expect, it } from 'vitest';
import {
  ENGINES,
  LIMITS,
  SCREENS,
  cardType,
  numberType,
  packRows,
  sanitizeLayout,
  type Breakpoint,
  type LayoutDocument,
} from '@/lib/layouts';
import {
  COMPETITIVE_LAYOUT,
  EXECUTIVE_LAYOUT,
  OVERVIEW_PRESET_LAYOUTS,
  PRESET_IDS,
  SEO_ANALYST_LAYOUT,
  TOPIC_OWNER_LAYOUT,
  buildOverviewPresets,
  type PresetId,
} from './presets';

const LABELS: Readonly<Record<PresetId, string>> = {
  executive: 'Executive summary',
  seo_analyst: 'SEO analyst',
  competitive: 'Competitive',
  topic_owner: 'Topic owner',
};

const ENGINE_CODES: readonly string[] = ENGINES.map((engine) => engine.code);

const NUMBER_ID_PREFIX: Readonly<Record<string, string>> = {
  'ai.prompts_in_scope': 'prompts',
  'ai.mention_rate': 'mention',
  'ai.citation_rate': 'citation',
  'ai.share_of_voice': 'sov',
  'ai.citation_share': 'citation-share',
};
const ENGINE_ID_SUFFIX: Readonly<Record<string, string>> = {
  chatgpt_web: 'chatgpt',
  gemini_web: 'gemini',
  google_ai_mode: 'ai-mode',
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
  /** The part empty rows 9.5 accepts, by 1 based row number. */
  acceptedWide: number[];
  acceptedMedium: number[];
}

const PACKINGS: readonly Packing[] = [
  {
    name: 'Default',
    document: SCREENS.ai_overview.builtin,
    wide: [[12], [8, 4], [4, 8], [6, 6], [6, 6]],
    medium: [[12], [12], [6, 6], [12], [6, 6], [6, 6]],
    acceptedWide: [],
    acceptedMedium: [],
  },
  {
    name: 'Executive summary',
    document: EXECUTIVE_LAYOUT,
    wide: [[12], [12], [6, 6], [6, 6]],
    medium: [[12], [12], [6, 6], [6, 6]],
    acceptedWide: [],
    acceptedMedium: [],
  },
  {
    name: 'SEO analyst',
    document: SEO_ANALYST_LAYOUT,
    wide: [
      [6, 6],
      [8, 4],
      [6, 6],
      [6, 6],
    ],
    medium: [[6, 6], [12], [6, 6], [6, 6], [6]],
    acceptedWide: [],
    acceptedMedium: [5],
  },
  {
    name: 'Competitive',
    document: COMPETITIVE_LAYOUT,
    wide: [[6, 6], [12], [6, 6], [8, 4], [4, 8]],
    medium: [[6, 6], [12], [6, 6], [12], [6, 6], [12]],
    acceptedWide: [],
    acceptedMedium: [],
  },
  {
    name: 'Topic owner',
    document: TOPIC_OWNER_LAYOUT,
    wide: [[12], [6, 6], [8, 4], [12], [6, 6]],
    medium: [[12], [6, 6], [12], [6], [12], [6, 6]],
    acceptedWide: [],
    acceptedMedium: [4],
  },
];

const PRESET_PACKINGS = PACKINGS.filter((packing) => packing.name !== 'Default');

describe('buildOverviewPresets', () => {
  const presets = buildOverviewPresets(LABELS);

  it('lists the four presets in the order of the Start from menu, with the labels it was given', () => {
    expect(PRESET_IDS).toEqual(['executive', 'seo_analyst', 'competitive', 'topic_owner']);
    expect(presets.map((preset) => preset.id)).toEqual([...PRESET_IDS]);
    expect(presets.map((preset) => preset.label)).toEqual([
      'Executive summary',
      'SEO analyst',
      'Competitive',
      'Topic owner',
    ]);
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

  it('has at most 12 cards and 6 numbers', () => {
    expect(document.cards?.length).toBeGreaterThan(0);
    expect(document.cards?.length).toBeLessThanOrEqual(LIMITS.cards);
    expect(document.numbers?.length).toBeGreaterThan(0);
    expect(document.numbers?.length).toBeLessThanOrEqual(LIMITS.numbers);
  });

  it('uses only card types that exist and list ai_overview in their screens', () => {
    for (const card of document.cards ?? []) {
      const type = cardType(card.type);
      expect(type, card.type).toBeDefined();
      expect(type?.screens, card.type).toContain('ai_overview');
      expect(type?.widths, card.type).toContain(card.width);
    }
  });

  it('names an engine the API accepts on every AI number, and none on Prompts', () => {
    for (const number of document.numbers ?? []) {
      const type = numberType(number.metric);
      expect(type, number.metric).toBeDefined();
      expect(type?.screens, number.metric).toContain('ai_overview');
      if (type?.perEngine) expect(ENGINE_CODES, number.id).toContain(number.engine);
      else expect(number.engine).toBeUndefined();
    }
  });

  it('ids its numbers the way the built-in layout does: prompts, mention-chatgpt, sov-ai-mode', () => {
    for (const number of document.numbers ?? []) {
      const prefix = NUMBER_ID_PREFIX[number.metric];
      const suffix = number.engine === undefined ? '' : `-${ENGINE_ID_SUFFIX[number.engine]}`;
      expect(number.id).toBe(`${prefix}${suffix}`);
    }
  });

  it('has unique card ids', () => {
    const ids = (document.cards ?? []).map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the built-in layout of ai_overview', () => {
  it('is the Default of 9.5: four numbers and nine cards in order', () => {
    const { numbers, cards } = SCREENS.ai_overview.builtin;
    expect(numbers?.map((number) => number.id)).toEqual([
      'prompts',
      'mention-chatgpt',
      'mention-gemini',
      'mention-ai-mode',
    ]);
    expect(cards?.map((card) => [card.type, card.width])).toEqual([
      ['ai.change_summary', 'full'],
      ['ai.rate_trend_by_engine', 'two_thirds'],
      ['ai.outcome_mix', 'third'],
      ['sources.top_domains', 'third'],
      ['ai.topic_heatmap', 'two_thirds'],
      ['ai.share_of_voice', 'half'],
      ['ai.competitor_trend', 'half'],
      ['activity.key_changes', 'half'],
      ['ai.opportunities', 'half'],
    ]);
    expect(cards?.[1]?.options).toEqual({ metric: 'mention' });
    expect(cards?.[5]?.options).toEqual({ engine: 'chatgpt_web', rows: '10' });
    expect(cards?.[6]?.options).toEqual({ engine: 'chatgpt_web', competitors: '3' });
  });

  it('is not one of the presets', () => {
    for (const document of Object.values(OVERVIEW_PRESET_LAYOUTS))
      expect(document).not.toEqual(SCREENS.ai_overview.builtin);
  });
});

describe('the presets of 9.5, as rows', () => {
  it.each(PACKINGS.map((packing) => [packing.name, packing] as const))(
    '%s packs as the table says',
    (_name, packing) => {
      expect(spansOf(packing.document, 'wide')).toEqual(packing.wide);
      expect(spansOf(packing.document, 'medium')).toEqual(packing.medium);
    },
  );

  it.each(PACKINGS.map((packing) => [packing.name, packing] as const))(
    '%s leaves no row part empty at wide or medium except the accepted ones',
    (_name, packing) => {
      expect(partEmptyRows(packing.document, 'wide')).toEqual(packing.acceptedWide);
      expect(partEmptyRows(packing.document, 'medium')).toEqual(packing.acceptedMedium);
    },
  );

  it('adds ai.sample_coverage and widens ai.co_mentions to two thirds in Competitive, so no half row is left alone', () => {
    const cards = COMPETITIVE_LAYOUT.cards ?? [];
    expect(cards.map((card) => [card.type, card.width])).toEqual([
      ['ai.share_of_voice', 'half'],
      ['ai.share_of_voice', 'half'],
      ['ai.competitor_trend', 'full'],
      ['ai.lost_to_competitor', 'half'],
      ['ai.competitor_table', 'half'],
      ['ai.sov_over_time', 'two_thirds'],
      ['sources.top_domains', 'third'],
      ['ai.sample_coverage', 'third'],
      ['ai.co_mentions', 'two_thirds'],
    ]);
  });
});

describe('the options of 9.5', () => {
  const optionsOf = (document: LayoutDocument, index: number): Record<string, string> | undefined =>
    document.cards?.[index]?.options;

  it('Executive summary: 3 facts, 5 share of voice rows, 3 strongest and weakest topics', () => {
    expect(optionsOf(EXECUTIVE_LAYOUT, 0)).toEqual({ facts: '3' });
    expect(optionsOf(EXECUTIVE_LAYOUT, 2)).toEqual({ engine: 'chatgpt_web', rows: '5' });
    expect(optionsOf(EXECUTIVE_LAYOUT, 3)).toEqual({ metric: 'mention', rows: '3' });
  });

  it('SEO analyst: 10 own pages, third party domains, 8 opportunities', () => {
    expect(optionsOf(SEO_ANALYST_LAYOUT, 0)).toEqual({ rows: '10' });
    expect(optionsOf(SEO_ANALYST_LAYOUT, 1)).toEqual({ role: 'third_party', rows: '10' });
    expect(optionsOf(SEO_ANALYST_LAYOUT, 6)).toEqual({ rows: '8' });
  });

  it('Competitive: competitor domains, Gemini share of voice', () => {
    expect(optionsOf(COMPETITIVE_LAYOUT, 1)).toEqual({ engine: 'gemini_web', rows: '10' });
    expect(optionsOf(COMPETITIVE_LAYOUT, 6)).toEqual({ role: 'competitor', rows: '8' });
  });

  it('Topic owner: the heat-map shows all levels and 20 rows, trends show 6 topics', () => {
    expect(optionsOf(TOPIC_OWNER_LAYOUT, 0)).toEqual({ metric: 'mention', rows: '20', level: 'all', sort: 'prompts' });
    expect(optionsOf(TOPIC_OWNER_LAYOUT, 5)).toEqual({ metric: 'mention', topics: '6' });
  });
});
