import { describe, expect, it } from 'vitest';

import {
  checkText,
  countWords,
  estimateCost,
  foldText,
  matchItems,
  suggestPromptType,
  type Named,
  type TrackedRow,
} from './prompt-lint-rules';

const named = (text: string, name: string, isCompetitor: boolean): Named => {
  const start = text.indexOf(name);
  return { name, isCompetitor, spans: [[start, start + name.length]] };
};
const rulesOf = (text: string, names: readonly Named[] = [], language: string | null = null): string[] =>
  checkText(text, names, language).map((finding) => finding.rule);

describe('the words of a text', () => {
  it('counts white space tokens, and a token of a script written without spaces as half its characters', () => {
    expect(countWords('What is the best CRM for a small team?')).toBe(9);
    expect(countWords('  one   two\tthree\nfour ')).toBe(4);
    // 16 Han characters in one token: 8 words
    expect(countWords(String.fromCodePoint(...Array.from({ length: 16 }, (_, n) => 0x4e00 + n)))).toBe(8);
    expect(countWords('')).toBe(0);
  });
});

describe('the type the wording gives', () => {
  it('follows the owner rule: comparison, how to, question, else other, with no recommendation branch', () => {
    expect(suggestPromptType('Asana vs Trello for a ten person agency')).toBe('comparison');
    expect(suggestPromptType('Asana versus Trello')).toBe('comparison');
    expect(suggestPromptType('Teach me how to run an audit')).toBe('how_to');
    expect(suggestPromptType('what are the best project management tools for remote teams?')).toBe('question');
    expect(suggestPromptType('Our agency list ends with a mark?')).toBe('question');
    expect(suggestPromptType('best crm')).toBe('other');
    // The first match wins: a comparison with a leading question word is still a comparison
    expect(suggestPromptType('Which is better, Asana vs Trello?')).toBe('comparison');
  });
});

describe('the five rules of the text', () => {
  it('word_count: under 5 or over 60 words is a warning, with the singular for one word', () => {
    expect(checkText('best crm', [], null)).toEqual([
      {
        rule: 'word_count',
        severity: 'warning',
        message: 'Has 2 words. Prompts of 5 to 60 words read like real questions.',
        span: null,
      },
    ]);
    expect(checkText('Hello', [], null)[0]?.message).toBe(
      'Has 1 word. Prompts of 5 to 60 words read like real questions.',
    );
    expect(rulesOf('one two three four five')).toEqual([]);
    expect(rulesOf(Array.from({ length: 60 }, () => 'word').join(' '))).toEqual([]);
    expect(rulesOf(Array.from({ length: 61 }, () => 'word').join(' '))).toEqual(['word_count']);
  });

  it('multiple_questions: more than one run of question marks, the full width and Arabic ones included', () => {
    const two = 'What is the best CRM for a team? Which one is cheapest?';
    expect(checkText(two, [], null)).toEqual([
      {
        rule: 'multiple_questions',
        severity: 'warning',
        message: 'Asks more than one question. Answers to it will mix them.',
        span: null,
      },
    ]);
    expect(rulesOf('What is the best CRM for a team???')).toEqual([]);
    expect(rulesOf(`Which CRM suits a team${String.fromCodePoint(0xff1f)} Which one costs less?`)).toEqual([
      'multiple_questions',
    ]);
  });

  it('leading_wording: a superlative within 3 words of a name, or "why is X the best", with the span of the word', () => {
    const text = 'Why is Rankforge the best agency for startups?';
    const found = checkText(text, [named(text, 'Rankforge', true)], null).filter(
      (finding) => finding.rule === 'leading_wording',
    );
    const best = text.indexOf('best');
    expect(found).toEqual([
      {
        rule: 'leading_wording',
        severity: 'warning',
        message: 'The wording leads the answer. It measures agreement, not visibility.',
        span: { start: best, end: best + 4 },
      },
    ]);
    // Far from any name, a superlative is just a word
    const far = 'What is the best way to plan a content calendar for Rankforge';
    expect(rulesOf(far, [named(far, 'Rankforge', true)])).not.toContain('leading_wording');
    // The pattern needs no name
    expect(rulesOf('Why is this tool the best option for remote teams?')).toEqual(['leading_wording']);
  });

  it('contains_competitor_alias: a warning, or a note when the text compares', () => {
    const plain = 'Is Rankforge a good choice for a small agency?';
    expect(checkText(plain, [named(plain, 'Rankforge', true)], null)).toEqual([
      {
        rule: 'contains_competitor_alias',
        severity: 'warning',
        message: 'Names Rankforge. A competitor named in the prompt is likely to be named in the answer.',
        span: { start: 3, end: 12 },
      },
    ]);
    const versus = 'Rankforge vs Fynix for a small agency in Berlin';
    expect(checkText(versus, [named(versus, 'Rankforge', true)], null)).toEqual([
      {
        rule: 'contains_competitor_alias',
        severity: 'info',
        message: 'Compares with Rankforge.',
        span: { start: 0, end: 9 },
      },
    ]);
    // An own name is not a competitor
    expect(rulesOf(plain, [named(plain, 'Rankforge', false)])).toEqual([]);
  });

  it('language_mismatch: by script, or by function words of the seven Latin languages, from 4 words, only with a language', () => {
    const french = 'Quelle est la meilleure solution de facturation pour une petite entreprise ?';
    expect(checkText(french, [], 'en')).toEqual([
      {
        rule: 'language_mismatch',
        severity: 'warning',
        message: 'Reads as French, and the prompt is set to English.',
        span: null,
      },
    ]);
    expect(rulesOf(french)).toEqual([]);
    expect(rulesOf(french, [], 'fr')).toEqual([]);
    const han = String.fromCodePoint(...Array.from({ length: 16 }, (_, n) => 0x4e00 + n));
    expect(checkText(han, [], 'en')[0]?.message).toBe('Reads as Han, and the prompt is set to English.');
    // Under 4 words nothing is said
    expect(rulesOf('Quelle est la', [], 'en')).not.toContain('language_mismatch');
    // An unknown language code skips the script table and the function words
    expect(rulesOf(french, [], 'xx')).toEqual([]);
  });

  it('gives the findings in the contract order: competitor, leading, questions, length, language', () => {
    const text = 'Rankforge best? Is it?';
    expect(rulesOf(text, [named(text, 'Rankforge', true)], 'en')).toEqual([
      'contains_competitor_alias',
      'leading_wording',
      'multiple_questions',
      'word_count',
    ]);
  });
});

