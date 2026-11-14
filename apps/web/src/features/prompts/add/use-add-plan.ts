'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef } from 'react';

import { ANNOUNCE_DELAY_MS, QUOTA_KEY } from './add-announce';
import {
  askNowState,
  disabledReason,
  engineSkips,
  isUnderCent,
  ONE_CENT,
  planNumbers,
  quotaState,
  type AskNowState,
  type DisabledReason,
  type QuotaState,
} from './add-model';
import { useNextScheduled } from './add-queries';
import { askReasonText, type PlanBlockProps, type PlanNextRun } from './plan-block';
import type { AddCheck } from './use-add-check';
import { useAiLimits } from '../limits/limits-queries';
import type { PromptScope } from '../prompt-queries';
import { BULK_RUN_MAX } from '../run-model';
import { announce } from '@/lib/a11y/announcer';
import type { EngineCode, ProjectEngine } from '@/lib/api/types';
import { formatCurrency, formatInteger, formatList } from '@/lib/format';
import { useCan } from '@/lib/permissions';

export interface UseAddPlanInput {
  scope: PromptScope;
  /** The dialog is open: the limits and the schedules are read only then. */
  open: boolean;
  check: AddCheck;
  /** The project's enabled engines. */
  engines: readonly ProjectEngine[];
  /** The archived prompts the add brings back, which take places beside the new ones. */
  restore?: number;
}

export interface AddPlan {
  /** For the button's `aria-describedby` and the block itself. */
  id: string;
  /** Everything the plan block shows, but the control that asks now, which the caller puts in `askSlot`. */
  block: Omit<PlanBlockProps, 'askSlot'>;
  /** The plan in one line, for the phone footer; `null` before there is anything to say. */
  summary: string | null;
  /** Why the add is off; `null` when it is on. An empty field is no reason: the form says what it needs on submit. */
  disabled: DisabledReason | null;
  /** The words of `disabled`, for the button's tooltip; the plan block says the same. */
  reason: string | null;
  quota: QuotaState | null;
  /** What asking the new prompts now takes; `null` without the right to run, an engine on, or an estimate. */
  ask: AskNowState | null;
  /** The words of `ask.blocked` (PD-ADD-23), for the checkbox that asks; `null` when asking is possible. */
  askReason: string | null;
}

/**
 * The plan of the add from what the check found, the lint's estimate, the day's manual runs and the schedules. The
 * lint's places and estimate are exact only in the shape that asks for a market; before a country is chosen there
 * are none, and the add follows the client's count while the server keeps the last word. While the lint is out the
 * last numbers stay and nothing the stale quota says blocks the add.
 */
export function useAddPlan({ scope, open, check, engines, restore = 0 }: UseAddPlanInput): AddPlan {
  const t = useTranslations('prompts.add.plan');
  const add = useTranslations('prompts.add');
  const locale = useLocale();
  const id = useId();
  const canRun = useCan('runs:trigger');
  const limits = useAiLimits(scope, { enabled: open && canRun });
  const next = useNextScheduled(scope, { enabled: open });
  const manualRuns = limits.data?.data.manual_runs_today ?? null;

  const exact = check.answer !== null && !check.needsCountry;
  const wouldCreate = check.wouldCreate;
  const plan = useMemo(
    () => (exact ? planNumbers(check.answer?.estimate, wouldCreate) : null),
    [exact, check.answer, wouldCreate],
  );
  const quota = useMemo(
    () =>
      exact && check.answer !== null
        ? quotaState({ limit: check.answer.quota.limit, used: check.answer.quota.used }, wouldCreate, restore)
        : null,
    [exact, check.answer, wouldCreate, restore],
  );
  const ask = engines.length > 0 && canRun ? askNowState(plan, wouldCreate, manualRuns, BULK_RUN_MAX) : null;
  const askReason = askReasonText(ask, t);

  const why = disabledReason(check.counts, check.checking ? null : quota, restore);
  const disabled = why === 'empty' ? null : why;
  const reason = ((): string | null => {
    if (disabled === 'cannotAdd') return add('fixLines');
    if (disabled === 'allTracked') return add('allTracked');
    if (disabled !== 'overQuota' || quota === null) return null;
    return t('over', {
      needs: formatInteger(quota.needs),
      room: formatInteger(quota.room),
      short: quota.short,
    });
  })();

  const engineNames = useMemo(
    () => new Map<EngineCode, string>(engines.map((engine) => [engine.engine.engine_code, engine.engine.label])),
    [engines],
  );
  const skips = useMemo(
    () =>
      engineSkips(plan, wouldCreate).flatMap((skip) => {
        const found = engines.find((engine) => engine.engine.engine_code === skip.engineCode);
        return found === undefined ? [] : [{ ...skip, maxChars: found.engine.max_prompt_chars }];
      }),
    [plan, wouldCreate, engines],
  );

  const nextRun = ((): PlanNextRun | null => {
    if (engines.length === 0 || next.status !== 'ready') return null;
    return next.nextRunAt === null || next.timeZone === null
      ? { kind: 'paused' }
      : { kind: 'at', at: next.nextRunAt, timeZone: next.timeZone };
  })();

  const hasLines = check.counts.lines > 0;
  const summary = ((): string | null => {
    const count = exact ? wouldCreate : check.counts.new;
    if (!hasLines || count === 0) return null;
    const dollars = (usd: number): string => formatCurrency(usd, { locale });
    const parts = [
      t('summaryPrompts', { count }),
      plan === null || plan.monthlyCost === null
        ? null
        : isUnderCent(plan.monthlyCost, plan.answersPerMonth)
          ? t('summaryCostUnder', { amount: dollars(ONE_CENT) })
          : t('summaryCostAbout', { amount: dollars(plan.monthlyCost) }),
      quota === null
        ? null
        : quota.over
          ? t('summaryOver', { limit: formatInteger(quota.limit) })
          : t('summaryQuota', { after: formatInteger(quota.after), limit: formatInteger(quota.limit) }),
    ].filter((part): part is string => part !== null);
    return formatList(parts, locale);
  })();

  // The line is spoken once, after the typing and the lint have settled, and not again for the same words
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    if (!open || check.checking || summary === null || spoken.current === summary) return;
    spoken.current = summary;
    announce(summary, { key: QUOTA_KEY, debounceMs: ANNOUNCE_DELAY_MS });
  }, [open, check.checking, summary]);

  return {
    id,
    block: {
      id,
      hasLines,
      checking: check.checking,
      failed: check.failed,
      needsCountry: check.needsCountry,
      prompts: wouldCreate,
      restore,
      plan,
      engineNames,
      skips,
      quota,
      ask,
      nextRun,
      blocked: disabled,
    },
    summary,
    disabled,
    reason,
    quota,
    ask,
    askReason,
  };
}
