import { engineValue } from './engine-values';
import type { TopicHead } from './topic-rows';
import type { ProjectEngine } from '@/lib/api/types';

/** The best engine of a topic on a phone, with the answers behind its rate. */
export interface BestEngine {
  code: string;
  value: number;
  /** The answers that count; `null` where the count is not whole. */
  successes: number | null;
  answers: number;
}

/**
 * What a topic's second line says (WB-TPE-17): who it is, the engine where its mention rate is best, and how many
 * engines show a rate. The engines are never pooled here: the first line is the average and says "avg of N" in words.
 * An engine with a best rate of 0 is no best engine (nobody names the brand), as `topEngine` has it. A tie goes to the
 * engine shown first.
 */
export function topicListLines(
  head: TopicHead,
  engines: readonly ProjectEngine[],
): { identity: string; best: BestEngine | null; engines: number } {
  const rated = engines.flatMap(({ engine }) => {
    const value = engineValue(head.engines, engine.engine_code, 'mentioned');
    return value.state === 'ok' && value.value !== null ? [{ ...value, rate: value.value }] : [];
  });
  let best: BestEngine | null = null;
  for (const entry of rated) {
    if (entry.rate > 0 && (best === null || entry.rate > best.value)) {
      best = { code: entry.code, value: entry.rate, successes: entry.successes, answers: entry.answers };
    }
  }
  return { identity: head.path, best, engines: rated.length };
}
