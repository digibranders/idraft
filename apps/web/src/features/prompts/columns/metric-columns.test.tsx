import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { projectEngine } from '../compare/change-test-data';
import { groupVolumeOf, promptVolumeOf, type FactsRow, type LinkedKeywordVolume, type PromptIntent } from '../facts';
import { cellOf, engine, rowOf } from '../facts/test-helpers';
import { intentColumn } from './intent-column';
import { metricColumns } from './metric-columns';
import type { MetricContext } from './metric-shared';
import { positionColumn } from './position-column';
import { recommendationColumn } from './recommendation-column';
import { sentimentColumn } from './sentiment-column';
import { shareOfVoiceColumn } from './sov-column';
import { volumeColumn } from './volume-column';
import messages from '../../../../messages/en.json';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { EngineSummary, ProjectEngine, Schemas } from '@/lib/api/types';

afterEach(cleanup);

const t = createTranslator({ locale: 'en', messages });

type Code = Schemas['EngineCode'];
const CHAT: Code = 'chatgpt_web';
const GEMINI: Code = 'gemini_web';
const AI_MODE: Code = 'google_ai_mode';

/** The API has no Google AI Overview platform yet, so the test builds one the way the real list will. */
const overview = (): ProjectEngine => {
  const base = projectEngine(CHAT);
  // The code type is the API's: the platform is not in it yet
  return {
    ...base,
    engine: { ...base.engine, engine_code: 'google_ai_overview' as Code, label: 'Google AI Overview' },
  };
};

const contextOf = (...scope: readonly string[]): MetricContext => ({
  t,
  locale: 'en',
  engines: scope.map((code) => (code === 'google_ai_overview' ? overview() : projectEngine(code as Code))),
  scope,
});

interface Shown {
  text: string;
  tip: string | undefined;
  /** The cell's markup, for what the text does not say (the bar, the pill). */
  container: HTMLElement;
}

/** What a cell shows and what its tooltip says. */
function show<TRow>(column: DataTableColumn<TRow>, row: TRow): Shown {
  cleanup();
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {column.cell(row)}
    </NextIntlClientProvider>,
  );
  const tip = column.cellTip?.(row);
  return {
    text: container.textContent ?? '',
    tip: tip === undefined ? undefined : [tip.content, tip.detail].filter((part) => part !== undefined).join('. '),
    container,
  };
}

const link = (keyword: string, volume: number | null): LinkedKeywordVolume => ({ keyword, search_volume: volume });

interface Row {
  facts: FactsRow | undefined;
  link?: LinkedKeywordVolume | null | undefined;
  cells?: readonly EngineSummary[] | undefined;
  intent?: PromptIntent | undefined;
}
const rows = {
  facts: (row: Row): FactsRow | undefined => row.facts,
  link: (row: Row): LinkedKeywordVolume | null | undefined => row.link,
  cells: (row: Row): readonly EngineSummary[] | undefined => row.cells,
};

describe('intentColumn', () => {
  const column = intentColumn<Row>(t, (row) => row.intent);

  it('is a letter badge named by the intent, with who searches like that in the tooltip', () => {
    const shown = show(column, { facts: undefined, intent: 'commercial' });
    expect(shown.text).toBe('C');
    expect(screen.getByRole('listitem', { name: 'Commercial intent' })).toBeTruthy();
    expect(shown.tip).toBe('Commercial: Searchers who are comparing products or services before they buy.');
    expect(column.header).toBe('Intent');
    expect(column.headerTooltip).toBe('What the asker wants: to learn, to choose, to buy or to find a brand');
  });

  it('gives each of the five intents its own letter', () => {
    const letters = (['informational', 'commercial', 'transactional', 'navigational', 'local'] as const).map(
      (intent) => show(column, { facts: undefined, intent }).text,
    );
    expect(letters).toEqual(['I', 'C', 'T', 'N', 'L']);
    expect(show(column, { facts: undefined, intent: 'navigational' }).tip).toBe(
      'Navigational: Searchers who are looking for a specific brand or site.',
    );
  });

  it('is n/a with its reason when the prompt has no intent, and sorts last', () => {
    expect(show(column, { facts: undefined, intent: 'unknown' })).toMatchObject({
      text: 'n/a',
      tip: 'This prompt has no intent yet',
    });
    expect(show(column, { facts: undefined, intent: undefined }).tip).toBe('Not collected yet');
    expect(column.sortValue?.({ facts: undefined, intent: 'unknown' })).toBeNull();
    expect(column.sortValue?.({ facts: undefined, intent: 'commercial' })).toBe('commercial');
  });
});

