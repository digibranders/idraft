import { describe, expect, it } from 'vitest';

import { buildByEngineExport, byEngineFileName, type ByEngineExportLabels } from './by-engine-export';
import { engine, head, projectEngine, weighted } from './cells-fixtures';
import type { TopicHead } from './topic-rows';

const ENGINES = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];
const LABELS: ByEngineExportLabels = {
  topic: 'Topic',
  parent: 'Parent topic',
  prompts: 'Prompts',
  rate: (name) => `${name} mentioned (%)`,
  counted: (name) => `${name} answers that count`,
  answers: (name) => `${name} valid answers`,
  change: (name) => `${name} change (points)`,
  gap: 'Engine gap (points)',
  best: 'Best engine',
  engines: 'Engines with a rate',
};

const SEO: TopicHead = head('seo', 'SEO', {
  promptCount: 6,
  engines: [
    engine('chatgpt_web', { mentioned: weighted(3, 8, 2), share_of_voice: weighted(5, 20, 2) }),
    engine('gemini_web', { mentioned: weighted(6, 8, 2), share_of_voice: weighted(2, 5, 2) }),
  ],
  children: [
    head('tech', 'Technical SEO', {
      path: 'SEO / Technical SEO',
      parent: 'SEO',
      promptCount: 2,
      engines: [engine('chatgpt_web', { mentioned: weighted(2, 3, 2) })],
    }),
  ],
});

const row = (table: ReturnType<typeof buildByEngineExport>, name: string) => {
  const found = table.rows.find((candidate) => candidate[0] === name);
  if (found === undefined) throw new Error(`No row for ${name}`);
  return found;
};

describe('buildByEngineExport: the By engine view as a file', () => {
  it('writes one row per topic with a parent column, the topics under a parent after it', () => {
    const table = buildByEngineExport([SEO], ENGINES, 'mention', LABELS);
    expect(table.header.slice(0, 3)).toEqual(['Topic', 'Parent topic', 'Prompts']);
    expect(table.rows.map((entry) => [entry[0], entry[1], entry[2]])).toEqual([
      ['SEO', null, 6],
      ['Technical SEO', 'SEO', 2],
    ]);
  });

  it('writes each engine rate as a number with its counts', () => {
    const table = buildByEngineExport([SEO], ENGINES, 'mention', LABELS);
    expect(table.header.slice(3, 9)).toEqual([
      'ChatGPT mentioned (%)',
      'ChatGPT answers that count',
      'ChatGPT valid answers',
      'Gemini mentioned (%)',
      'Gemini answers that count',
      'Gemini valid answers',
    ]);
    expect(row(table, 'SEO').slice(3, 9)).toEqual([37.5, 3, 8, 75, 6, 8]);
    // The gap in points, the best engine and the engines that have a rate
    expect(table.header.slice(9)).toEqual(['Engine gap (points)', 'Best engine', 'Engines with a rate']);
    expect(row(table, 'SEO').slice(9)).toEqual([37.5, 'Gemini', 2]);
  });

  it('leaves share of voice counts empty, never 0', () => {
    const table = buildByEngineExport([SEO], ENGINES, 'sov', LABELS);
    // The rate and the valid answers (those that name a brand) are written, the count that counts is not
    expect(row(table, 'SEO').slice(3, 9)).toEqual([25, null, 20, 40, null, 5]);
  });

  it('leaves an engine without answers empty and a rate with too few answers empty with its counts', () => {
    const table = buildByEngineExport([SEO], ENGINES, 'mention', LABELS);
    // Gemini has no cell on the child, ChatGPT has 3 answers
    expect(row(table, 'Technical SEO').slice(3, 9)).toEqual([null, 2, 3, null, null, null]);
    expect(row(table, 'Technical SEO').slice(9)).toEqual([null, null, 0]);
  });

  it('names the best engine as the phone line does: the only engine with a rate, and the first of a float noise tie', () => {
    const lone = head('lone', 'Lone', { engines: [engine('gemini_web', { mentioned: weighted(3, 8, 2) })] });
    const noisy = { ...weighted(3, 10, 2), value: 0.1 + 0.2 };
    const tied = head('tied', 'Tied', {
      engines: [engine('chatgpt_web', { mentioned: weighted(3, 10, 2) }), engine('gemini_web', { mentioned: noisy })],
    });
    const table = buildByEngineExport([lone, tied], ENGINES, 'mention', LABELS);
    // One engine with a rate has no gap, and is the best all the same
    expect(row(table, 'Lone').slice(9)).toEqual([null, 'Gemini', 1]);
    expect(row(table, 'Tied').slice(9)).toEqual([0, 'ChatGPT', 2]);
  });

  it('adds the change columns only when a cell has previous', () => {
    const without = buildByEngineExport([SEO], ENGINES, 'mention', LABELS);
    expect(without.header.some((name) => name.includes('change'))).toBe(false);
    const withPrevious: TopicHead = {
      ...SEO,
      engines: [
        engine('chatgpt_web', { mentioned: weighted(3, 8, 2), previous: { mentioned: weighted(2, 8, 2) } }),
        engine('gemini_web', { mentioned: weighted(6, 8, 2) }),
      ],
      children: [],
    };
    const table = buildByEngineExport([withPrevious], ENGINES, 'mention', LABELS);
    expect(table.header.slice(-2)).toEqual(['ChatGPT change (points)', 'Gemini change (points)']);
    // 37.5% against 25%; Gemini has no previous, which is an empty cell and not 0
    expect(row(table, 'SEO').slice(-2)).toEqual([12.5, null]);
  });

  it('writes text so a spreadsheet does not read a formula', () => {
    const table = buildByEngineExport(
      [head('x', '=SUM(A1)', { children: [head('y', '+cmd', { parent: '=SUM(A1)' })] })],
      ENGINES,
      'mention',
      LABELS,
    );
    expect(table.rows.map((entry) => [entry[0], entry[1]])).toEqual([
      ["'=SUM(A1)", null],
      ["'+cmd", "'=SUM(A1)"],
    ]);
  });

  it('names the file by metric and window', () => {
    expect(byEngineFileName('citation', { from: '2026-10-16', to: '2026-11-12' })).toBe(
      'topics-by-engine-citation-2026-10-16-to-2026-11-12.csv',
    );
  });
});
