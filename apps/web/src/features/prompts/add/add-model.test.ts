import { describe, expect, it } from 'vitest';

import {
  askBlockOf,
  askNowState,
  classifyLines,
  disabledReason,
  engineSkips,
  isUnderCent,
  lineCounts,
  linesToSend,
  planNumbers,
  quotaState,
  refusalOf,
  wouldCreateOf,
  type AskNowState,
  type ClassifiedLine,
} from './add-model';
import { promptKeyOf, readPromptLines } from '../prompt-model';
import type { Schemas } from '@/lib/api/types';

const ID_ACTIVE = '00000000-0000-4000-8000-00000000000a';
const ID_ARCHIVED = '00000000-0000-4000-8000-00000000000b';
const ID_NEAR = '00000000-0000-4000-8000-00000000000c';

/** A lint row as the API answers it for the `items` shape. */
const lintRow = (text: string, extra: Partial<Schemas['PromptLint']> = {}): Schemas['PromptLint'] => ({
  text,
  is_branded: false,
  matched_aliases: [],
  warnings: [],
  suggested_prompt_type: 'question',
  ...extra,
});
const classify = (
  text: string,
  lint: readonly Schemas['PromptLint'][] | null,
  existing: readonly string[] = [],
): ClassifiedLine[] =>
  classifyLines({
    read: readPromptLines(text),
    lint,
    existingKeys: new Set(existing.map((line) => promptKeyOf(line, 'en', 'DE'))),
    languageCode: 'en',
    countryIso: 'DE',
  });
const groups = (lines: readonly ClassifiedLine[]): string[] =>
  lines.map((line) => `${String(line.line)}:${line.group}`);

describe('classifying the lines of a pasted list', () => {
  it('counts an archived duplicate that is not on the loaded page as tracked, and keeps its id for a restore', () => {
    const lines = classify('Fresh question one?\nArchived question?', [
      lintRow('Fresh question one?'),
      lintRow('Archived question?', { tracked: { prompt_id: ID_ARCHIVED, is_active: false } }),
    ]);
    expect(groups(lines)).toEqual(['1:new', '2:archived']);
    expect(lines[1]).toMatchObject({ promptId: ID_ARCHIVED, text: 'Archived question?' });
    const counts = lineCounts(lines);
    // Archived counts as tracked, and says how many of them are archived
    expect(counts).toEqual({ lines: 2, new: 1, tracked: 1, archived: 1, repeats: 0, refused: 0 });
  });

  it('lets an authoritative lint answer of not tracked win over the loaded page, and keeps the fallback for a text it has no row for', () => {
    const text = 'Known on the page?\nNo row for this one?';
    const classifyWith = (authoritative: boolean): ClassifiedLine[] =>
      classifyLines({
        read: readPromptLines(text),
        // The lint says the first is not tracked (`tracked: null`) and has no row for the second
        lint: [lintRow('Known on the page?', { tracked: null })],
        existingKeys: new Set(
          ['Known on the page?', 'No row for this one?'].map((line) => promptKeyOf(line, 'en', 'DE')),
        ),
        languageCode: 'en',
        countryIso: 'DE',
        authoritative,
      });
    expect(groups(classifyWith(true))).toEqual(['1:new', '2:tracked']);
    // Not authoritative (no country, or no answer): the loaded page decides both
    expect(groups(classifyWith(false))).toEqual(['1:tracked', '2:tracked']);
  });

  it('decides tracked by the lint, not by the loaded page: an active prompt past the first page is tracked', () => {
    const lines = classify('Past the first page?', [
      lintRow('Past the first page?', { tracked: { prompt_id: ID_ACTIVE, is_active: true } }),
    ]);
    expect(groups(lines)).toEqual(['1:tracked']);
    expect(lines[0]?.promptId).toBe(ID_ACTIVE);
    expect(lineCounts(lines)).toMatchObject({ new: 0, tracked: 1, archived: 0 });
  });

  it('falls back to the loaded active prompts while the lint is pending or failed, and for a text it did not see', () => {
    expect(groups(classify('Loaded question?\nOther question?', null, ['Loaded question?']))).toEqual([
      '1:tracked',
      '2:new',
    ]);
    // The `texts` shape answers no `tracked` member: the loaded page still decides
    expect(groups(classify('Loaded question?', [lintRow('Loaded question?')], ['Loaded question?']))).toEqual([
      '1:tracked',
    ]);
    // A market other than the form's is another prompt
    const other = classifyLines({
      read: readPromptLines('Loaded question?'),
      lint: null,
      existingKeys: new Set([promptKeyOf('Loaded question?', 'en', 'FR')]),
      languageCode: 'en',
      countryIso: 'DE',
    });
    expect(groups(other)).toEqual(['1:new']);
  });

  it('leaves a repeat out and names the line it repeats by its first line', () => {
    const lines = classify('Same line?\nOther line?\nSame line?', [lintRow('Same line?'), lintRow('Other line?')]);
    expect(groups(lines)).toEqual(['1:new', '2:new', '3:repeat']);
    expect(lines[2]).toMatchObject({ first: 1, text: 'Same line?' });
    expect(lineCounts(lines)).toMatchObject({ lines: 3, new: 2, repeats: 1 });
  });

  it('keeps a refused line refused, whatever the lint says about it', () => {
    const long = 'x'.repeat(2001);
    const hidden = `Zero${String.fromCodePoint(0x200d)}width?`;
    const lines = classify(`${long}\n${hidden}\nFine one?`, [lintRow('Fine one?')]);
    expect(groups(lines)).toEqual(['1:refused', '2:refused', '3:new']);
    expect(lines.map((line) => line.refusal)).toEqual(['tooLong', 'unsupported', null]);
    expect(lineCounts(lines)).toMatchObject({ refused: 2, new: 1 });
    expect(refusalOf('x'.repeat(2000))).toBeNull();
    expect(refusalOf(long)).toBe('tooLong');
  });

  it('carries a near duplicate on a new line, and none on a tracked one', () => {
    const lines = classify('Best CRM for startups?', [
      lintRow('Best CRM for startups?', { near_duplicate_of: { prompt_id: ID_NEAR, text: 'best crm for startups?' } }),
    ]);
    expect(lines[0]).toMatchObject({
      group: 'new',
      nearDuplicate: { promptId: ID_NEAR, text: 'best crm for startups?' },
    });
    expect(lineCounts(lines).new).toBe(1);
  });

  it('puts the lines in the order the person typed them, repeats and refusals among the rest', () => {
    const lines = classify(`A one?\n\nB two?\nA one?\n${'y'.repeat(2001)}`, null);
    expect(lines.map((line) => line.line)).toEqual([1, 3, 4, 5]);
    expect(groups(lines)).toEqual(['1:new', '3:new', '4:repeat', '5:refused']);
  });

  it('sends only the new lines, near duplicates included', () => {
    const lines = classify('New one?\nTracked one?\nNear one?', [
      lintRow('New one?'),
      lintRow('Tracked one?', { tracked: { prompt_id: ID_ACTIVE, is_active: true } }),
      lintRow('Near one?', { near_duplicate_of: { prompt_id: ID_NEAR, text: 'near one?' } }),
    ]);
    expect(linesToSend(lines).map((line) => line.text)).toEqual(['New one?', 'Near one?']);
  });
});