describe('volumeColumn', () => {
  const column = volumeColumn<Row>(t, (row) => promptVolumeOf(row.link));

  it('is the grouped monthly searches of the linked keyword', () => {
    const shown = show(column, { facts: undefined, link: link('crm software', 1190) });
    expect(shown.text).toBe('1,190');
    expect(shown.tip).toBe('Monthly searches of “crm software”, the keyword this prompt is linked to');
    expect(column.header).toBe('Search volume');
    expect(shown.tip).not.toContain('Sample');
  });

  it('says why there is no figure and never shows 0', () => {
    expect(show(column, { facts: undefined, link: null })).toMatchObject({
      text: 'n/a',
      tip: 'No linked keyword. Volume is the monthly searches of the keyword a prompt is linked to.',
    });
    expect(show(column, { facts: undefined, link: link('crm', null) })).toMatchObject({
      text: 'Fetching',
      tip: "The linked keyword's search volume is being collected and shows here once it arrives",
    });
    expect(show(column, { facts: undefined, link: undefined }).tip).toBe('Not collected yet');
    expect(column.sortValue?.({ facts: undefined, link: null })).toBeNull();
    expect(column.sortValue?.({ facts: undefined, link: link('crm', 90) })).toBe(90);
  });

  it('sums the keywords of a group, each once, and says when it is a lower bound', () => {
    const groups = volumeColumn<readonly (LinkedKeywordVolume | null | undefined)[]>(t, (links) =>
      groupVolumeOf(links),
    );
    const shown = show(groups, [link('a', 100), link('a', 100), link('b', 250), null, link('c', null)]);
    expect(shown.text).toBe('350');
    expect(shown.tip).toBe(
      'Monthly searches of 3 linked keywords across 5 prompts, each keyword counted once. 1 of them has no volume yet, so the total is a lower bound',
    );
    expect(show(groups, [null, null]).tip).toBe('No prompt in this group has a linked keyword');
    expect(show(groups, [link('a', null)]).text).toBe('Fetching');
  });
});

