'use client';

import { Info } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import {
  askBlockOf,
  isUnderCent,
  ONE_CENT,
  type AskNowState,
  type DisabledReason,
  type PlanNumbers,
  type QuotaState,
} from './add-model';
import { Icon } from '@/components/ui/icon';
import type { EngineCode } from '@/lib/api/types';
import { formatCurrency, formatDetailDateTime, formatInteger, formatList } from '@/lib/format';
import { cn } from '@/lib/utils';

type PlanTranslate = ReturnType<typeof useTranslations<'prompts.add.plan'>>;

/**
 * Why asking the new prompts now is off, in words (PD-ADD-23): the day's manual runs are used, or fewer are left
 * than the ask needs. `null` when asking is possible. The control that asks reads it as its disabled reason.
 */
export function askReasonText(ask: AskNowState | null, t: PlanTranslate): string | null {
  const block = ask === null ? null : askBlockOf(ask);
  if (block === null) return null;
  return block.kind === 'used'
    ? t('askUsed', { limit: formatInteger(block.limit) })
    : t('askShort', { runs: formatInteger(block.runs), left: block.left, leftText: formatInteger(block.left) });
}

/** What asking now costs in words: "about $0.03", "under $0.01", or that the price book has none. */
export function askCostText(ask: AskNowState, t: PlanTranslate, locale: string): string {
  if (ask.cost === null) return t('askNoPrice');
  const dollars = (usd: number): string => formatCurrency(usd, { locale });
  return isUnderCent(ask.cost, ask.answers)
    ? t('askCostUnder', { amount: dollars(ONE_CENT) })
    : t('askCostAbout', { amount: dollars(ask.cost) });
}

/** An engine that skips some of the prompts to create, with the length it takes. */
export interface PlanSkip {
  engineCode: EngineCode;
  count: number;
  maxChars: number;
}

/** The next scheduled answers: `paused` when no AI schedule is active, never a date nothing would honour. */
export type PlanNextRun = { kind: 'at'; at: string; timeZone: string } | { kind: 'paused' };

/**
 * Plain data, no request and no form: the Add prompts dialog fills it from the lint, the limits and the schedules,
 * and the CSV import (WP-28) from its rows.
 */
export interface PlanBlockProps {
  /** For `aria-describedby` of the button the plan is the reason of. */
  id: string;
  /** Anything is typed. */
  hasLines: boolean;
  /** The typing has not settled or the lint is out: the numbers shown are the last ones and may change. */
  checking: boolean;
  /** The lint failed: there are no numbers, and the add still goes to the server. */
  failed: boolean;
  /** No country is chosen: what is tracked, the places and the cost are not known. */
  needsCountry: boolean;
  /** The prompts the add creates, as the lint counts them. */
  prompts: number;
  /** The archived prompts the add brings back: they take places and are not in the estimate. */
  restore: number;
  /** The estimate of what the prompts cost; `null` when the lint has none for them. */
  plan: PlanNumbers | null;
  /** The label of each engine in the estimate. */
  engineNames: ReadonlyMap<EngineCode, string>;
  skips: readonly PlanSkip[];
  /** The workspace's places before and after; `null` when the lint has not said. */
  quota: QuotaState | null;
  /** What asking the new prompts now takes; `null` hides the line (no right to run, no engine on, no estimate). */
  ask: AskNowState | null;
  /** When the schedules run next; `null` hides the line while it is unknown. */
  nextRun: PlanNextRun | null;
  /** Why the add is off, when it is: the block says it as well as the button's tooltip. */
  blocked: DisabledReason | null;
  /** Under the ask line: the control that asks (the dialog's checkbox). */
  askSlot?: ReactNode;
}

function Line({ children, tone }: { children: ReactNode; tone?: 'negative' }): ReactElement {
  return <p className={cn(tone === 'negative' && 'text-negative-text')}>{children}</p>;
}

function InfoLine({ children }: { children: ReactNode }): ReactElement {
  return (
    <p className="flex items-start gap-1.5">
      <Icon icon={Info} size="sm" className="mt-0.5" />
      {children}
    </p>
  );
}

/**
 * The plan of an add, the decision line of the dialog (prompt-dialogs 4.4): the answers a month, what they cost,
 * the places in the workspace, what asking now takes and when the schedules run. Every number is an estimate and is
 * written with "about", and an unknown one is never a zero. While the lint is out the last numbers stay at full
 * strength and the block says it is checking.
 */
