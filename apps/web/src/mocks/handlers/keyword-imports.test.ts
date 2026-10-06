import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { writeTrouble } from './keyword-imports';
import { MOCK_VOCABULARY_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import { parseCsv } from '@/lib/csv/csv';
import { IMPORT_ROW, KEYWORD_IMPORT, TRACKED_KEYWORD_DETAIL, TRACKED_KEYWORD_ROW } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;
const I = `${P}/keyword-imports`;
const ROWS = z.array(IMPORT_ROW);
const IMPORTS = z.array(KEYWORD_IMPORT);
type KeywordImport = z.infer<typeof KEYWORD_IMPORT>;
const ACTIVE = KEYWORD_TABLE.filter((row) => row.archived !== true).length;
/** Long enough for a parse or a write to finish. */
const SETTLE_MS = 5_000;

let clock = Date.parse('2026-10-01T12:00:00Z');
beforeEach(() => {
  clock = Date.parse('2026-10-01T12:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const trackedId = (text: string): string => mockId('tracked', KEYWORD_TABLE.findIndex((row) => row.text === text) + 1);

const upload = (
  browser: MockBrowser,
  csv: string,
  name = 'keywords.csv',
  options?: unknown,
): ReturnType<MockBrowser['call']> => {
  const form = new FormData();
  form.set('file', new File([csv], name, { type: name.endsWith('.csv') ? 'text/csv' : 'text/plain' }));
  if (options !== undefined) form.set('options', JSON.stringify(options));
  return browser.call('POST', `${I}/upload`, form);
};

describe('keyword imports', () => {
  it('parses a paste into a preview with an outcome per row, then writes it on confirm', async () => {
    const editor = mockBrowser('editor');
    const answer = await editor.call('POST', I, {
      source: 'paste',
      paste: 'seo audit\nNew Keyword\tblog|guides\nnew keyword\nsite:fynix.digital seo\n',
      defaults: { tags_vocabulary_id: MOCK_VOCABULARY_IDS.topics },
    });
    expect(answer.status).toBe(202);
    const started = dataOf(answer, KEYWORD_IMPORT);
    expect(started).toMatchObject({
      source: 'paste',
      status: 'uploaded',
      quota: null,
      // Queued for the worker that reads it, as the backend maps `uploaded`
      operation: { status: 'queued' },
    });
    const path = `${I}/${started.import_id}`;
    expect(await editor.call('GET', `${path}/rows`)).toMatchObject({ status: 409, code: 'invalid_state_transition' });
    clock += SETTLE_MS;
    const ready = dataOf(await editor.call('GET', path), KEYWORD_IMPORT);
    expect(ready).toMatchObject({
      status: 'preview_ready',
      column_mapping: { keyword: 'keyword', tags: 'tags' },
      counts: { rows_total: 4, new: 1, duplicate: 2, variant: 0, conflict: 0, invalid: 1 },
      quota: { limit: 5000, used: ACTIVE, would_use: ACTIVE + 1 },
      // The report is linked whenever there are rows to report on, a ready preview included
      operation: { status: 'waiting_for_input', links: { result: `${path}/report`, cancel: `${path}/cancel` } },
    });
    const rows = dataOf(await editor.call('GET', `${path}/rows`), ROWS);
    expect(rows.map((row) => [row.row_no, row.outcome, row.action, row.reason_code])).toEqual([
      [1, 'duplicate', 'skip', 'tracked'],
      [2, 'new', 'create', null],
      [3, 'duplicate', 'skip', 'repeated_in_file'],
      [4, 'invalid', 'skip', 'search_operator_not_allowed'],
    ]);
    expect(rows[0]?.existing_tracked_keyword_id).toBe(trackedId('seo audit'));
    const invalidOnly = dataOf(await editor.call('GET', `${path}/rows?filter[outcome_in]=invalid`), ROWS);
    expect(invalidOnly.map((row) => row.row_no)).toEqual([4]);

    // Row actions: only those the outcome takes
    expect(
      fieldCodes(
        await editor.call('PATCH', path, {
          row_actions: [
            { row_no: 4, action: 'create' },
            { row_no: 1, action: 'force_separate' },
          ],
        }),
      ),
    ).toEqual(['row_actions.0.action:action_not_allowed', 'row_actions.1.action:force_separate_not_available']);
    expect((await editor.call('PATCH', path, { row_actions: [{ row_no: 1, action: 'merge' }] })).status).toBe(202);

    const confirmed = await editor.call('POST', `${path}/confirm`, {});
    expect(confirmed.status).toBe(202);
    // Counted when the write has ended, as the backend does; the quota belongs to the preview alone
    expect(dataOf(confirmed, KEYWORD_IMPORT)).toMatchObject({
      status: 'writing',
      counts: { created: 0, merged: 0, skipped: 0 },
      quota: null,
    });
    clock += SETTLE_MS;
    const done = dataOf(await editor.call('GET', path), KEYWORD_IMPORT);
    // The invalid row was skipped, not a row the write failed on: the import completed
    expect(done).toMatchObject({
      status: 'completed',
      counts: { created: 1, merged: 1, skipped: 2 },
      operation: { status: 'succeeded' },
    });
    expect(await editor.call('POST', `${path}/confirm`, {})).toMatchObject({ status: 409 });

    // The new keyword came from a paste, with its tags made in the Topics vocabulary
    const list = await editor.call('GET', `${P}/tracked-keywords?filter[q]=new keyword&include=terms`);
    const [created] = dataOf(list, z.array(TRACKED_KEYWORD_ROW));
    expect(created).toMatchObject({ keyword: { text: 'New Keyword' }, source: 'bulk_paste' });
    expect(created?.terms?.map((term) => term.name).sort()).toEqual(['blog', 'guides']);

    const report = await editor.call('GET', `${path}/report`);
    const lines = String(report.body.text).trim().split('\r\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(
      'row_no,part,keyword,location_id,language_code,device,outcome,reason_code,reason,action,result,tracked_keyword_id,write_error_code',
    );
    expect(lines[2]).toContain(created?.tracked_keyword_id ?? 'missing');
    // What became of each row: the merged one, the created one, and two skipped (a repeat, an invalid row)
    expect(parseCsv(String(report.body.text)).map((cells) => cells[10])).toEqual([
      'result',
      'merged',
      'created',
      'skipped',
      'skipped',
    ]);
  });

  it('matches the mapping keys to the headers trimmed and without case, and echoes them as the backend does', async () => {
    const editor = mockBrowser('editor');
    const answer = await upload(editor, 'Keyword, Tags \nseo audit,blog\n', 'keywords.csv', {
      column_mapping: { ' keyword ': 'keyword', TAGS: 'tags', Ghost: 'group', Volume: 'not_a_field' },
      defaults: { tags_vocabulary_id: MOCK_VOCABULARY_IDS.topics },
    });
    const started = dataOf(answer, KEYWORD_IMPORT);
    // Until the file is read: exactly the keys sent
    expect(started.status).toBe('uploaded');
    expect(started.column_mapping).toEqual({
      ' keyword ': 'keyword',
      TAGS: 'tags',
      Ghost: 'group',
      Volume: 'not_a_field',
    });
    clock += SETTLE_MS;
    const read = dataOf(await editor.call('GET', `${I}/${started.import_id}`), KEYWORD_IMPORT);
    // After it: the headers of the file, trimmed, in the case the file wrote; a key with no header is dropped
    expect(read.status).toBe('preview_ready');
    expect(read.column_mapping).toEqual({ Keyword: 'keyword', Tags: 'tags' });
  });

  it('asks for a mapping when no column is the keyword, and judges every outcome of the matrix', async () => {
    const editor = mockBrowser('editor');
    const csv = [
      '﻿Search term,Device,Location,Group',
      'Seo Audit,desktop,United States,"Services/Audits, US"',
      'seo meme,,,',
      'crawl budget,both,,',
      'technical seo,tablet,,',
    ].join('\r\n');
    const answer = await upload(editor, csv);
    const started = dataOf(answer, KEYWORD_IMPORT);
    expect(started).toMatchObject({ source: 'upload', original_filename: 'keywords.csv' });
    // Until the file is read, the mapping is what was sent: nothing
    expect(started.column_mapping).toEqual({});
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    const needing = dataOf(await editor.call('GET', path), KEYWORD_IMPORT);
    expect(needing.status).toBe('needs_mapping');
    // Once it is read, the mapping is keyed by the headers of the file, and holds the ones named like a field
    expect(needing.column_mapping).toEqual({ Device: 'device', Location: 'location', Group: 'group' });
    expect(
      fieldCodes(await editor.call('PATCH', path, { column_mapping: { 'Search term': 'keyword', Device: 'keyword' } })),
    ).toEqual(['column_mapping.Device:field_mapped_twice']);
    expect(
      fieldCodes(await editor.call('PATCH', path, { column_mapping: { Device: 'device', ' device ': 'location' } })),
    ).toEqual(['column_mapping:header_repeated']);
    const mapped = await editor.call('PATCH', path, {
      column_mapping: { 'Search term': 'keyword', Device: 'device', Location: 'location', Group: 'group' },
    });
    expect(dataOf(mapped, KEYWORD_IMPORT).status).toBe('uploaded');
    clock += SETTLE_MS;
    const rows = dataOf(await editor.call('GET', `${path}/rows`), ROWS);
    expect(rows.map((row) => [row.row_no, row.part, row.device, row.outcome, row.reason_code])).toEqual([
      // Tracked as "seo audit", not at this place: the same keyword typed differently
      [1, 1, 'desktop', 'variant', 'casing_differs'],
      [2, 1, 'desktop', 'conflict', 'archived'],
      // `both` is two rows of one row number
      [3, 1, 'desktop', 'duplicate', 'tracked'],
      [3, 2, 'mobile', 'new', null],
      [4, 1, null, 'invalid', 'device_invalid'],
    ]);
    await editor.call('PATCH', path, { row_actions: [{ row_no: 2, action: 'merge' }] });
    const confirmed = dataOf(
      await editor.call('POST', `${path}/confirm`, { duplicate_action: 'skip' }),
      KEYWORD_IMPORT,
    );
    expect(confirmed.status).toBe('writing');
    clock += SETTLE_MS;
    expect(dataOf(await editor.call('GET', path), KEYWORD_IMPORT).counts).toMatchObject({
      created: 2,
      merged: 1,
      skipped: 2,
    });
    // The archived keyword was merged back in, and the group path was made
    const meme = dataOf(
      await editor.call('GET', `${P}/tracked-keywords/${trackedId('seo meme')}`),
      TRACKED_KEYWORD_DETAIL,
    );
    expect(meme.is_active).toBe(true);
    const groups = await editor.call('GET', `${P}/keyword-groups?format=flat`);
    expect(JSON.stringify(groups.body)).toContain('Services/Audits, US');
  });

  it('takes JSON rows, refuses other files, and checks the defaults', async () => {
    const editor = mockBrowser('editor');
    const answer = await editor.call('POST', I, {
      source: 'api',
      rows: [{ keyword: 'seo for startups', priority: '1', country: 'us' }],
    });
    const started = dataOf(answer, KEYWORD_IMPORT);
    clock += SETTLE_MS;
    const [row] = dataOf(await editor.call('GET', `${I}/${started.import_id}/rows`), ROWS);
    expect(row).toMatchObject({
      location_id: 2840,
      outcome: 'new',
      raw: { keyword: 'seo for startups', country: 'us' },
    });
    expect(await upload(editor, 'keyword\nseo', 'keywords.txt')).toMatchObject({
      status: 415,
      code: 'unsupported_media_type',
    });
    expect(await editor.call('POST', `${I}/upload`, { file: 'keyword' })).toMatchObject({ status: 415 });
    expect(
      fieldCodes(
        await editor.call('POST', I, {
          source: 'paste',
          paste: 'seo',
          defaults: { location_id: 1, tags_vocabulary_id: mockId('vocabulary', 99) },
        }),
      ),
    ).toEqual(['defaults.location_id:location_unknown', 'defaults.tags_vocabulary_id:vocabulary_unknown']);
    expect(fieldCodes(await editor.call('POST', I, { source: 'upload' }))).toEqual(['source:enum']);
    expect(fieldCodes(await editor.call('POST', I, { source: 'api', rows: [] }))).toEqual(['rows:too_short']);
    expect(await editor.as('viewer').call('POST', I, { source: 'paste', paste: 'seo' })).toMatchObject({ status: 403 });
  });

  it('takes an upload above the 1 MB that other bodies are held to', async () => {
    const editor = mockBrowser('editor');
    // About 1.5 MB of keywords: over the general limit, far under the upload's 50 MB
    const lines = Array.from({ length: 60_000 }, (_, index) => `keyword number ${String(index)}`);
    const answer = await upload(editor, ['keyword', ...lines].join('\n'));
    expect(answer.status).toBe(202);
    expect(await editor.call('POST', I, { source: 'paste', paste: 'x'.repeat(1_100_000) })).toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
  });

  it('merges duplicates on confirm only where the user left the default action, and expires after a week', async () => {
    const editor = mockBrowser('editor');
    const paste = { source: 'paste', paste: 'seo audit\tblog\ntechnical seo audit\tblog' };
    const options = { ...paste, defaults: { tags_vocabulary_id: MOCK_VOCABULARY_IDS.topics } };
    const started = dataOf(await editor.call('POST', I, options), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    await editor.call('PATCH', path, { row_actions: [{ row_no: 1, action: 'skip' }] });
    const confirmed = dataOf(
      await editor.call('POST', `${path}/confirm`, { duplicate_action: 'merge_terms' }),
      KEYWORD_IMPORT,
    );
    expect(confirmed.status).toBe('writing');
    clock += SETTLE_MS;
    const written = dataOf(await editor.call('GET', path), KEYWORD_IMPORT);
    expect(written.counts).toMatchObject({ created: 0, merged: 1, skipped: 1 });
    const kept = dataOf(
      await editor.call('GET', `${P}/tracked-keywords/${trackedId('seo audit')}`),
      TRACKED_KEYWORD_DETAIL,
    );
    expect(kept.terms.map((term) => term.name)).not.toContain('blog');
    const merged = dataOf(
      await editor.call('GET', `${P}/tracked-keywords/${trackedId('technical seo audit')}`),
      TRACKED_KEYWORD_DETAIL,
    );
    expect(merged.terms.map((term) => term.name)).toContain('blog');

    const stale = dataOf(await editor.call('POST', I, { source: 'paste', paste: 'seo later' }), KEYWORD_IMPORT);
    clock += 7 * 24 * 60 * 60 * 1000;
    const stalePath = `${I}/${stale.import_id}`;
    expect(dataOf(await editor.call('GET', stalePath), KEYWORD_IMPORT).status).toBe('expired');
    expect(await editor.call('POST', `${stalePath}/confirm`, {})).toMatchObject({ status: 409 });
    expect(await editor.call('POST', `${stalePath}/cancel`)).toMatchObject({ status: 409 });
    expect(await editor.call('PATCH', stalePath, { row_actions: [] })).toMatchObject({ status: 409 });
  });

  it('cancels an import before it is written, and lists the imports newest first', async () => {
    const editor = mockBrowser('editor');
    const first = dataOf(await editor.call('POST', I, { source: 'paste', paste: 'seo tips' }), KEYWORD_IMPORT);
    clock += 1_000;
    const second = dataOf(await editor.call('POST', I, { source: 'paste', paste: 'seo news' }), KEYWORD_IMPORT);
    const cancelled = await editor.call('POST', `${I}/${first.import_id}/cancel`);
    expect(dataOf(cancelled, KEYWORD_IMPORT)).toMatchObject({
      status: 'cancelled',
      finished_at: expect.any(String) as string,
    });
    expect(await editor.call('POST', `${I}/${first.import_id}/cancel`)).toMatchObject({ status: 409 });
    clock += SETTLE_MS;
    expect(await editor.call('POST', `${I}/${first.import_id}/confirm`, {})).toMatchObject({ status: 409 });
    const listed = dataOf(await editor.as('viewer').call('GET', `${I}?limit=200`), IMPORTS);
    const mine = listed.filter((entry) => [first.import_id, second.import_id].includes(entry.import_id));
    expect(mine.map((entry) => [entry.import_id, entry.status])).toEqual([
      [second.import_id, 'preview_ready'],
      [first.import_id, 'cancelled'],
    ]);
    const onlyCancelled = dataOf(await editor.call('GET', `${I}?filter[status]=cancelled&limit=200`), IMPORTS);
    expect(onlyCancelled.every((entry) => entry.status === 'cancelled')).toBe(true);
  });
});

describe('keyword imports as the backend builds them', () => {
  const statusOf = async (browser: MockBrowser, path: string): Promise<KeywordImport> =>
    dataOf(await browser.call('GET', path), KEYWORD_IMPORT);

  it('reads uploaded, never parsing, after an upload and after a new mapping', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'keyword\nseo audit\nfresh idea\n'), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    expect(started.status).toBe('uploaded');
    expect((await statusOf(editor, path)).status).toBe('uploaded');
    clock += SETTLE_MS;
    expect((await statusOf(editor, path)).status).toBe('preview_ready');

    const mapped = await editor.call('PATCH', path, { column_mapping: { keyword: 'keyword' } });
    expect(mapped.status).toBe(202);
    expect(dataOf(mapped, KEYWORD_IMPORT).status).toBe('uploaded');
    expect((await statusOf(editor, path)).status).toBe('uploaded');
    clock += SETTLE_MS;
    expect((await statusOf(editor, path)).status).toBe('preview_ready');
  });

  it('asks for a keyword column when the headers hold none', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'Search term,Device\nseo audit,desktop\n'), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    expect(started).toMatchObject({ status: 'uploaded', error_code: null });
    clock += SETTLE_MS;
    expect(await statusOf(editor, path)).toMatchObject({
      status: 'needs_mapping',
      error_code: 'keyword_column_missing',
    });
  });

  it.each([
    ['tags', 'tags_vocabulary_missing', 'tags_vocabulary_id'],
    ['topic', 'topic_vocabulary_missing', 'topic_vocabulary_id'],
  ] as const)('asks for a vocabulary when a file maps %s and none is chosen', async (column, code, defaultsKey) => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, `keyword,${column}\nfresh idea,blog\n`), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    expect(await statusOf(editor, path)).toMatchObject({ status: 'needs_mapping', error_code: code });

    const fixed = await editor.call('PATCH', path, { defaults: { [defaultsKey]: MOCK_VOCABULARY_IDS.topics } });
    expect(fixed.status).toBe(202);
    expect(dataOf(fixed, KEYWORD_IMPORT).status).toBe('uploaded');
    clock += SETTLE_MS;
    expect(await statusOf(editor, path)).toMatchObject({ status: 'preview_ready', error_code: null });
  });

  it('asks for the tags vocabulary when a paste line holds a tab, and only then', async () => {
    const editor = mockBrowser('editor');
    const tabbed = dataOf(await editor.call('POST', I, { source: 'paste', paste: 'fresh idea\tblog' }), KEYWORD_IMPORT);
    const plain = dataOf(await editor.call('POST', I, { source: 'paste', paste: 'fresh idea' }), KEYWORD_IMPORT);
    clock += SETTLE_MS;
    expect(await statusOf(editor, `${I}/${tabbed.import_id}`)).toMatchObject({
      status: 'needs_mapping',
      error_code: 'tags_vocabulary_missing',
    });
    expect(await statusOf(editor, `${I}/${plain.import_id}`)).toMatchObject({ status: 'preview_ready' });
  });

  it('refuses a column mapping on a paste', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await editor.call('POST', I, { source: 'paste', paste: 'fresh idea' }), KEYWORD_IMPORT);
    clock += SETTLE_MS;
    expect(
      fieldCodes(await editor.call('PATCH', `${I}/${started.import_id}`, { column_mapping: { keyword: 'keyword' } })),
    ).toEqual(['column_mapping:not_applicable']);
    expect(
      fieldCodes(
        await editor.call('POST', I, { source: 'paste', paste: 'fresh idea', column_mapping: { keyword: 'keyword' } }),
      ),
    ).toEqual(['column_mapping:not_applicable']);
  });

  it('refuses row actions sent together with a mapping or defaults', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'keyword\nseo audit\n'), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    const rowActions = [{ row_no: 1, action: 'skip' }];
    expect(
      fieldCodes(await editor.call('PATCH', path, { row_actions: rowActions, defaults: { priority: 2 } })),
    ).toEqual(['row_actions:not_with_mapping']);
    expect(
      fieldCodes(await editor.call('PATCH', path, { row_actions: rowActions, column_mapping: { keyword: 'keyword' } })),
    ).toEqual(['row_actions:not_with_mapping']);
    expect((await editor.call('PATCH', path, { row_actions: rowActions })).status).toBe(202);
  });

  it('lets a row that repeats an earlier row be skipped and nothing else', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(
      await editor.call('POST', I, { source: 'paste', paste: 'fresh idea\nfresh idea' }),
      KEYWORD_IMPORT,
    );
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    const [first, repeat] = dataOf(await editor.call('GET', `${path}/rows`), ROWS);
    expect(first).toMatchObject({ outcome: 'new', action: 'create' });
    expect(repeat).toMatchObject({ outcome: 'duplicate', reason_code: 'repeated_in_file', action: 'skip' });
    expect(fieldCodes(await editor.call('PATCH', path, { row_actions: [{ row_no: 2, action: 'merge' }] }))).toEqual([
      'row_actions.0.action:action_not_allowed',
    ]);
    expect((await editor.call('PATCH', path, { row_actions: [{ row_no: 2, action: 'skip' }] })).status).toBe(202);
  });
});

