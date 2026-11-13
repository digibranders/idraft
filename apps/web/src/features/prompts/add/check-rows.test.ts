import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { classifyLines, lineCounts } from './add-model';
import { checkRowsOf, counterText, groupRows, type CheckContext, type CheckRow } from './check-rows';
import { promptKeyOf, readPromptLines } from '../prompt-model';
import type { EngineCode, Schemas } from '@/lib/api/types';
import messages from '../../../../messages/en.json';

const t = createTranslator({ locale: 'en', messages, namespace: 'prompts.add' });

const ID_ACTIVE = '00000000-0000-4000-8000-00000000000a';
const ID_ARCHIVED = '00000000-0000-4000-8000-00000000000b';
const ID_NEAR = '00000000-0000-4000-8000-00000000000c';

type Warning = Schemas['LintWarning'];
const warning = (rule: Warning['rule'], message: string, extra: Partial<Warning> = {}): Warning => ({
  rule,
  severity: 'warning',
  message,
  engine_code: null,
  span: null,
  ...extra,
});
const lintRow = (text: string, extra: Partial<Schemas['PromptLint']> = {}): Schemas['PromptLint'] => ({
  text,
  is_branded: false,
  matched_aliases: [],
  warnings: [],
  suggested_prompt_type: 'question',
  ...extra,
});

const ENGINES = new Map<EngineCode, string>([
  ['chatgpt_web', 'ChatGPT'],
  ['google_ai_mode', 'AI Mode'],
]);
const context = (extra: Partial<CheckContext> = {}): CheckContext => ({
  languageCode: 'en',
  engineLabels: ENGINES,
  promptType: null,
  ...extra,
});

function rowsOf(
  text: string,
  lint: readonly Schemas['PromptLint'][] | null,
  extra: Partial<CheckContext> = {},
  existing: readonly string[] = [],
): CheckRow[] {
  const lines = classifyLines({
    read: readPromptLines(text),
    lint,
    existingKeys: new Set(existing.map((line) => promptKeyOf(line, 'en', 'DE'))),
    languageCode: 'en',
    countryIso: 'DE',
  });
  return checkRowsOf(lines, lint, context(extra), t);
}
const only = (rows: readonly CheckRow[]): CheckRow => {
  const [row] = rows;
  if (row === undefined) throw new Error('A row was expected');
  return row;
};