describe('the places an add takes', () => {
  it('fits at exactly the room left and is over by one', () => {
    const exact = quotaState({ limit: 150, used: 140 }, 10, 0);
    expect(exact).toEqual({ limit: 150, used: 140, room: 10, needs: 10, after: 150, over: false, short: 0 });
    const over = quotaState({ limit: 150, used: 140 }, 11, 0);
    expect(over).toMatchObject({ room: 10, needs: 11, after: 151, over: true, short: 1 });
  });

  it('has no room at 0 left, and never a negative room when the workspace is already over', () => {
    expect(quotaState({ limit: 150, used: 150 }, 0, 0)).toMatchObject({ room: 0, needs: 0, over: false });
    expect(quotaState({ limit: 150, used: 150 }, 1, 0)).toMatchObject({ room: 0, over: true, short: 1 });
    expect(quotaState({ limit: 150, used: 160 }, 0, 0)).toMatchObject({ room: 0, over: false });
    expect(quotaState({ limit: 150, used: 160 }, 2, 0)).toMatchObject({ room: 0, over: true, short: 2 });
  });

  it('counts the prompts to restore beside the ones to create', () => {
    const state = quotaState({ limit: 150, used: 145 }, 3, 3);
    expect(state).toMatchObject({ needs: 6, after: 151, over: true, short: 1 });
    expect(quotaState({ limit: 150, used: 145 }, 3, 2)).toMatchObject({ needs: 5, after: 150, over: false });
  });

  it('takes the number the lint gave, else the client count of new lines', () => {
    const counts = { lines: 5, new: 4, tracked: 1, archived: 0, repeats: 0, refused: 0 };
    expect(wouldCreateOf({ limit: 150, used: 24, would_create: 3 }, counts)).toBe(3);
    expect(wouldCreateOf({ limit: 150, used: 24 }, counts)).toBe(4);
    expect(wouldCreateOf({ limit: 150, used: 24, would_create: null }, counts)).toBe(4);
    expect(wouldCreateOf(null, counts)).toBe(4);
    expect(wouldCreateOf({ limit: 150, used: 24, would_create: 0 }, counts)).toBe(0);
  });
});