describe('positionColumn', () => {
  const chat = positionColumn<Row>(contextOf(CHAT), rows);
  const both = positionColumn<Row>(contextOf(CHAT, GEMINI), rows);
  const position = (rank_sum: number, ordered_answers: number, mentions: number, answers: number) => ({
    rank_sum,
    ordered_answers,
    mentions,
    answers,
  });

  it('is the mean over the ordered answers with one decimal, and lower sorts first', () => {
    const row: Row = { facts: rowOf(engine(CHAT, { position: position(9, 4, 6, 10) })) };
    const shown = show(chat, row);
    expect(shown.text).toBe('2.3');
    expect(shown.tip).toBe('ChatGPT: 4 ordered answers of 6 mentions. 1 means mentioned first, so lower is better.');
    expect(chat.sortValue?.(row)).toBe(2.25);
    expect(chat.header).toBe('Mention position');
    expect(chat.defaultVisible).toBe(true);
  });

  it('averages the platforms with equal weight and names them', () => {
    const row: Row = {
      facts: rowOf(
        engine(CHAT, { position: position(2, 2, 3, 10) }),
        engine(GEMINI, { position: position(30, 10, 12, 10) }),
      ),
    };
    expect(show(both, row).text).toBe('2.0');
    expect(show(both, row).tip).toBe(
      'Equal-weight average of ChatGPT and Gemini, each from its own ordered answers. 12 ordered answers of 15 mentions. 1 means mentioned first, so lower is better.',
    );
  });

  it('shows only the count of ordered answers when there are too few of them', () => {
    const shown = show(chat, { facts: rowOf(engine(CHAT, { position: position(1, 1, 3, 10) })) });
    expect(shown.text).toBe('1');
    expect(shown.container.querySelector('.bg-insufficient')).not.toBeNull();
    expect(shown.tip).toBe(
      'Only answers that are an ordered list have a mention position, and a platform needs at least 2. 3 mentions, 1 ordered answer.',
    );
    expect(chat.sortValue?.({ facts: rowOf(engine(CHAT, { position: position(1, 1, 3, 10) })) })).toBeNull();
  });

  it('says when the brand was never named, once there are enough answers to say it', () => {
    expect(show(chat, { facts: rowOf(engine(CHAT, { position: position(0, 0, 0, 20) })) })).toMatchObject({
      text: 'n/a',
      tip: 'Your brand was not mentioned in any of 20 answers, so it has no mention position',
    });
    expect(show(chat, { facts: rowOf(engine(CHAT, { position: position(0, 0, 0, 3) })) }).tip).toBe(
      '3 answers so far, too few to say where the brand sits',
    );
  });

  it('is n/a with the reason when nothing was observed, with the keyword reasons of Google AI Overview', () => {
    const none = rowOf(engine(CHAT, { position: position(0, 0, 0, 0) }));
    expect(show(chat, { facts: none }).tip).toBe('No answers in this period.');
    const aio = positionColumn<Row>(contextOf('google_ai_overview'), rows);
    const empty = rowOf(engine('google_ai_overview', { position: position(0, 0, 0, 0) }));
    expect(show(aio, { facts: empty, link: null })).toMatchObject({
      tip: 'No linked keyword. Google AI Overview is taken from the rank checks of a linked keyword.',
    });
    expect(show(aio, { facts: empty, link: link('best crm', 900) })).toMatchObject({
      text: 'None',
      tip: 'No Google AI Overview was shown for “best crm” in this period.',
    });
  });

  it('is not collected while the facts are not read or the backend sends no counts', () => {
    expect(show(chat, { facts: undefined })).toMatchObject({ text: 'n/a', tip: 'Not collected yet' });
    expect(show(chat, { facts: rowOf(engine(CHAT)) }).tip).toBe('Not collected yet');
  });
});

describe('recommendationColumn', () => {
  const chat = recommendationColumn<Row>(contextOf(CHAT), rows);
  const both = recommendationColumn<Row>(contextOf(CHAT, GEMINI), rows);

  it('is the rate of one platform with its own count', () => {
    const row: Row = { facts: rowOf(engine(CHAT, { valid: 12, recommended: cellOf(6, 12) })) };
    const shown = show(chat, row);
    expect(shown.text).toBe('50%');
    expect(shown.text).not.toContain('avg');
    expect(shown.tip).toBe('ChatGPT 6 of 12. ChatGPT only');
    expect(chat.sortValue?.(row)).toBe(0.5);
    expect(chat.header).toBe('Recommendation rate');
    expect(chat.headerTooltip).toBe(
      'The share of valid answers that recommend your brand, on the platforms that classify recommendations',
    );
  });

  it('averages the platforms with equal weight, each with its own count, never a pooled count', () => {
    const row: Row = {
      facts: rowOf(engine(CHAT, { recommended: cellOf(6, 12) }), engine(GEMINI, { recommended: cellOf(2, 20) })),
    };
    const shown = show(both, row);
    expect(shown.text).toBe('30%');
    expect(shown.tip).toBe(
      'ChatGPT 6 of 12 and Gemini 2 of 20. Equal weight average of ChatGPT and Gemini, each platform counting once',
    );
  });

  it('leaves out a platform that does not classify recommendations', () => {
    const row: Row = {
      facts: rowOf(engine(CHAT, { recommended: cellOf(6, 12) }), engine(GEMINI, { recommended: null })),
    };
    expect(show(both, row).tip).toBe('ChatGPT 6 of 12. ChatGPT only');
  });

  it('is n/a when no platform in view classifies them', () => {
    const mode = recommendationColumn<Row>(contextOf(AI_MODE), rows);
    const row: Row = { facts: rowOf(engine(AI_MODE, { recommended: null })) };
    expect(show(mode, row)).toMatchObject({ text: 'n/a', tip: 'Google AI Mode: not classified for this platform' });
    expect(mode.sortValue?.(row)).toBeNull();
  });

  it('is "Not enough data" under 4 valid answers and n/a with no answer', () => {
    const thin: Row = { facts: rowOf(engine(CHAT, { recommended: cellOf(1, 3) })) };
    const shown = show(chat, thin);
    expect(shown.text).toBe('Not enough data');
    expect(shown.container.querySelector('.bg-insufficient')).not.toBeNull();
    expect(shown.tip).toBe('3 answers in scope. A rate needs at least 4 on a platform.');
    expect(chat.sortValue?.(thin)).toBeNull();
    const empty: Row = { facts: rowOf(engine(CHAT, { valid: 0, recommended: cellOf(0, 0) })) };
    expect(show(chat, empty)).toMatchObject({ text: 'n/a', tip: 'ChatGPT: no answers in this period' });
    expect(show(both, empty).tip).toBe('No answers in this period');
  });

  it('is not collected while the facts are not read or the backend sends no rate', () => {
    expect(show(chat, { facts: undefined }).tip).toBe('Not collected yet');
    expect(show(chat, { facts: rowOf(engine(CHAT)) })).toMatchObject({ text: 'n/a', tip: 'Not collected yet' });
  });
});

