'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactElement } from 'react';

import { quotaFigures, type Quota } from './budget-model';
import { useAiLimits } from './budgets-queries';
import { Meter } from '@/components/app/metric/meter';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import { useCan } from '@/lib/permissions';

export interface UsageMetersProps {
  workspaceId: string;
  /** The project the quotas are read through; `null` when the member can open none. */
  limitsProjectId: string | null;
  /** Where the prompts are managed; `null` without a project to open. */
  promptsHref: Route | null;
}

type Reading = { state: 'loading' } | { state: 'unavailable' } | { state: 'ready'; quota: Quota };

/**
 * The two quotas of the plan that data collection draws on, as a used-of-limit line and a meter each (23
 * section 11.2): the workspace's active prompts, and its AI answers this month. The meter turns warning from
 * the soft share and is never red. A quota that cannot be read (no project to read it through, a role without
 * `data:read`, a failed read) says "Not available" and why; it is never shown as 0.
 */
export function UsageMeters({ workspaceId, limitsProjectId, promptsHref }: UsageMetersProps): ReactElement {
  const t = useTranslations('budgets.usage');
  const common = useTranslations('common');
  const canRead = useCan('data:read');
  const limits = useAiLimits({ workspaceId, projectId: limitsProjectId }, canRead);
  const askable = canRead && limitsProjectId !== null;
  const reason = !canRead
    ? t('reasonRole')
    : limitsProjectId === null
      ? t('reasonProject')
      : limits.isError
        ? t('reasonFailed')
        : null;
  const reading = (pick: 'prompts' | 'ai_observations_month'): Reading => {
    if (limits.data !== undefined) return { state: 'ready', quota: limits.data.data[pick] };
    return askable && limits.isPending ? { state: 'loading' } : { state: 'unavailable' };
  };
  return (
    <section
      aria-labelledby="budgets-usage"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h3 id="budgets-usage" className="type-subsection-title">
        {t('title')}
      </h3>
      <dl className="flex flex-col gap-3">
        <QuotaRow label={t('prompts')} valueKey="promptsValue" reading={reading('prompts')} />
        <QuotaRow label={t('answers')} valueKey="answersValue" reading={reading('ai_observations_month')} />
      </dl>
      {reason === null ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="type-meta">{reason}</p>
          {limits.isError && askable ? (
            <Button variant="secondary" size="sm" loading={limits.isFetching} onClick={() => void limits.refetch()}>
              {common('retry')}
            </Button>
          ) : null}
        </div>
      )}
      {promptsHref === null ? null : (
        <p>
          <TextLink render={<Link href={promptsHref} />}>{t('openPrompts')}</TextLink>
        </p>
      )}
    </section>
  );
}

function QuotaRow({
  label,
  valueKey,
  reading,
}: {
  label: string;
  valueKey: 'promptsValue' | 'answersValue';
  reading: Reading;
}): ReactElement {
  const t = useTranslations('budgets.usage');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <dt className="w-full type-label sm:w-48">{label}</dt>
      <dd className="flex min-h-6 items-center gap-3">
        {reading.state === 'loading' ? (
          <Skeleton shape="text-12" widthPct={80} />
        ) : reading.state === 'unavailable' ? (
          <span className="type-body text-foreground-secondary">{t('notAvailable')}</span>
        ) : (
          <QuotaMeter label={label} valueKey={valueKey} quota={reading.quota} />
        )}
      </dd>
    </div>
  );
}

function QuotaMeter({
  label,
  valueKey,
  quota,
}: {
  label: string;
  valueKey: 'promptsValue' | 'answersValue';
  quota: Quota;
}): ReactElement {
  const t = useTranslations('budgets.usage');
  const figures = quotaFigures(quota);
  return (
    <>
      <Meter
        value={figures.value}
        max={figures.max}
        warnFrom={figures.warnFrom}
        label={label}
        valueText={t(valueKey, { used: figures.used, limit: figures.limit })}
        width="summary"
      />
      <span className="num type-body">{t('of', { used: figures.used, limit: figures.limit })}</span>
    </>
  );
}
