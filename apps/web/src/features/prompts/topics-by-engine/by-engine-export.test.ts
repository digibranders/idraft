import { describe, expect, it } from 'vitest';

import { buildByEngineExport, byEngineFileName, type ByEngineExportLabels } from './by-engine-export';
import { engine, head, projectEngine, weighted } from './cells.test-fixtures';
import type { TopicHead } from './topic-rows';

const ENGINES = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];
const LABELS: ByEngineExportLabels = {
  topic: 'Group',
  prompts: 'Prompts',
  rate: (name) => `${name} mentioned (%)`,
  counted: (name) => `${name} answers that count`,
  answers: (name) => `${name} valid answers`,
  change: (name) => `${name} change (points)`,
  gap: 'Platform gap (points)',
  best: 'Best platform',
  engines: 'Platforms with a rate',
};

const SEO: TopicHead = head('seo', 'SEO', {
  promptCount: 6,
  engines: [
    engine('chatgpt_web', { mentioned: weighted(3, 8, 2), share_of_voice: weighted(5, 20, 2) }),
    engine('gemini_web', { mentioned: weighted(6, 8, 2), share_of_voice: weighted(2, 5, 2) }),
  ],
});
const TECH: TopicHead = head('tech', 'Technical SEO', {
  promptCount: 2,
  engines: [engine('chatgpt_web', { mentioned: weighted(2, 3, 2) })],
});

const row = (table: ReturnType<typeof buildByEngineExport>, name: string) => {
  const found = table.rows.find((candidate) => candidate[0] === name);
  if (found === undefined) throw new Error(`No row for ${name}`);
  return found;
};

describe('buildByEngineExport: the By platform view as a file', () => {
  it('writes one row per group, with its prompt count', () => {
    const table = buildByEngineExport([SEO, TECH], ENGINES, 'mention', LABELS);
    expect(table.header.slice(0, 2)).toEqual(['Group', 'Prompts']);
    expect(table.rows.map((entry) => [entry[0], entry[1]])).toEqual([
      ['SEO', 6],
      ['Technical SEO', 2],
    ]);
  });

  it('writes each engine rate as a number with its counts', () => {
    const table = buildByEngineExport([SEO], ENGINES, 'mention', LABELS);
    expect(table.header.slice(2, 8)).toEqual([
      'ChatGPT mentioned (%)',
      'ChatGPT answers that count',
      'ChatGPT valid answers',
      'Gemini mentioned (%)',
      'Gemini answers that count',
      'Gemini valid answers',
    ]);
    expect(row(table, 'SEO').slice(2, 8)).toEqual([37.5, 3, 8, 75, 6, 8]);
    // The gap in points, the best engine and the engines that have a rate
    expect(table.header.slice(8)).toEqual(['Platform gap (points)', 'Best platform', 'Platforms with a rate']);
    expect(row(table, 'SEO').slice(8)).toEqual([37.5, 'Gemini', 2]);
  });

  it('writes the share of voice counts as brand mentions: the own mentions and all of them', () => {
    const table = buildByEngineExport([SEO], ENGINES, 'sov', LABELS);
    expect(row(table, 'SEO').slice(2, 8)).toEqual([25, 5, 20, 40, 2, 5]);
  });

  it('leaves an engine without answers empty and a rate with too few answers empty with its counts', () => {
    const table = buildByEngineExport([SEO, TECH], ENGINES, 'mention', LABELS);
    // Gemini has no cell on the second group, ChatGPT has 3 answers
    expect(row(table, 'Technical SEO').slice(2, 8)).toEqual([null, 2, 3, null, null, null]);
    expect(row(table, 'Technical SEO').slice(8)).toEqual([null, null, 0]);
  });

  it('names the best engine as the phone line does: the only engine with a rate, and the first of a float noise tie', () => {
    const lone = head('lone', 'Lone', { engines: [engine('gemini_web', { mentioned: weighted(3, 8, 2) })] });
    const noisy = { ...weighted(3, 10, 2), value: 0.1 + 0.2 };
    const tied = head('tied', 'Tied', {
      engines: [engine('chatgpt_web', { mentioned: weighted(3, 10, 2) }), engine('gemini_web', { mentioned: noisy })],
    });
    const table = buildByEngineExport([lone, tied], ENGINES, 'mention', LABELS);
    // One engine with a rate has no gap, and is the best all the same
    expect(row(table, 'Lone').slice(8)).toEqual([null, 'Gemini', 1]);
    expect(row(table, 'Tied').slice(8)).toEqual([0, 'ChatGPT', 2]);
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
    };
    const table = buildByEngineExport([withPrevious], ENGINES, 'mention', LABELS);
    expect(table.header.slice(-2)).toEqual(['ChatGPT change (points)', 'Gemini change (points)']);
    // 37.5% against 25%; Gemini has no previous, which is an empty cell and not 0
    expect(row(table, 'SEO').slice(-2)).toEqual([12.5, null]);
  });

  it('writes text so a spreadsheet does not read a formula', () => {
    const table = buildByEngineExport([head('x', '=SUM(A1)'), head('y', '+cmd')], ENGINES, 'mention', LABELS);
    expect(table.rows.map((entry) => entry[0])).toEqual(["'=SUM(A1)", "'+cmd"]);
  });

  it('names the file by metric and window', () => {
    expect(byEngineFileName('citation', { from: '2026-10-16', to: '2026-11-12' })).toBe(
      'groups-by-platform-citation-2026-10-16-to-2026-11-12.csv',
    );
  });
});