describe('shareOfVoiceColumn', () => {
  // Share of voice is x of y brand mentions (D17), counted from the entity cells: you and one competitor
  const ownContext: MetricContext = { ...contextOf(CHAT, GEMINI), ownEntityIds: new Set(['own']) };
  const both = shareOfVoiceColumn<Row>(ownContext, rows);
  const withShare = (code: string, mine: number, rivals: number): EngineSummary =>
    ({
      ...engine(code),
      entities: [
        { entity_id: 'own', mentioned: cellOf(mine, 50), share_of_voice: cellOf(0, 0) },
        { entity_id: 'rival', mentioned: cellOf(rivals, 50), share_of_voice: cellOf(0, 0) },
      ],
    }) as EngineSummary;

  it('is the equal-weight average of the platforms with a share, with each own brand-mention counts', () => {
    // Gemini has 3 brand mentions: under the minimum, so only ChatGPT counts. ChatGPT: 5 of 20
    const row: Row = { facts: undefined, cells: [withShare(CHAT, 5, 15), withShare(GEMINI, 1, 2)] };
    const shown = show(both, row);
    expect(shown.text).toBe('25%');
    expect(shown.tip).toBe('ChatGPT 5 of 20 brand mentions. ChatGPT only');
    expect(both.sortValue?.(row)).toBe(0.25);
    expect(both.header).toBe('Share of voice');
  });

  it('averages two platforms that both have a share, with no pooled count', () => {
    // ChatGPT 5 of 20 (25%), Gemini 15 of 30 (50%): the average is 38%, where pooled it would be 20 of 50 (40%)
    const row: Row = { facts: undefined, cells: [withShare(CHAT, 5, 15), withShare(GEMINI, 15, 15)] };
    expect(show(both, row).text).toBe('38%');
    expect(show(both, row).tip).toContain('ChatGPT 5 of 20 brand mentions and Gemini 15 of 30 brand mentions');
    expect(show(both, row).tip).toContain('Equal weight average of ChatGPT and Gemini');
  });

  it('is n/a, not collected, when the read carries no entity cells, never a percent without its counts', () => {
    expect(show(both, { facts: undefined, cells: [engine(CHAT), engine(GEMINI)] })).toMatchObject({
      text: 'n/a',
      tip: 'Not collected yet',
    });
    expect(
      show(shareOfVoiceColumn<Row>(contextOf(CHAT), rows), { facts: undefined, cells: [withShare(CHAT, 5, 15)] }).text,
    ).toBe('n/a');
  });

  it('is "Not enough data" when every platform is thin, n/a when the counts are not loaded', () => {
    expect(show(both, { facts: undefined, cells: [withShare(CHAT, 1, 1)] })).toMatchObject({
      text: 'Not enough data',
      tip: '2 answers in scope. A rate needs at least 4 on a platform.',
    });
    expect(show(both, { facts: undefined, cells: undefined })).toMatchObject({
      text: 'n/a',
      tip: 'The counts are not loaded yet.',
    });
    expect(show(both, { facts: undefined, cells: [] }).text).toBe('n/a');
  });
});

