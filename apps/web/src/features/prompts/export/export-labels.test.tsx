import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { buildPromptExport } from '../export-rows';
import type { PromptRow } from '../prompt-columns';
import { usePromptExportLabels } from './export-labels';
import type { ProjectEngine } from '@/lib/api/types';
import { renderWithProviders } from '@/test/render';

const ENGINES = [{ engine: { engine_code: 'chatgpt_web', label: 'ChatGPT' } }] as unknown as ProjectEngine[];
const row = (text: string, branded: boolean): unknown => ({
  prompt: { prompt_id: text, current_version: { text }, is_branded: branded },
  summary: undefined,
  countsLoaded: true,
  topics: null,
  topicList: [],
  country: null,
});
const ROWS = [row('Which agency?', true), row('Is it good?', false)] as PromptRow[];

function Probe(): ReactNode {
  const table = buildPromptExport(ROWS, ENGINES, usePromptExportLabels());
  return <p data-testid="file">{JSON.stringify([table.header, table.rows.map((cells) => cells[3])])}</p>;
}

describe('the export labels', () => {
  it('the labels equal the ones the bulk export uses', async () => {
    renderWithProviders(<Probe />);
    // Spelled out, so a change of a word in either place fails here
    expect(JSON.parse((await screen.findByTestId('file')).textContent ?? '')).toEqual([
      [
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
      ],
      ['Yes', 'No'],
    ]);
  });
});
