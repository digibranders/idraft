import { describe, expect, it } from 'vitest';

import { buildPromptExport, exportFileName, type PromptExportLabels } from './export-rows';
import type { PromptRow } from './prompt-columns';
import type { EngineSummary, MetricCell, ProjectEngine } from '@/lib/api/types';

const LABELS: PromptExportLabels = {
  prompt: 'Prompt',
  topic: 'Topic',
  country: 'Country',
  branded: 'Branded',
  yes: 'Yes',
  no: 'No',
  mentionRate: 'Mention rate (%)',
  mentionAnswers: 'Mention answers',
  citationRate: 'Citation rate (%)',
  citationAnswers: 'Citation answers',
  mentioned: (engine) => `${engine} mentioned`,
  cited: (engine) => `${engine} cited`,
  answers: (engine) => `${engine} valid answers`,
};

const ENGINES = [{ engine: { engine_code: 'chatgpt_web', label: 'ChatGPT' } }] as unknown as ProjectEngine[];

const cell = (numerator: number, denominator: number): MetricCell =>
  ({
    value: numerator / denominator,
    numerator,
    denominator,
    n_observations: denominator,
    pooled: null,
  }) as unknown as MetricCell;

const row = (text: string, over: Partial<PromptRow> = {}, engines: EngineSummary[] | null = null): PromptRow =>
  ({
    prompt: { prompt_id: text, current_version: { text }, is_branded: false },
    summary: engines === null ? undefined : { prompt_id: text, engines },
    countsLoaded: true,
    topics: null,
    topicList: [],
    country: null,
    ...over,
  }) as unknown as PromptRow;

const chatgpt = (mentioned: MetricCell, cited: MetricCell): EngineSummary =>
  ({ engine_code: 'chatgpt_web', mentioned, cited }) as unknown as EngineSummary;

describe('the CSV of prompts', () => {
  it('has the columns of the Prompts table, the rates and counts as numbers with the answers behind them in their own columns', () => {
    const table = buildPromptExport(
      [
        row(
          'Which agency is best?',
          {
            topicList: [
              { name: 'SEO', path: 'SEO' },
              { name: 'Local', path: 'SEO / Local' },
            ],
            country: 'Germany',
          },
          [chatgpt(cell(4, 8), cell(2, 8))],
        ),
      ],
      ENGINES,
      LABELS,
    );
    expect(table.header).toEqual([
      'Prompt',
      'Topic',
      'Country',
      'Branded',
      'Mention rate (%)',
      'Mention answers',
      'Citation rate (%)',
      'Citation answers',
      'ChatGPT mentioned',
      'ChatGPT cited',
      'ChatGPT valid answers',
    ]);
    expect(table.rows).toEqual([['Which agency is best?', 'SEO; Local', 'Germany', 'No', 50, 8, 25, 8, 4, 2, 8]]);
  });

  it('rounds a rate to one decimal of a percent', () => {
    const table = buildPromptExport([row('A?', {}, [chatgpt(cell(2, 6), cell(4, 6))])], ENGINES, LABELS);
    expect(table.rows[0]?.slice(4, 8)).toEqual([33.3, 6, 66.7, 6]);
  });

  it('leaves the cells that have no figure empty, and says Yes for a branded prompt', () => {
    const branded = row('Is Fynix good?', {
      prompt: { prompt_id: 'b', current_version: { text: 'Is Fynix good?' }, is_branded: true },
    } as Partial<PromptRow>);
    const table = buildPromptExport([branded], ENGINES, LABELS);
    expect(table.rows).toEqual([['Is Fynix good?', null, null, 'Yes', null, null, null, null, null, null, null]]);
  });

  it('writes every text cell that a spreadsheet would read as a formula as text: the prompt, the topics and the country', () => {
    const table = buildPromptExport(
      [
        row('=HYPERLINK("x")', {
          topicList: [{ name: '=HYPERLINK("http://x","click")', path: 'x' }],
          country: '+Atlantis',
        }),
      ],
      ENGINES,
      LABELS,
    );
    expect(table.rows[0]?.slice(0, 3)).toEqual(['\'=HYPERLINK("x")', '\'=HYPERLINK("http://x","click")', "'+Atlantis"]);
  });

  it('names the file for the window of the answers', () => {
    expect(exportFileName({ from: '2026-10-16', to: '2026-11-12' })).toBe('prompts-2026-10-16-to-2026-11-12.csv');
  });
});