describe('keyword imports: the reasons of invalid rows', () => {
  const reasonsOf = async (csv: string, options?: unknown): Promise<(string | null)[]> => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, csv, 'keywords.csv', options), KEYWORD_IMPORT);
    clock += SETTLE_MS;
    return dataOf(await editor.call('GET', `${I}/${started.import_id}/rows`), ROWS).map((row) => row.reason_code);
  };

  it('refuses an intent and a funnel stage that do not exist, and takes a blank one', async () => {
    expect(
      await reasonsOf(
        'keyword,intent,funnel_stage\nfresh idea one,commercial,\nfresh idea two,buying,\nfresh idea three,,top\nfresh idea four,Local,BOFU\n',
      ),
    ).toEqual([null, 'intent_invalid', 'funnel_stage_invalid', null]);
  });

  it('refuses a cell over 2,000 characters before anything else, and a cell with a NUL', async () => {
    const long = 'x'.repeat(2_001);
    expect(await reasonsOf(`keyword,notes\nfresh idea one,${long}\n,${long}\nfresh idea two,a\u0000b\n`)).toEqual([
      'cell_too_long',
      'cell_too_long',
      'cell_invalid',
    ]);
  });

  it('refuses a topic that is too deep and a row with too many or too long tags', async () => {
    const options = {
      defaults: { tags_vocabulary_id: MOCK_VOCABULARY_IDS.topics, topic_vocabulary_id: MOCK_VOCABULARY_IDS.topics },
    };
    const deep = Array.from({ length: 11 }, (_, level) => `level${String(level)}`).join('/');
    const tags = Array.from({ length: 51 }, (_, tag) => `tag${String(tag)}`).join('|');
    expect(
      await reasonsOf(
        `keyword,topic,tags\nfresh idea one,${deep},\nfresh idea two,,${tags}\nfresh idea three,,${'t'.repeat(101)}\nfresh idea four,CRM/Startups,a|A|b\n`,
        options,
      ),
    ).toEqual(['topic_invalid', 'tags_invalid', 'tags_invalid', null]);
  });

  it('keeps the order the backend checks a row in: the first problem is the one named', async () => {
    // A bad location and a bad intent: the location comes first
    expect(await reasonsOf('keyword,location,intent\nfresh idea,Atlantis,buying\n')).toEqual(['location_unknown']);
  });
});

