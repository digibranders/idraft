import { bestEngine, engineValue } from './engine-values';
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
 * What a topic's second line says (WB-TPE-17): who it is, the engine where its mention rate is best (`bestEngine`, which the
 * export's Best engine column reads too) and how many engines show a rate. The first line is the average of those engines
 * and says how many took part; engines are never pooled otherwise.
 */
export function topicListLines(
  head: TopicHead,
  engines: readonly ProjectEngine[],
): { identity: string; best: BestEngine | null; engines: number } {
  const values = engines.map(({ engine }) => engineValue(head.engines, engine.engine_code, 'mentioned'));
  const best = bestEngine(values);
  return {
    identity: head.path,
    best:
      best === null || best.value === null
        ? null
        : { code: best.code, value: best.value, successes: best.successes, answers: best.answers },
    engines: values.filter((value) => value.state === 'ok').length,
  };
}
