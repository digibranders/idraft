import { describe, expect, it } from 'vitest';

import { lostToRows, opportunityRows } from './lost-to';
import {
  cell,
  competitor,
  engine,
  entityCells,
  id,
  own,
  promptRow,
  share,
  summaryOf,
  type OutcomeCounts,
} from './summary-fixtures';
import { trackedSetOf } from './tracked-set';
import type { LostToResult, OpportunityResult } from './types';

const CHATGPT = 'chatgpt_web';
const GEMINI = 'gemini_web';
const [FYNIX, HUBSPOT, ZOHO, ASANA] = [id(1), id(2), id(3), id(4)];

interface PromptCounts {
  /** Valid answers of the engine for the prompt. */
  valid: number;
  /** Answers that name the own brand. */
  own?: number;
  hubspot?: number;
  zoho?: number;
  asana?: number;
  /** Answers that name a tracked brand: the engine's share of voice denominator; defaults to the valid ones. */
  naming?: number;
  outcomes?: OutcomeCounts;
}

function engineOf(code: string, counts: PromptCounts) {
  const naming = counts.naming ?? counts.valid;
  const named = (k: number | undefined) => cell(k ?? 0, counts.valid);
  return engine(code, {
    mentioned: named(counts.own),
    share: share(naming, naming),
    ...(counts.outcomes === undefined ? {} : { outcomes: counts.outcomes }),
    entities: [
      entityCells(FYNIX, named(counts.own), share(0, naming)),
      entityCells(HUBSPOT, named(counts.hubspot), share(0, naming)),
      entityCells(ZOHO, named(counts.zoho), share(0, naming)),
      entityCells(ASANA, named(counts.asana), share(0, naming)),
    ],
  });
}

const ENTITIES = [own(), competitor(2, 'HubSpot'), competitor(3, 'Zoho'), competitor(4, 'Asana')];

function lostTo(prompts: ReturnType<typeof promptRow>[], code = CHATGPT): LostToResult {
  const summary = summaryOf({ entities: ENTITIES, prompts });
  const result = lostToRows(summary, code, trackedSetOf(summary, null));
  if (result.status !== 'read') throw new Error('expected a read');
  return result;
}

function opportunities(
  prompts: ReturnType<typeof promptRow>[],
  codes: readonly string[] = [CHATGPT],
): OpportunityResult {
  const summary = summaryOf({ entities: ENTITIES, prompts });
  const result = opportunityRows(summary, codes, trackedSetOf(summary, null));
  if (result.status !== 'read') throw new Error('expected a read');
  return result;
}

const countOf = (result: OpportunityResult, kind: string, entityId: string | null = null): number | undefined =>
  result.rows.find((row) => row.kind === kind && row.entityId === entityId)?.prompts;

describe('lostToRows', () => {
  it("a competitor is lost when named, the engine's own mentioned is 0 and the prompt has 4 or more valid answers", () => {
    const result = lostTo([
      promptRow(1, [engineOf(CHATGPT, { valid: 5, hubspot: 2 })]),
      promptRow(2, [engineOf(CHATGPT, { valid: 4, hubspot: 1, zoho: 1 })]),
    ]);
    expect(result.promptsWithEnoughAnswers).toBe(2);
    expect(result.rows).toEqual([
      { entityId: HUBSPOT, name: 'HubSpot', prompts: 2 },
      { entityId: ZOHO, name: 'Zoho', prompts: 1 },
    ]);
  });

  it('a prompt with fewer than 4 valid answers is counted as too few, never lost', () => {
    const result = lostTo([
      promptRow(1, [engineOf(CHATGPT, { valid: 3, hubspot: 3 })]),
      promptRow(2, [engineOf(CHATGPT, { valid: 5, hubspot: 1 })]),
      // no valid answer at all: not in scope, neither enough nor too few
      promptRow(3, [engineOf(CHATGPT, { valid: 0 })]),
    ]);
    expect(result.promptsWithTooFewAnswers).toBe(1);
    expect(result.promptsWithEnoughAnswers).toBe(1);
    expect(result.rows).toEqual([{ entityId: HUBSPOT, name: 'HubSpot', prompts: 1 }]);
  });

  it('a prompt where the own brand is named is never lost', () => {
    const result = lostTo([promptRow(1, [engineOf(CHATGPT, { valid: 6, own: 1, hubspot: 5 })])]);
    expect(result.rows).toEqual([]);
    expect(result.promptsWithEnoughAnswers).toBe(1);
  });

  it('rows sort by prompts lost, then name; zero rows stay out', () => {
    const result = lostTo([
      promptRow(1, [engineOf(CHATGPT, { valid: 5, zoho: 1, hubspot: 1, asana: 1 })]),
      promptRow(2, [engineOf(CHATGPT, { valid: 5, zoho: 2, hubspot: 1, asana: 1 })]),
      promptRow(3, [engineOf(CHATGPT, { valid: 5, asana: 3 })]),
      promptRow(4, [engineOf(CHATGPT, { valid: 5 })]),
    ]);
    expect(result.rows.map((row) => [row.name, row.prompts])).toEqual([
      ['Asana', 3],
      ['HubSpot', 2],
      ['Zoho', 2],
    ]);
  });

  it('is unread for an engine no prompt row lists, never zero', () => {
    const summary = summaryOf({
      entities: ENTITIES,
      prompts: [promptRow(1, [engineOf(CHATGPT, { valid: 5, hubspot: 1 })])],
    });
    expect(lostToRows(summary, GEMINI, trackedSetOf(summary, null))).toEqual({ status: 'unread' });
    const none = summaryOf({ entities: ENTITIES });
    expect(lostToRows(none, CHATGPT, trackedSetOf(none, null))).toEqual({ status: 'unread' });
  });
});