describe('keyword imports: a write that goes wrong', () => {
  const statusOf = async (browser: MockBrowser, path: string): Promise<KeywordImport> =>
    dataOf(await browser.call('GET', path), KEYWORD_IMPORT);
  const FIVE = 'keyword\nfresh idea one\nfresh idea two\nfresh idea three\nfresh idea four\nfresh idea five\n';

  async function confirmed(): Promise<{ editor: MockBrowser; path: string }> {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, FIVE), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    expect((await editor.call('POST', `${path}/confirm`, { duplicate_action: 'skip' })).status).toBe(202);
    clock += SETTLE_MS;
    return { editor, path };
  }

  const reportOf = async (editor: MockBrowser, path: string): Promise<string[][]> =>
    parseCsv(String((await editor.call('GET', `${path}/report`)).body.text));
  const tracked = async (editor: MockBrowser, text: string): Promise<boolean> =>
    dataOf(
      await editor.call('GET', `${P}/tracked-keywords?filter[q]=${encodeURIComponent(text)}`),
      z.array(TRACKED_KEYWORD_ROW),
    ).length > 0;

  it('fails with write_failed after the batches that went through, which stay written, and keeps the report', async () => {
    writeTrouble.stopAfterBatches = 1;
    writeTrouble.batchSize = 2;
    const { editor, path } = await confirmed();
    const view = await statusOf(editor, path);
    expect(view).toMatchObject({
      status: 'failed',
      error_code: 'write_failed',
      // The counts of the preview stay, and nothing is counted as written (the backend counts at the end)
      counts: { rows_total: 5, new: 5, created: 0, skipped: 0, merged: 0 },
      quota: null,
      operation: {
        status: 'failed',
        progress: { done: 2, total: 5 },
        error: { code: 'write_failed' },
        links: { result: `${path}/report` },
      },
    });
    expect(view.finished_at).not.toBeNull();
    expect(await tracked(editor, 'fresh idea one')).toBe(true);
    expect(await tracked(editor, 'fresh idea two')).toBe(true);
    expect(await tracked(editor, 'fresh idea three')).toBe(false);
    // The report says what was written and leaves the rest without a result
    const [head = [], ...lines] = await reportOf(editor, path);
    const result = head.indexOf('result');
    expect(lines.map((cells) => cells[result])).toEqual(['created', 'created', '', '', '']);
  });

  it('completes with errors only when rows could not be written, and says which in the report', async () => {
    writeTrouble.failedRows = [2];
    const { editor, path } = await confirmed();
    expect(await statusOf(editor, path)).toMatchObject({
      status: 'completed_with_errors',
      counts: { created: 4, skipped: 0 },
      operation: { status: 'succeeded_with_errors' },
    });
    expect(await tracked(editor, 'fresh idea two')).toBe(false);
    const [head = [], ...lines] = await reportOf(editor, path);
    const failure = lines.find((cells) => cells[head.indexOf('result')] === 'failed');
    expect(failure?.[head.indexOf('keyword')]).toBe('fresh idea two');
    expect(failure?.[head.indexOf('write_error_code')]).toBe('tracked_keyword_gone');
  });

  it('completes, not with errors, when only the preview skipped rows', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'keyword\nfresh idea one\nsite:fynix.digital seo\n'), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    await editor.call('POST', `${path}/confirm`, { duplicate_action: 'skip' });
    clock += SETTLE_MS;
    expect(await statusOf(editor, path)).toMatchObject({
      status: 'completed',
      counts: { created: 1, skipped: 1, invalid: 1 },
    });
  });
});