describe('the rows of the check list', () => {
  it('give each outcome its reason, and the prompt to show for a tracked or archived line', () => {
    const rows = rowsOf('Active question?\nArchived question?\nActive question?\nFresh question?', [
      lintRow('Active question?', { tracked: { prompt_id: ID_ACTIVE, is_active: true } }),
      lintRow('Archived question?', { tracked: { prompt_id: ID_ARCHIVED, is_active: false } }),
      lintRow('Fresh question?'),
    ]);
    expect(rows.map((row) => `${String(row.line)}:${row.group}`)).toEqual([
      '1:tracked',
      '2:archived',
      '3:repeat',
      '4:new',
    ]);
    expect(rows[0]).toMatchObject({
      target: ID_ACTIVE,
      language: 'en',
      reasons: [{ tone: 'note', text: 'Already tracked, so it is left out.' }],
    });
    expect(rows[1]?.reasons[0]?.text).toBe('Archived. Restoring it brings back its history and answers.');
    expect(rows[2]?.reasons[0]?.text).toBe('Repeats line 1 and is left out.');
    expect(rows[3]?.reasons).toEqual([]);
  });

  it('say a tracked line is tracked without a prompt to show when only the loaded page knew it', () => {
    const row = only(rowsOf('Known question?', null, {}, ['Known question?']));
    expect(row).toMatchObject({ group: 'tracked', target: null });
  });

  it('name why a line cannot be added, as an error', () => {
    const long = `${'a'.repeat(2001)}?`;
    // A joiner is kept when the list is read, and the API refuses it
    const rows = rowsOf(`${long}\nBad${String.fromCodePoint(0x200d)}line?`, null);
    expect(rows[0]?.group).toBe('refused');
    expect(rows[0]?.reasons).toEqual([{ tone: 'error', text: 'Longer than 2,000 characters, so it cannot be added.' }]);
    expect(rows[1]?.reasons[0]).toMatchObject({ tone: 'error' });
  });

  it.each([
    ['word_count', 'Has 2 words. Prompts of 5 to 60 words read like real questions.'],
    ['multiple_questions', 'Asks more than one question. Answers to it will mix them.'],
    ['leading_wording', 'The wording leads the answer. It measures agreement, not visibility.'],
    ['language_mismatch', 'Reads as German, and the prompt is set to English.'],
    [
      'contains_competitor_alias',
      'Names HubSpot. A competitor named in the prompt is likely to be named in the answer.',
    ],
  ] as const)(
    'show the wording of %s on its line as a warning that does not make the line unaddable',
    (rule, message) => {
      const row = only(
        rowsOf('A question here?', [lintRow('A question here?', { warnings: [warning(rule, message)] })]),
      );
      expect(row.group).toBe('new');
      expect(row.reasons).toEqual([{ tone: 'warning', text: message }]);
    },
  );

  it('turns a competitor name into a note when the prompt type is a comparison', () => {
    const text = 'HubSpot or Pipedrive for a small team?';
    const rule = warning(
      'contains_competitor_alias',
      'Names HubSpot. A competitor named in the prompt is likely to be named in the answer.',
      {
        span: { start: 0, end: 7 },
      },
    );
    const lint = [lintRow(text, { warnings: [rule] })];
    expect(only(rowsOf(text, lint)).reasons[0]).toMatchObject({ tone: 'warning' });
    expect(only(rowsOf(text, lint, { promptType: 'comparison' })).reasons).toEqual([
      { tone: 'note', text: 'Compares with HubSpot.' },
    ]);
    // Set from wording: the type the server rule suggests decides
    const suggested = [lintRow(text, { warnings: [rule], suggested_prompt_type: 'comparison' })];
    expect(only(rowsOf(text, suggested)).reasons[0]).toMatchObject({ tone: 'note' });
  });

  it('names the own brand as a note, and an engine limit by the engine, and drops the limit of an engine that is off', () => {
    const text = 'Is Acme worth it for a small agency?';
    const row = only(
      rowsOf(text, [
        lintRow(text, {
          is_branded: true,
          matched_aliases: [
            { alias: 'Acme', entity: { entity_id: 'e', canonical_name: 'Acme Inc', kind: 'company' } },
          ] as unknown as Schemas['PromptLint']['matched_aliases'],
          warnings: [
            warning('contains_brand_alias', 'Names Acme.'),
            warning('engine_limit', 'ignored wording', { engine_code: 'google_ai_mode' }),
            warning('engine_limit', 'ignored wording', { engine_code: 'gemini_web' }),
          ],
        }),
      ]),
    );
    expect(row.reasons).toEqual([
      { tone: 'warning', text: 'Too long for AI Mode, which skips it.' },
      {
        tone: 'note',
        text: 'Names Acme Inc, so it counts as branded and stays out of the rates unless branded prompts are included.',
      },
    ]);
  });

  it('shows a near duplicate as a note that does not move the line out of the new ones', () => {
    const row = only(
      rowsOf('best crm for startups', [
        lintRow('best crm for startups', { near_duplicate_of: { prompt_id: ID_NEAR, text: 'Best CRM for Startups' } }),
      ]),
    );
    expect(row.group).toBe('new');
    expect(row.reasons).toEqual([
      {
        tone: 'note',
        text: 'Differs from a tracked prompt only in case or spacing: “Best CRM for Startups”. Both will be asked.',
      },
    ]);
  });

  it('lists the most serious reason first', () => {
    const text = 'Some question that is long?';
    const row = only(
      rowsOf(text, [
        lintRow(text, {
          near_duplicate_of: { prompt_id: ID_NEAR, text: 'some question that is long?' },
          warnings: [warning('multiple_questions', 'Asks more than one question. Answers to it will mix them.')],
        }),
      ]),
    );
    expect(row.reasons.map((reason) => reason.tone)).toEqual(['warning', 'note']);
  });

  it('suggests the type from the wording until the person chooses one', () => {
    const lint = [lintRow('Asana vs Trello for agencies?', { suggested_prompt_type: 'comparison' })];
    expect(only(rowsOf('Asana vs Trello for agencies?', lint)).suggestedType).toBe('Type: comparison (from wording)');
    expect(only(rowsOf('Asana vs Trello for agencies?', lint, { promptType: 'question' })).suggestedType).toBeNull();
    const howTo = [lintRow('How to pick a CRM for a team', { suggested_prompt_type: 'how_to' })];
    expect(only(rowsOf('How to pick a CRM for a team', howTo)).suggestedType).toBe('Type: how to (from wording)');
    // A line that is not added has no type to suggest
    expect(
      only(
        rowsOf('Known question?', [lintRow('Known question?', { tracked: { prompt_id: ID_ACTIVE, is_active: true } })]),
      ).suggestedType,
    ).toBeNull();
  });
});