describe('the numbers of the plan', () => {
  const chatgpt: Schemas['EngineEstimate'] = {
    engine_code: 'chatgpt_web',
    prompts_fit: 9,
    answers_per_month: 78,
    monthly_cost_usd: '0.03',
    run_now_answers: 9,
    run_now_cost_usd: '0.010800',
  };
  const estimate: Schemas['LintEstimate'] = {
    engines: [
      chatgpt,
      {
        engine_code: 'gemini_web',
        prompts_fit: 7,
        answers_per_month: 60,
        monthly_cost_usd: '0.02',
        run_now_answers: 7,
        run_now_cost_usd: '0.008400',
      },
    ],
    total_monthly_cost_usd: '0.05',
  };

  it('adds the answers of the engines and reads the money as numbers', () => {
    expect(planNumbers(estimate, 9)).toEqual({
      prompts: 9,
      engines: [
        {
          engineCode: 'chatgpt_web',
          promptsFit: 9,
          answersPerMonth: 78,
          monthlyCost: 0.03,
          runNowAnswers: 9,
          runNowCost: 0.0108,
        },
        {
          engineCode: 'gemini_web',
          promptsFit: 7,
          answersPerMonth: 60,
          monthlyCost: 0.02,
          runNowAnswers: 7,
          runNowCost: 0.0084,
        },
      ],
      answersPerMonth: 138,
      monthlyCost: 0.05,
      runNowAnswers: 16,
      runNowCost: 0.0192,
      unpricedEngines: [],
    });
  });

  it('gives no cost, not zero, for an estimate price that is null, and names the engine without a price', () => {
    const partial = planNumbers(
      {
        engines: [
          chatgpt,
          {
            engine_code: 'google_ai_mode',
            prompts_fit: 2,
            answers_per_month: 17,
            monthly_cost_usd: null,
            run_now_answers: 2,
            run_now_cost_usd: null,
          },
        ],
        total_monthly_cost_usd: '0.03',
      },
      9,
    );
    expect(partial?.engines[1]).toMatchObject({ monthlyCost: null, runNowCost: null });
    expect(partial?.unpricedEngines).toEqual(['google_ai_mode']);
    expect(partial?.monthlyCost).toBe(0.03);
    const none = planNumbers(
      {
        engines: [
          {
            engine_code: 'google_ai_mode',
            prompts_fit: 2,
            answers_per_month: 17,
            monthly_cost_usd: null,
            run_now_answers: 2,
            run_now_cost_usd: null,
          },
        ],
        total_monthly_cost_usd: null,
      },
      2,
    );
    expect(none).toMatchObject({ monthlyCost: null, runNowCost: null, unpricedEngines: ['google_ai_mode'] });
  });

  it('has no plan without an estimate, never a plan of zeros', () => {
    expect(planNumbers(null, 4)).toBeNull();
    expect(planNumbers(undefined, 4)).toBeNull();
  });
});

describe('why the add is off', () => {
  const counts = { lines: 3, new: 2, tracked: 1, archived: 0, repeats: 0, refused: 0 };
  const fits = quotaState({ limit: 150, used: 24 }, 2, 0);

  it('is on when a line would be sent and it fits', () => {
    expect(disabledReason(counts, fits, 0)).toBeNull();
    expect(disabledReason(counts, null, 0)).toBeNull();
  });

  it('says nothing to add, a line that cannot be added, everything tracked and over the quota, in that order', () => {
    expect(disabledReason({ ...counts, lines: 0, new: 0, tracked: 0 }, null, 0)).toBe('empty');
    expect(disabledReason({ ...counts, refused: 1 }, fits, 0)).toBe('cannotAdd');
    expect(disabledReason({ ...counts, new: 0, tracked: 3 }, fits, 0)).toBe('allTracked');
    expect(disabledReason(counts, quotaState({ limit: 150, used: 149 }, 2, 0), 0)).toBe('overQuota');
    // A refused line wins over a quota that is over
    expect(disabledReason({ ...counts, refused: 1 }, quotaState({ limit: 150, used: 149 }, 2, 0), 0)).toBe('cannotAdd');
  });

  it('is on for a list of archived prompts alone, as the restore is the add', () => {
    const archived = { lines: 2, new: 0, tracked: 2, archived: 2, repeats: 0, refused: 0 };
    expect(disabledReason(archived, quotaState({ limit: 150, used: 24 }, 0, 2), 2)).toBeNull();
    expect(disabledReason(archived, quotaState({ limit: 150, used: 24 }, 0, 0), 0)).toBe('allTracked');
  });
});

