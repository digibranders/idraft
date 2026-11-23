import type { EngineCode, Schemas } from '@/lib/api/types';

/*
 * What the tests of the two collection-day cards (CH-20, CH-21) share: a day of one engine and the response that
 * holds days, written with the fields a test cares about. Typed against the generated schema, so a change of the
 * route breaks here. Not a test file.
 */

export type CollectionDay = Schemas['CollectionDay'];
export type CollectionDaily = Schemas['CollectionDailyResponse'];

export interface DaySpec {
  date: string;
  engine?: EngineCode;
  /** `null` is a day with no schedule the route can name; the default is 750 answers planned. */
  scheduled?: number | null;
  complete?: number;
  partial?: number;
  empty?: number;
  refused?: number;
  error?: number;
  blocked?: number;
}

/** One day and engine as the route sends it: `answers` and `valid` follow from the statuses, as they do there. */
export function day({
  date,
  engine = 'chatgpt_web',
  scheduled = 750,
  complete = 0,
  partial = 0,
  empty = 0,
  refused = 0,
  error = 0,
  blocked = 0,
}: DaySpec): CollectionDay {
  const answers = complete + partial + empty + refused + error;
  return {
    date,
    engine_code: engine,
    scheduled,
    answers,
    by_status: { complete, partial, empty, refused, error },
    valid: complete + partial,
    budget_blocked: blocked,
    runs: answers > 0 ? ['00000001-0000-4000-8000-000000000001'] : [],
  };
}

/** A day with nothing scheduled and nothing collected, as the route zero fills it. */
export const quiet = (date: string, engine: EngineCode = 'chatgpt_web'): CollectionDay =>
  day({ date, engine, scheduled: null });

export interface ResponseSpec {
  from: string;
  to: string;
  engines?: readonly EngineCode[];
  timezone?: string;
}

export function dailyResponse(days: readonly CollectionDay[], spec: ResponseSpec): CollectionDaily {
  const { from, to, engines = ['chatgpt_web', 'gemini_web'], timezone = 'Europe/Berlin' } = spec;
  return { data: [...days], meta: { window: { from, to, timezone }, engine_codes: [...engines] } };
}

/**
 * Two weeks of two engines, Monday Nov 2 to Sunday Nov 15, 2026. ChatGPT is asked on Mondays and Fridays: Nov 6 has 742
 * valid answers of 750 (700 complete and 42 partial) with 6 refused and 2 errors, Nov 9 is collected in full with a
 * budget-blocked run beside it, Nov 13 has 750 planned and nothing collected, and the other days have no schedule the
 * route can name (`scheduled: null`). Gemini has Nov 6 only, with figures of its own, so a test can tell the engines
 * apart.
 */
export function twoWeeks(): CollectionDaily {
  const chatgpt: CollectionDay[] = [
    day({ date: '2026-11-02', complete: 690, partial: 40, empty: 5, refused: 10, error: 5 }),
    quiet('2026-11-03'),
    quiet('2026-11-04'),
    quiet('2026-11-05'),
    day({ date: '2026-11-06', complete: 700, partial: 42, refused: 6, error: 2 }),
    quiet('2026-11-07'),
    quiet('2026-11-08'),
    day({ date: '2026-11-09', complete: 750, blocked: 1 }),
    quiet('2026-11-10'),
    quiet('2026-11-11'),
    quiet('2026-11-12'),
    day({ date: '2026-11-13' }),
    quiet('2026-11-14'),
    quiet('2026-11-15'),
  ];
  const gemini: CollectionDay[] = chatgpt.map((row) =>
    row.date === '2026-11-06'
      ? day({
          date: row.date,
          engine: 'gemini_web',
          scheduled: 500,
          complete: 410,
          partial: 30,
          refused: 40,
          error: 20,
        })
      : quiet(row.date, 'gemini_web'),
  );
  return dailyResponse([...chatgpt, ...gemini], { from: '2026-11-02', to: '2026-11-15' });
}