describe('keyword imports: statuses and links as the backend gives them', () => {
  const statusOf = async (browser: MockBrowser, path: string): Promise<KeywordImport> =>
    dataOf(await browser.call('GET', path), KEYWORD_IMPORT);

  it('previews a file that has a header and no rows, with no rows, instead of failing', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'keyword\n'), KEYWORD_IMPORT);
    clock += SETTLE_MS;
    expect(await statusOf(editor, `${I}/${started.import_id}`)).toMatchObject({
      status: 'preview_ready',
      error_code: null,
      counts: { rows_total: 0 },
    });
  });

  it('maps an expired preview to a failed operation named expired, and keeps its report', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'keyword\nfresh idea\n'), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    clock += SETTLE_MS;
    clock += 7 * 24 * 60 * 60 * 1000;
    expect(await statusOf(editor, path)).toMatchObject({
      status: 'expired',
      error_code: null,
      operation: { status: 'failed', error: { code: 'expired' }, links: { result: `${path}/report` } },
    });
  });

  it('offers cancel while the import is open and not after, and a report only once there are rows', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'keyword\nfresh idea\n'), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    // Being read: cancel, and no report yet
    const reading = await statusOf(editor, path);
    expect(reading.operation.links).toEqual({ self: path, cancel: `${path}/cancel` });
    expect(await editor.call('GET', `${path}/report`)).toMatchObject({ status: 409, code: 'invalid_state_transition' });
    clock += SETTLE_MS;
    expect((await statusOf(editor, path)).operation.links).toEqual({
      self: path,
      cancel: `${path}/cancel`,
      result: `${path}/report`,
    });
    // Cancelled after the preview: its rows stay reportable; a write cannot be cancelled
    await editor.call('POST', `${path}/confirm`, { duplicate_action: 'skip' });
    expect(await editor.call('POST', `${path}/cancel`)).toMatchObject({ status: 409 });
    clock += SETTLE_MS;
    expect((await statusOf(editor, path)).operation.links.cancel).toBeUndefined();
  });

  it('has a quota only while the preview is ready', async () => {
    const editor = mockBrowser('editor');
    const started = dataOf(await upload(editor, 'keyword\nfresh idea\n'), KEYWORD_IMPORT);
    const path = `${I}/${started.import_id}`;
    expect((await statusOf(editor, path)).quota).toBeNull();
    clock += SETTLE_MS;
    expect((await statusOf(editor, path)).quota).not.toBeNull();
    await editor.call('POST', `${path}/confirm`, { duplicate_action: 'skip' });
    clock += SETTLE_MS;
    expect((await statusOf(editor, path)).quota).toBeNull();
  });

  it('keeps at most 20 imports: the oldest finished ones go, and an open one stays', async () => {
    const editor = mockBrowser('editor');
    const open = dataOf(await upload(editor, 'keyword\nfresh idea\n'), KEYWORD_IMPORT);
    for (let made = 0; made < 25; made += 1) {
      const next = dataOf(await upload(editor, 'keyword\n'), KEYWORD_IMPORT);
      clock += SETTLE_MS;
      await editor.call('POST', `${I}/${next.import_id}/cancel`);
    }
    const listed = dataOf(await editor.call('GET', `${I}?limit=100`), IMPORTS);
    expect(listed.length).toBeLessThanOrEqual(20);
    expect(listed.some((item) => item.import_id === open.import_id)).toBe(true);
  });
});