describe('what the project has for each item', () => {
  const rows: TrackedRow[] = [
    { id: 'a', text: 'Best CRM for startups', language_code: 'en', country_iso: 'US', is_active: true },
    { id: 'b', text: 'Asana vs Trello', language_code: 'en', country_iso: 'US', is_active: false },
  ];
  const item = (
    text: string,
    country = 'US',
    language = 'en',
  ): { text: string; language_code: string; country_iso: string } => ({
    text,
    language_code: language,
    country_iso: country,
  });

  it('finds the tracked prompt by text, language and country, archived ones too, and the oldest wins', () => {
    const match = matchItems(
      [item('Best CRM for startups'), item('Asana vs Trello'), item('Best CRM for startups', 'DE'), item('Unseen')],
      [...rows, { id: 'c', text: 'Best CRM for startups', language_code: 'en', country_iso: 'US', is_active: true }],
    );
    expect(match.tracked).toEqual([
      { prompt_id: 'a', is_active: true },
      { prompt_id: 'b', is_active: false },
      null,
      null,
    ]);
    expect(match.creates).toEqual([false, false, true, true]);
  });

  it('names a near duplicate only when the text is not tracked: case and spacing set aside, same market', () => {
    const match = matchItems(
      [item('  best   crm FOR startups '), item('best crm for startups', 'DE'), item('Best CRM for startups')],
      rows,
    );
    expect(match.near_duplicate_of).toEqual([{ prompt_id: 'a', text: 'Best CRM for startups' }, null, null]);
    // The spaces are folded by the matcher only; a trimmed item is the identity as the server compares it
    expect(match.tracked[0]).toBeNull();
    expect(match.creates[0]).toBe(true);
  });

  it('names a near duplicate among the archived prompts too, as the server does', () => {
    const match = matchItems([item('asana  VS trello')], rows);
    expect(match.near_duplicate_of).toEqual([{ prompt_id: 'b', text: 'Asana vs Trello' }]);
  });

  it('counts a repeat, a tracked text and a text over 2,000 characters as not created', () => {
    const long = 'x'.repeat(2001);
    const match = matchItems([item('Fresh one'), item('Fresh one'), item(long), item('x'.repeat(2000))], []);
    expect(match.creates).toEqual([true, false, false, true]);
  });

  it('folds case and spaces', () => {
    expect(foldText('  Best   CRM\tfor ')).toBe('best crm for');
  });
});

describe('the estimate', () => {
  it('rounds answers down and money to the cent, and keeps the run now values unrounded', () => {
    const estimate = estimateCost(['one', 'two', 'three'], ['chatgpt_web', 'gemini_web']);
    expect(estimate.engines).toEqual([
      {
        engine_code: 'chatgpt_web',
        prompts_fit: 3,
        answers_per_month: 26,
        monthly_cost_usd: '0.03',
        run_now_answers: 3,
        run_now_cost_usd: '0.003600',
      },
      {
        engine_code: 'gemini_web',
        prompts_fit: 3,
        answers_per_month: 26,
        monthly_cost_usd: '0.03',
        run_now_answers: 3,
        run_now_cost_usd: '0.003600',
      },
    ]);
    expect(estimate.total_monthly_cost_usd).toBe('0.06');
    expect(estimateCost(['one'], ['chatgpt_web']).engines[0]).toMatchObject({
      answers_per_month: 8,
      monthly_cost_usd: '0.01',
    });
  });

  it('counts per engine only the prompts it takes, and gives no price, never zero, for an engine without one', () => {
    const long = 'y'.repeat(701);
    const estimate = estimateCost([long, 'short'], ['chatgpt_web', 'google_ai_mode']);
    const [chatgpt, aiMode] = estimate.engines;
    expect(chatgpt).toMatchObject({ prompts_fit: 2 });
    expect(aiMode).toEqual({
      engine_code: 'google_ai_mode',
      prompts_fit: 1,
      answers_per_month: 8,
      monthly_cost_usd: null,
      run_now_answers: 1,
      run_now_cost_usd: null,
    });
    // The total adds the engines that have a price
    expect(estimate.total_monthly_cost_usd).toBe(chatgpt?.monthly_cost_usd);
    expect(estimateCost(['one'], ['google_ai_mode']).total_monthly_cost_usd).toBeNull();
  });

  it('asks nothing of no prompt: zero answers and a zero cost on the engines that have a price', () => {
    expect(estimateCost([], ['chatgpt_web']).engines[0]).toMatchObject({
      prompts_fit: 0,
      answers_per_month: 0,
      monthly_cost_usd: '0.00',
      run_now_cost_usd: '0.000000',
    });
  });
});
