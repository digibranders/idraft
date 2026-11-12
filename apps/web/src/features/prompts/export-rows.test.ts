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
  mentionRate: 'Mention rate',
  citationRate: 'Citation rate',
  mentioned: (engine) => `${engine} mentioned`,
  cited: (engine) => `${engine} cited`,
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
  it('has the columns of the Prompts table: the prompt, its topics, country, branded, the two rates and each engine counts', () => {
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
      'Mention rate',
      'Citation rate',
      'ChatGPT mentioned',
      'ChatGPT cited',
    ]);
    expect(table.rows).toEqual([
      ['Which agency is best?', 'SEO; Local', 'Germany', 'No', '50%', '25%', '4 of 8', '2 of 8'],
    ]);
  });

  it('leaves the cells that have no figure empty, and says Yes for a branded prompt', () => {
    const branded = row('Is Fynix good?', {
      prompt: { prompt_id: 'b', current_version: { text: 'Is Fynix good?' }, is_branded: true },
    } as Partial<PromptRow>);
    const table = buildPromptExport([branded], ENGINES, LABELS);
    expect(table.rows).toEqual([['Is Fynix good?', null, null, 'Yes', null, null, null, null]]);
  });

  it('writes a prompt that a spreadsheet would read as a formula as text', () => {
    expect(buildPromptExport([row('=HYPERLINK("x")')], ENGINES, LABELS).rows[0]?.[0]).toBe('\'=HYPERLINK("x")');
  });

  it('names the file for the window of the answers', () => {
    expect(exportFileName({ from: '2026-10-16', to: '2026-11-12' })).toBe('prompts-2026-10-16-to-2026-11-12.csv');
  });
});