describe('opportunityRows', () => {
  it('an opportunity row counts a prompt once however many engines or competitors qualify', () => {
    const both = { valid: 5, hubspot: 2, zoho: 2, outcomes: { mentionedOnly: cell(0, 5) } };
    const result = opportunities(
      [
        promptRow(1, [engineOf(CHATGPT, both), engineOf(GEMINI, both)]),
        promptRow(2, [engineOf(CHATGPT, { valid: 5, own: 3 })]),
      ],
      [CHATGPT, GEMINI],
    );
    expect(result.promptsInScope).toBe(2);
    expect(countOf(result, 'lost_to', HUBSPOT)).toBe(1);
    expect(countOf(result, 'lost_to', ZOHO)).toBe(1);
    // Asana is named nowhere: no row for it
    expect(countOf(result, 'lost_to', ASANA)).toBeUndefined();
  });

  it('nobody named is valid answers above the answers naming a tracked brand', () => {
    const result = opportunities([
      promptRow(1, [engineOf(CHATGPT, { valid: 6, naming: 4 })]),
      promptRow(2, [engineOf(CHATGPT, { valid: 5, naming: 5 })]),
      promptRow(3, [engineOf(CHATGPT, { valid: 5, naming: 0 })]),
    ]);
    expect(result.promptsInScope).toBe(3);
    expect(countOf(result, 'nobody_named')).toBe(2);
  });

  it('named not cited and cited not named read the outcome cells', () => {
    const result = opportunities([
      promptRow(1, [engineOf(CHATGPT, { valid: 5, outcomes: { mentionedOnly: cell(2, 5), citedOnly: cell(0, 5) } })]),
      promptRow(2, [engineOf(CHATGPT, { valid: 5, outcomes: { mentionedOnly: cell(0, 5), citedOnly: cell(3, 5) } })]),
      promptRow(3, [engineOf(CHATGPT, { valid: 5, outcomes: { citedOnly: cell(1, 5) } })]),
    ]);
    expect(countOf(result, 'named_not_cited')).toBe(1);
    expect(countOf(result, 'cited_not_named')).toBe(2);
  });

  it('an engine outside the scope adds nothing', () => {
    const result = opportunities(
      [
        promptRow(1, [
          engineOf(CHATGPT, { valid: 5 }),
          engineOf(GEMINI, {
            valid: 5,
            hubspot: 3,
            naming: 2,
            outcomes: { mentionedOnly: cell(2, 5), citedOnly: cell(1, 5) },
          }),
        ]),
      ],
      [CHATGPT],
    );
    expect(result.promptsInScope).toBe(1);
    // the three fixed conditions stay as real zeros of a known total; a competitor with no lost prompt has no row
    expect(result.rows.map((row) => [row.kind, row.prompts])).toEqual([
      ['named_not_cited', 0],
      ['cited_not_named', 0],
      ['nobody_named', 0],
    ]);
  });

  it('rows sort by count, then the order of the conditions, then name', () => {
    const result = opportunities([
      promptRow(1, [engineOf(CHATGPT, { valid: 5, zoho: 1, outcomes: { citedOnly: cell(1, 5) } })]),
      promptRow(2, [engineOf(CHATGPT, { valid: 5, zoho: 1, hubspot: 1, naming: 2 })]),
    ]);
    expect(result.rows.map((row) => [row.kind, row.name, row.prompts])).toEqual([
      ['lost_to', 'Zoho', 2],
      ['cited_not_named', null, 1],
      ['lost_to', 'HubSpot', 1],
      ['nobody_named', null, 1],
      ['named_not_cited', null, 0],
    ]);
  });

  it('is unread when no prompt row lists an engine in scope', () => {
    const summary = summaryOf({ entities: ENTITIES, prompts: [promptRow(1, [engineOf(GEMINI, { valid: 5 })])] });
    expect(opportunityRows(summary, [CHATGPT], trackedSetOf(summary, null))).toEqual({ status: 'unread' });
  });
});
