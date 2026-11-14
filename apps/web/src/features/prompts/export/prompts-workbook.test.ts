import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildPromptExport } from '../export-rows';
import type { PromptRow } from '../prompt-columns';
import { buildPromptSheet, buildPromptWorkbook, workbookFileName, XLSX_FILE_TYPE } from './prompts-workbook';
import type { EngineSummary, ProjectEngine } from '@/lib/api/types';
import { parseCsv } from '@/lib/csv/csv';
import { toCsv, type CsvTable } from '@/lib/csv/csv-write';

const TABLE: CsvTable = {
  header: ['Prompt', 'Topic', 'Mention rate (%)', 'Mention answers'],
  rows: [
    ['Which agency is best?', 'SEO', 50, 8],
    ['Is it good?', null, null, null],
  ],
};

describe('the workbook of prompts', () => {
  it('a workbook is a zip: the blob starts with PK and holds the sheet and content type members', async () => {
    const blob = await buildPromptWorkbook(TABLE, 'Prompts');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    // A zip stores the name of each member in its headers, not packed
    const names = new TextDecoder('latin1').decode(bytes);
    expect(names).toContain('[Content_Types].xml');
    expect(names).toContain('xl/worksheets/sheet1.xml');
    expect(blob.type).toBe(XLSX_FILE_TYPE);
  });

  it('the sheet has the header row as bold text and one row for each prompt', () => {
    const sheet = buildPromptSheet(TABLE);
    expect(sheet).toHaveLength(1 + TABLE.rows.length);
    expect(sheet[0]).toEqual(TABLE.header.map((value) => ({ value, type: String, fontWeight: 'bold' })));
    expect(sheet[1]?.[0]).toEqual({ value: 'Which agency is best?', type: String });
  });

  it('percents and counts are numbers, not text', () => {
    const [, first] = buildPromptSheet(TABLE);
    expect(first?.[2]).toEqual({ value: 50, type: Number });
    expect(first?.[3]).toEqual({ value: 8, type: Number });
  });

  it('an empty cell is no cell, never 0', () => {
    const [, , second] = buildPromptSheet(TABLE);
    expect(second).toEqual([{ value: 'Is it good?', type: String }, null, null, null]);
  });

  it('text that starts with = + - or @ is written as text with the same apostrophe the CSV gets', () => {
    const table: CsvTable = {
      header: ['Prompt'],
      rows: [['=HYPERLINK("http://x")'], ['+1'], ['-2'], ['@SUM(A1)'], ['plain']],
    };
    expect(buildPromptSheet(table).slice(1)).toEqual([
      [{ value: `'=HYPERLINK("http://x")`, type: String }],
      [{ value: "'+1", type: String }],
      [{ value: "'-2", type: String }],
      [{ value: "'@SUM(A1)", type: String }],
      [{ value: 'plain', type: String }],
    ]);
  });

  it('reads like the CSV of the same prompts, and keeps the apostrophe the export wrote without doubling it', () => {
    const cell = { engine_code: 'chatgpt_web' } as unknown as EngineSummary;
    const row = {
      prompt: { prompt_id: 'p', current_version: { text: '=cmd' }, is_branded: false },
      summary: { prompt_id: 'p', engines: [cell] },
      countsLoaded: true,
      topics: null,
      topicList: [],
      country: null,
    } as unknown as PromptRow;
    const engines = [{ engine: { engine_code: 'chatgpt_web', label: 'ChatGPT' } }] as unknown as ProjectEngine[];
    const labels = {
      prompt: 'Prompt',
      topic: 'Topic',
      country: 'Country',
      branded: 'Branded',
      yes: 'Yes',
      no: 'No',
      mentionRate: 'm',
      mentionAnswers: 'ma',
      citationRate: 'c',
      citationAnswers: 'ca',
      mentioned: () => 'mentioned',
      cited: () => 'cited',
      answers: () => 'answers',
    };
    const table = buildPromptExport([row], engines, labels);
    const sheet = buildPromptSheet(table);
    expect(sheet[1]?.[0]).toEqual({ value: "'=cmd", type: String });
    expect(parseCsv(toCsv(table))[1]?.[0]).toBe("'=cmd");
    // The figures the summary has none for stay empty, as the CSV leaves them
    expect(sheet[1]?.slice(4)).toEqual(table.rows[0]?.slice(4).map(() => null));
  });

  it('the file name carries the window', () => {
    expect(workbookFileName({ from: '2026-10-16', to: '2026-11-12' })).toBe('prompts-2026-10-16-to-2026-11-12.xlsx');
  });

  it('the writer is not imported until the workbook is asked for', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'prompts-workbook.ts'), 'utf8');
    const staticImports = source.split('\n').filter((line) => /^import\s/.test(line) && !/^import type\s/.test(line));
    expect(staticImports.filter((line) => line.includes('write-excel-file'))).toEqual([]);
    expect(source).toContain("import('write-excel-file/universal')");
  });
});