describe('the engines that skip some of the prompts', () => {
  const engine = (code: Schemas['EngineEstimate']['engine_code'], fit: number): Schemas['EngineEstimate'] => ({
    engine_code: code,
    prompts_fit: fit,
    answers_per_month: fit * 8,
    monthly_cost_usd: '0.01',
    run_now_answers: fit,
    run_now_cost_usd: '0.001200',
  });

  it('counts, per engine, the prompts that do not fit its length, and leaves out the engines that skip none', () => {
    const plan = planNumbers(
      { engines: [engine('chatgpt_web', 9), engine('google_ai_mode', 7)], total_monthly_cost_usd: '0.02' },
      9,
    );
    expect(engineSkips(plan, 9)).toEqual([{ engineCode: 'google_ai_mode', count: 2 }]);
    expect(engineSkips(null, 9)).toEqual([]);
  });
});

describe('asking the new prompts now', () => {
  const plan = (prompts: number): NonNullable<ReturnType<typeof planNumbers>> => {
    const made = planNumbers(
      {
        engines: [
          {
            engine_code: 'chatgpt_web',
            prompts_fit: prompts,
            answers_per_month: prompts * 8,
            monthly_cost_usd: '0.03',
            run_now_answers: prompts,
            run_now_cost_usd: '0.010800',
          },
        ],
        total_monthly_cost_usd: '0.03',
      },
      prompts,
    );
    if (made === null) throw new Error('The estimate gave no plan');
    return made;
  };

  it('is one manual run up to the size of a run, and a run for each part beyond it', () => {
    expect(askNowState(plan(9), 9, { used: 4, limit: 20 }, 150)).toMatchObject({
      runs: 1,
      sizes: [9],
      answers: 9,
      used: 4,
      limit: 20,
    });
    expect(askNowState(plan(150), 150, { used: 4, limit: 20 }, 150)).toMatchObject({ runs: 1, sizes: [150] });
    expect(askNowState(plan(180), 180, { used: 4, limit: 20 }, 150)).toMatchObject({ runs: 2, sizes: [150, 30] });
    expect(askNowState(plan(400), 400, { used: 4, limit: 20 }, 150)).toMatchObject({
      runs: 3,
      sizes: [150, 150, 100],
    });
  });

  it('is blocked only when the day does not have the runs left, and exactly fitting is not blocked', () => {
    expect(askNowState(plan(180), 180, { used: 18, limit: 20 }, 150)?.blocked).toBe(false);
    expect(askNowState(plan(180), 180, { used: 19, limit: 20 }, 150)?.blocked).toBe(true);
    expect(askNowState(plan(9), 9, { used: 20, limit: 20 }, 150)?.blocked).toBe(true);
  });

  it('keeps the run count when the day is not known, and says the run is not blocked by it', () => {
    expect(askNowState(plan(9), 9, null, 150)).toMatchObject({ runs: 1, used: null, limit: null, blocked: false });
  });

  it('has nothing to ask for no prompt or without an estimate', () => {
    expect(askNowState(null, 9, { used: 0, limit: 20 }, 150)).toBeNull();
    expect(askNowState(plan(9), 0, { used: 0, limit: 20 }, 150)).toBeNull();
  });

  it('names why asking is off: every run of the day used, or fewer left than the ask needs, and nothing while it fits', () => {
    const asked = (prompts: number, manual: { used: number; limit: number } | null): AskNowState => {
      const state = askNowState(plan(prompts), prompts, manual, 150);
      if (state === null) throw new Error('The ask was expected');
      return state;
    };
    expect(askBlockOf(asked(9, { used: 20, limit: 20 }))).toEqual({ kind: 'used', limit: 20 });
    expect(askBlockOf(asked(180, { used: 19, limit: 20 }))).toEqual({ kind: 'short', runs: 2, left: 1 });
    expect(askBlockOf(asked(180, { used: 18, limit: 20 }))).toBeNull();
    expect(askBlockOf(asked(9, null))).toBeNull();
  });

  it('writes under a cent only for answers that cost less than one, never for no answers', () => {
    expect(isUnderCent(0.004, 8)).toBe(true);
    expect(isUnderCent(0, 8)).toBe(true);
    expect(isUnderCent(0.01, 8)).toBe(false);
    expect(isUnderCent(0, 0)).toBe(false);
  });

  it('gives no cost, not zero, when no engine has a run price', () => {
    const unpriced = planNumbers(
      {
        engines: [
          {
            engine_code: 'google_ai_mode',
            prompts_fit: 2,
            answers_per_month: 17,
            monthly_cost_usd: null,
            run_now_answers: 2,
            run_now_cost_usd: null,
          },
        ],
        total_monthly_cost_usd: null,
      },
      2,
    );
    expect(askNowState(unpriced, 2, { used: 0, limit: 20 }, 150)).toMatchObject({ answers: 2, cost: null });
  });
});
