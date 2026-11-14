import type { useTranslations } from 'next-intl';

import { MANUAL_RUN_CAP, type EngineRefusal, type RunProblem, type SkipCounts } from '../run-model';
import type { ProjectEngine } from '@/lib/api/types';
import { formatList } from '@/lib/format';

/**
 * A refused bulk run in words, as Run now of the bulk bar says it (`use-prompt-actions.tsx`, which keeps its own
 * copy: that file belongs to another package). The sentences are the catalog's `prompts.inspector.*` and
 * `prompts.bulk.*`, so asking right after an add reads as asking from the table does.
 */

type PromptsTranslate = ReturnType<typeof useTranslations<'prompts'>>;

export interface AskTextContext {
  t: PromptsTranslate;
  /** The enabled engines the run was asked on, to name them. */
  engines: readonly ProjectEngine[];
  locale: string;
}

/** The catalog key of each reason an engine is refused, the inspector's sentences. */
const REFUSAL_KEYS = {
  engine_not_enabled: 'engineNotEnabled',
  prompt_too_long: 'promptTooLong',
  location_not_enabled: 'locationNotEnabled',
  price_unavailable: 'priceUnavailable',
} as const satisfies Record<EngineRefusal, string>;

const engineName = (engines: readonly ProjectEngine[], code: string): string =>
  engines.find((engine) => engine.engine.engine_code === code)?.engine.label ?? code;

/** The pairs left out, in words: "3 prompt and engine pairs were left out: 2 too long and 1 with no location". */
export function skipText(skips: SkipCounts, { t, locale }: AskTextContext): string {
  const total = skips.tooLong + skips.noLocation + skips.pending;
  if (total === 0) return '';
  const reasons = [
    ...(skips.tooLong === 0 ? [] : [t('bulk.runSkipTooLong', { count: skips.tooLong })]),
    ...(skips.noLocation === 0 ? [] : [t('bulk.runSkipNoLocation', { count: skips.noLocation })]),
    ...(skips.pending === 0 ? [] : [t('bulk.runSkipPending', { count: skips.pending })]),
  ];
  return t('bulk.runSkipped', { count: total, reasons: formatList(reasons, locale) });
}

/** What a refusal says. `later`: runs before it were queued, so it refuses the next run and not the whole ask. */
export function askProblemText(problem: RunProblem, context: AskTextContext, later = false): string {
  const { t, engines, locale } = context;
  switch (problem.kind) {
    case 'provider_paused':
      return t('inspector.runPaused', { minutes: problem.minutes });
    case 'rate_limited':
      return t('inspector.runRateLimited', { minutes: problem.minutes });
    case 'manual_run_limit':
      return t('inspector.runLimit', { limit: problem.limit ?? MANUAL_RUN_CAP });
    case 'quota_exceeded':
      return problem.limit !== null && problem.used !== null && problem.requested !== null
        ? t('inspector.runQuota', { limit: problem.limit, used: problem.used, requested: problem.requested })
        : t('bulk.runStopQuota');
    case 'prompt_unknown':
      return t(later ? 'bulk.runUnknownNext' : 'bulk.runUnknown');
    case 'engines_refused':
      return (Object.keys(problem.refused) as EngineRefusal[])
        .map((reason) => {
          const named = problem.refused[reason] ?? [];
          // A reason without an engine named is every engine asked
          const names = (named.length === 0 ? engines.map((engine) => engine.engine.engine_code) : named).map((code) =>
            engineName(engines, code),
          );
          return t(`inspector.runRefused.${REFUSAL_KEYS[reason]}`, {
            engines: formatList(names, locale),
            count: names.length,
          });
        })
        .join(' ');
    case 'nothing_to_run':
      return [t(later ? 'bulk.runNothingToRunNext' : 'bulk.runNothingToRun'), skipText(problem.skips, context)]
        .filter((part) => part !== '')
        .join(' ');
    case 'check_pending':
      return problem.engines.length > 0
        ? t('inspector.runPending', {
            engines: formatList(
              problem.engines.map((code) => engineName(engines, code)),
              locale,
            ),
          })
        : t(later ? 'bulk.runNothingPendingNext' : 'bulk.runNothingPending');
    case 'forbidden':
      return t('inspector.runForbidden');
    case 'gone':
      return t('inspector.runGone');
    case 'failed':
      return t('inspector.runFailed');
  }
}

/** The title of a refusal: that nothing was started when the prompts were asked together and none could be. */
export const askProblemTitle = (problem: RunProblem, t: PromptsTranslate): string =>
  problem.kind === 'nothing_to_run' || (problem.kind === 'check_pending' && problem.engines.length === 0)
    ? t('bulk.runNothingStarted')
    : t('inspector.runFailedTitle');
