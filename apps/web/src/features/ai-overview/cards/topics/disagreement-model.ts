import type { TopicNode } from './model-types';
import { leavesOf } from './topic-nodes';
import type { PromptSummaryRow } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The model of "named by one engine, not another" (CH-44): for each leaf topic and each ordered pair of asked
 * engines (A, B), the prompts where A named the brand and B, with enough answers to tell, never did. Plain data.
 */

/** A prompt's count of answers was not a whole number, so it is not a count of answers: nothing is guessed from it. */
export class NotWholeCountError extends Error {
  constructor(promptId: string, engineCode: string, value: number) {
    super(`Prompt ${promptId} has a count of ${String(value)} on ${engineCode}, which is not a whole number`);
    this.name = 'NotWholeCountError';
  }
}

export interface DisagreementRow {
  node: TopicNode;
  /** The engine that named the brand in at least one valid answer. */
  yes: string;
  /** The engine that had at least `MIN_OBSERVATIONS` valid answers and none named the brand. */
  no: string;
  /** Prompts of the topic with this pair. */
  count: number;
  /** Prompts of the topic. */
  total: number;
  /** The texts of the first prompts that count, in the order the read gives them. */
  examples: string[];
}

export interface DisagreementModel {
  /** Rows with a count above 0, the cut to `count` applied. */
  rows: DisagreementRow[];
  /** Rows there are before the cut. */
  found: number;
  /** Prompts where an engine named the brand and another had too few answers to say it misses: left out of every row. */
  undecided: number;
  /** Leaf topics. */
  topics: number;
  /** Whether any prompt of a leaf topic has a valid answer on an asked engine. */
  answered: boolean;
  /** Asked engines with no valid answer on any prompt of a leaf topic. */
  silent: string[];
}

/** Examples shown per row in the Table form. */
const EXAMPLE_PROMPTS = 3;

/** How an engine answered one prompt. A cell the prompt has no row for is no answer. */
interface Reading {
  /** Named the brand in at least one valid answer. */
  named: boolean;
  /** At least `MIN_OBSERVATIONS` valid answers and none named it. */
  missed: boolean;
  /** No valid answer named it, but too few answers to say it misses. */
  unsure: boolean;
  answers: number;
}

function wholeCount(value: number, promptId: string, code: string): number {
  if (!Number.isInteger(value) || value < 0) throw new NotWholeCountError(promptId, code, value);
  return value;
}

function readingOf(prompt: PromptSummaryRow, code: string): Reading {
  const cell = prompt.engines.find((cells) => cells.engine_code === code)?.mentioned;
  const named = wholeCount(cell?.numerator ?? 0, prompt.prompt_id, code);
  const answers = wholeCount(cell?.denominator ?? 0, prompt.prompt_id, code);
  const none = named === 0;
  return {
    named: !none,
    missed: none && answers >= MIN_OBSERVATIONS,
    unsure: none && answers < MIN_OBSERVATIONS,
    answers,
  };
}

/**
 * The (topic, pair) rows with prompts that one engine names and the other misses, most prompts first (a tie goes to
 * the topic name, then to the order the engines are asked in), cut to `count`. Only leaf topics are listed; a prompt
 * in two topics counts in both. `codes` is the asked engines in catalog order.
 */
export function disagreementRows(
  nodes: readonly TopicNode[],
  codes: readonly string[],
  count: number,
): DisagreementModel {
  const leaves = leavesOf(nodes);
  const pairs = codes.flatMap((yes, first) =>
    codes.flatMap((no, second) => (yes === no ? [] : [{ yes, no, place: first * codes.length + second }])),
  );
  const undecided = new Set<string>();
  const answeredOn = new Set<string>();
  const found: { row: DisagreementRow; place: number }[] = [];
  for (const node of leaves) {
    const members = node.members ?? [];
    const readings = members.map((prompt) => ({
      prompt,
      by: new Map(codes.map((code) => [code, readingOf(prompt, code)] as const)),
    }));
    for (const { by } of readings) for (const [code, reading] of by) if (reading.answers > 0) answeredOn.add(code);
    for (const { yes, no, place } of pairs) {
      const matching = readings.filter(({ by }) => by.get(yes)?.named === true && by.get(no)?.missed === true);
      for (const { prompt, by } of readings) {
        if (by.get(yes)?.named === true && by.get(no)?.unsure === true) undecided.add(prompt.prompt_id);
      }
      if (matching.length === 0) continue;
      found.push({
        row: {
          node,
          yes,
          no,
          count: matching.length,
          total: members.length,
          examples: matching.slice(0, EXAMPLE_PROMPTS).map(({ prompt }) => prompt.text),
        },
        place,
      });
    }
  }
  found.sort(
    (a, b) => b.row.count - a.row.count || a.row.node.name.localeCompare(b.row.node.name) || a.place - b.place,
  );
  return {
    rows: found.slice(0, count).map(({ row }) => row),
    found: found.length,
    undecided: undecided.size,
    topics: leaves.length,
    answered: answeredOn.size > 0,
    silent: codes.filter((code) => !answeredOn.has(code)),
  };
}

/** The columns of the card's export block: data names, not words for a person. */
export const DISAGREEMENT_EXPORT_HEADER = ['topic', 'named_on', 'missed_on', 'prompts', 'topic_prompts'] as const;

export const DISAGREEMENT_FILE_NAME = 'engine-disagreement';

/** Between the names of a topic's path ("SEO / Technical SEO"). */
export const PATH_SEPARATOR = ' / ';