export function PlanBlock({
  id,
  hasLines,
  checking,
  failed,
  needsCountry,
  prompts,
  restore,
  plan,
  engineNames,
  skips,
  quota,
  ask,
  nextRun,
  blocked,
  askSlot,
}: PlanBlockProps): ReactElement {
  const t = useTranslations('prompts.add.plan');
  const add = useTranslations('prompts.add');
  const locale = useLocale();
  const name = (code: EngineCode): string => engineNames.get(code) ?? code;
  const dollars = (usd: number): string => formatCurrency(usd, { locale });
  const underCent = (): string => t('underAmount', { amount: dollars(ONE_CENT) });
  const creating = prompts > 0;

  const answers = ((): string | null => {
    if (plan === null || !creating) return null;
    const total = formatInteger(plan.answersPerMonth);
    if (plan.engines.every((engine) => engine.promptsFit === prompts)) {
      return t('answersAll', { answers: total, prompts, engines: plan.engines.length });
    }
    const parts = plan.engines.map((engine) =>
      t('answersPart', { engine: name(engine.engineCode), answers: formatInteger(engine.answersPerMonth) }),
    );
    return t('answersEach', { answers: total, parts: formatList(parts, locale) });
  })();

  const cost = ((): string | null => {
    if (plan === null || !creating || plan.monthlyCost === null) return null;
    const priced = plan.engines.flatMap((engine) =>
      engine.monthlyCost === null
        ? []
        : [
            t('engineAmount', {
              engine: name(engine.engineCode),
              amount: isUnderCent(engine.monthlyCost, engine.answersPerMonth)
                ? underCent()
                : dollars(engine.monthlyCost),
            }),
          ],
    );
    const lead = isUnderCent(plan.monthlyCost, plan.answersPerMonth)
      ? t('costUnder', { amount: dollars(ONE_CENT) })
      : t('costAbout', { amount: dollars(plan.monthlyCost) });
    return priced.length === 0 ? null : t('cost', { lead, engines: formatList(priced, locale) });
  })();

  const askReason = askReasonText(ask, t);
  const askCost = ask === null ? t('askNoPrice') : askCostText(ask, t, locale);

  return (
    <div
      id={id}
      role="group"
      aria-label={t('label')}
      aria-busy={checking}
      data-slot="plan-block"
      className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-subtle px-3 py-2 type-meta text-foreground-secondary"
    >
      {!hasLines ? <Line>{t('empty')}</Line> : null}
      {hasLines && checking ? <Line>{t('checking')}</Line> : null}
      {hasLines && needsCountry ? <InfoLine>{t('needsCountry')}</InfoLine> : null}
      {hasLines && failed ? <InfoLine>{t('failed')}</InfoLine> : null}
      {answers === null ? null : <Line>{answers}</Line>}
      {cost === null ? null : <Line>{cost}</Line>}
      {plan === null || !creating
        ? null
        : plan.unpricedEngines.map((code) => <Line key={code}>{t('noPrice', { engine: name(code) })}</Line>)}
      {skips.map((skip) => (
        <Line key={skip.engineCode}>
          {t('skips', {
            engine: name(skip.engineCode),
            count: formatInteger(skip.count),
            max: formatInteger(skip.maxChars),
          })}
        </Line>
      ))}
      {quota === null ? null : (
        <>
          <Line>
            {t('quota', {
              used: formatInteger(quota.used),
              limit: formatInteger(quota.limit),
              after: formatInteger(quota.after),
            })}
          </Line>
          {restore === 0 ? null : <Line>{t('restore', { count: restore })}</Line>}
          {quota.over ? (
            <Line tone="negative">
              {t('over', {
                needs: formatInteger(quota.needs),
                room: formatInteger(quota.room),
                short: quota.short,
              })}
            </Line>
          ) : null}
        </>
      )}
      {ask === null || !creating ? null : (
        <>
          <Line>
            {ask.used === null || ask.limit === null
              ? t('askNoDay', { answers: ask.answers, cost: askCost })
              : t('ask', {
                  answers: ask.answers,
                  cost: askCost,
                  runs: formatInteger(ask.runs),
                  limit: formatInteger(ask.limit),
                  used: formatInteger(ask.used),
                })}
          </Line>
          {ask.runs > 1 ? (
            <Line>
              {t('askRuns', {
                runs: formatInteger(ask.runs),
                sizes: formatList(
                  ask.sizes.map((size) => formatInteger(size)),
                  locale,
                ),
              })}
            </Line>
          ) : null}
          {askReason === null ? null : <Line>{askReason}</Line>}
          {askSlot}
        </>
      )}
      {!hasLines || nextRun === null ? null : (
        <Line>
          {nextRun.kind === 'paused'
            ? t('paused')
            : t('nextRun', { when: formatDetailDateTime(nextRun.at, nextRun.timeZone, locale) })}
        </Line>
      )}
      {blocked === 'cannotAdd' ? <Line tone="negative">{add('fixLines')}</Line> : null}
      {blocked === 'allTracked' ? <Line>{add('allTracked')}</Line> : null}
    </div>
  );
}

/** The plan as one line in the footer of a phone, where the block itself is too tall to stay in view. */
export function PlanSummary({ text }: { text: string | null }): ReactElement | null {
  if (text === null) return null;
  return <p className="min-w-0 truncate type-meta text-foreground-secondary sm:hidden">{text}</p>;
}