describe('the groups of the check list', () => {
  const rows = (): CheckRow[] =>
    rowsOf('Known?\nWarned question here?\nPlain question here?\nKnown?\nArchived one?', [
      lintRow('Known?', { tracked: { prompt_id: ID_ACTIVE, is_active: true } }),
      lintRow('Warned question here?', {
        warnings: [warning('word_count', 'Has 3 words. Prompts of 5 to 60 words read like real questions.')],
        near_duplicate_of: { prompt_id: ID_NEAR, text: 'warned question here?' },
      }),
      lintRow('Plain question here?'),
      lintRow('Archived one?', { tracked: { prompt_id: ID_ARCHIVED, is_active: false } }),
    ]);

  it('put the lines that cannot be added first, then warnings, then the outcomes, and leave empty groups out', () => {
    expect(groupRows(rows()).map((group) => `${group.id}:${String(group.rows.length)}`)).toEqual([
      'warnings:1',
      'new:2',
      'tracked:1',
      'archived:1',
      'repeat:1',
    ]);
    const refused = rowsOf(`${'a'.repeat(2001)}\nFine question here?`, null);
    expect(groupRows(refused).map((group) => group.id)).toEqual(['refused', 'new']);
  });

  it('keep the warning of a line in Warnings and its notes in Will be added', () => {
    const [warnings, added] = groupRows(rows());
    expect(warnings?.rows[0]?.reasons.map((reason) => reason.tone)).toEqual(['warning']);
    const warned = added?.rows.find((row) => row.line === 2);
    expect(warned?.reasons.map((reason) => reason.tone)).toEqual(['note']);
    expect(added?.rows.map((row) => row.line)).toEqual([2, 3]);
  });
});

describe('the counter under the field', () => {
  const counter = (text: string, lint: readonly Schemas['PromptLint'][] | null): string | null => {
    const lines = classifyLines({
      read: readPromptLines(text),
      lint,
      existingKeys: new Set(),
      languageCode: 'en',
      countryIso: 'DE',
    });
    return counterText(t, 'en', lineCounts(lines));
  };

  it('splits new, already tracked and repeats, and leaves out a part that is zero', () => {
    const lines = Array.from({ length: 9 }, (_, index) => `Fresh question number ${String(index)}?`);
    const tracked = ['Tracked one?', 'Tracked two?'];
    const text = [...lines, ...tracked, lines[0] ?? ''].join('\n');
    const lint = tracked.map((line, index) =>
      lintRow(line, { tracked: { prompt_id: `${ID_ACTIVE}${String(index)}`, is_active: true } }),
    );
    expect(counter(text, lint)).toBe('12 lines: 9 new, 2 already tracked, and 1 repeat');
    expect(counter('One new question?', null)).toBe('1 line: 1 new');
  });

  it('is empty when there is no line, counts an archived line as tracked, and counts the lines that cannot be added', () => {
    expect(counter('', null)).toBeNull();
    expect(
      counter('Archived?\nFresh question?', [
        lintRow('Archived?', { tracked: { prompt_id: ID_ARCHIVED, is_active: false } }),
      ]),
    ).toBe('2 lines: 1 new and 1 already tracked (1 archived)');
    expect(counter(`${'a'.repeat(2001)}\nFresh question?`, null)).toBe('2 lines: 1 new and 1 cannot be added');
  });
});