describe('sentimentColumn', () => {
  const chat = sentimentColumn<Row>(contextOf(CHAT), rows);
  const both = sentimentColumn<Row>(contextOf(CHAT, GEMINI), rows);
  const tone = { positive: 8, neutral: 3, negative: 1, mixed: 0 };

  it('shows the positive share, the word and a bar of the four shares hidden from assistive technology', () => {
    const row: Row = { facts: rowOf(engine(CHAT, { sentiment: tone })) };
    const shown = show(chat, row);
    expect(shown.text).toBe('67%positive');
    const bar = shown.container.querySelector('[aria-hidden="true"]');
    // The zero share is not drawn
    expect(bar?.children).toHaveLength(3);
    expect(shown.tip).toBe(
      'Positive 67%, Neutral 25%, Negative 8%, Mixed 0%. ChatGPT: 12 classified mentions. Four shares, never one score.',
    );
    expect(chat.sortValue?.(row)).toBeCloseTo(8 / 12);
    expect(chat.headerTooltip).toBe('The tone of the answers that mention your brand, as four shares');
  });

  it('averages the platforms that classify with equal weight', () => {
    const row: Row = {
      facts: rowOf(
        engine(CHAT, { sentiment: { positive: 10, neutral: 0, negative: 0, mixed: 0 } }),
        engine(GEMINI, { sentiment: { positive: 0, neutral: 10, negative: 0, mixed: 0 } }),
      ),
    };
    const shown = show(both, row);
    expect(shown.text).toContain('50%');
    expect(shown.tip).toContain('Equal-weight average of ChatGPT and Gemini, each from its own classified mentions');
  });

  it('shows the count of mentions when there are too few classified', () => {
    const row: Row = { facts: rowOf(engine(CHAT, { sentiment: { positive: 2, neutral: 1, negative: 0, mixed: 0 } })) };
    const shown = show(chat, row);
    expect(shown.text).toBe('3 mentions');
    expect(shown.tip).toBe('3 classified mentions in 10 answers. The shares need at least 4 on a platform.');
    expect(chat.sortValue?.(row)).toBeNull();
  });

  it('is n/a when no platform in view classifies sentiment', () => {
    const mode = sentimentColumn<Row>(contextOf(AI_MODE), rows);
    expect(show(mode, { facts: rowOf(engine(AI_MODE, { sentiment: null })) })).toMatchObject({
      text: 'n/a',
      tip: 'Sentiment is classified on ChatGPT and Gemini answers, and none of them is in view',
    });
  });

  it('is n/a with the reason when there are no answers, and not collected without the facts', () => {
    expect(show(chat, { facts: rowOf(engine(CHAT, { valid: 0, sentiment: tone })) }).tip).toBe(
      'No answers in this period.',
    );
    expect(show(chat, { facts: undefined })).toMatchObject({ text: 'n/a', tip: 'Not collected yet' });
    expect(show(chat, { facts: rowOf(engine(CHAT)) }).tip).toBe('Not collected yet');
  });
});

describe('a row the facts hold no answer for on the platforms in view', () => {
  it('says there are no answers, not that the facts are not collected', () => {
    // Answered on Gemini only, with ChatGPT in view
    const row: Row = {
      facts: rowOf(
        engine(GEMINI, {
          position: { rank_sum: 2, ordered_answers: 2, mentions: 3, answers: 10 },
          recommended: cellOf(5, 10),
          sentiment: { positive: 4, neutral: 1, negative: 0, mixed: 0 },
        }),
      ),
    };
    const scope = contextOf(CHAT);
    expect(show(positionColumn<Row>(scope, rows), row)).toMatchObject({
      text: 'n/a',
      tip: 'No answers in this period.',
    });
    expect(show(recommendationColumn<Row>(scope, rows), row).tip).toBe('ChatGPT: no answers in this period');
    expect(show(sentimentColumn<Row>(scope, rows), row).tip).toBe('No answers in this period.');
  });
});

describe('metricColumns', () => {
  it('registers Intent, Search volume and Mention position, then the three rates, as two entries', () => {
    const entry = (id: string): number => metricColumns.findIndex((candidate) => candidate.id === id);
    expect(metricColumns.map((candidate) => candidate.id)).toEqual(['metrics-identity', 'metrics-rates']);
    expect(entry('metrics-identity')).toBeLessThan(entry('metrics-rates'));
  });
});
