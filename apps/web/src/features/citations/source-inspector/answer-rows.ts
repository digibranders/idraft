import { byEngineOrder } from '@/components/app/engine/order';
import type { CitationRow, EngineCode } from '@/lib/citations/types';

/**
 * The rows of the source inspector's Prompts and Answers tabs (WB-SRC-02, WB-SRC-03), worked out from the citation
 * rows of one page. The API gives a row for each listing, so a page an answer lists twice is two rows: every count
 * here is of distinct observation ids. Pure.
 */

/** Each tab lists the ten that matter most. */
const LIMIT = 10;

/** One prompt whose answers cite the page. */
export interface PromptRow {
  promptId: string;
  /** The engines it was cited on, once each and in the fixed engine order. */
  engines: EngineCode[];
  /** Distinct answers of the prompt that cite the page, among the rows read. */
  answers: number;
  /** When the newest of those answers was made. */
  lastAnswerAt: string;
}

/** A sort comparator that puts the newer instant first: positive when `b` is the newer. */
const later = (a: string, b: string): number => Date.parse(b) - Date.parse(a);

/** At most `limit` prompts, the most answers first; a tie goes to the newest answer, then to the lower id. */
export function promptRows(rows: readonly CitationRow[], limit: number = LIMIT): PromptRow[] {
  const found = new Map<string, { engines: Set<EngineCode>; observations: Set<string>; lastAnswerAt: string }>();
  for (const row of rows) {
    const prompt = found.get(row.prompt_id) ?? {
      engines: new Set<EngineCode>(),
      observations: new Set<string>(),
      lastAnswerAt: row.observed_at,
    };
    prompt.engines.add(row.engine_code);
    prompt.observations.add(row.observation_id);
    if (later(prompt.lastAnswerAt, row.observed_at) > 0) prompt.lastAnswerAt = row.observed_at;
    found.set(row.prompt_id, prompt);
  }
  return [...found]
    .map(([promptId, prompt]) => ({
      promptId,
      engines: byEngineOrder([...prompt.engines], (code) => code),
      answers: prompt.observations.size,
      lastAnswerAt: prompt.lastAnswerAt,
    }))
    .sort(
      (a, b) => b.answers - a.answers || later(a.lastAnswerAt, b.lastAnswerAt) || a.promptId.localeCompare(b.promptId),
    )
    .slice(0, limit);
}

/** One answer that cites the page. */
export interface AnswerRow {
  observationId: string;
  observedAt: string;
  engine: EngineCode;
  promptId: string;
  /** Where the answer's source list first names the page, from 1. The list's length is not known from these rows. */
  position: number;
  /** The host and address of that listing, for the quoted passage's source line. */
  host: string;
  url: string;
  /** What the engine quoted from the page at that listing; `null` when it gave none. Provider text. */
  quote: string | null;
}

/** At most `limit` answers, the newest first, each once at the first place it lists the page. */
export function answerRows(rows: readonly CitationRow[], limit: number): AnswerRow[] {
  const found = new Map<string, AnswerRow>();
  for (const row of rows) {
    const answer = found.get(row.observation_id);
    // The row is the first listing, so its quote is that listing's: the later listings of the same answer give theirs up
    if (answer === undefined || row.citation_index < answer.position) {
      found.set(row.observation_id, {
        observationId: row.observation_id,
        observedAt: row.observed_at,
        engine: row.engine_code,
        promptId: row.prompt_id,
        position: row.citation_index,
        host: row.host,
        url: row.url,
        quote: row.quote ?? null,
      });
    }
  }
  return [...found.values()]
    .sort(
      (a, b) =>
        later(a.observedAt, b.observedAt) || b.observationId.localeCompare(a.observationId, 'en', { numeric: true }),
    )
    .slice(0, limit);
}
