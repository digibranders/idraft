'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useBudgetStatus } from './data/activity-reads';
import { chooseSpend, type SpendFacts } from './model/spend-model';
import { useErrorState, useStaleNotice, type FrameState } from './parts/frame-state';
import { useCardExport } from '../engines/use-card-seams';
import { useOverview } from '../../overview-context';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { BudgetMeter } from '@/components/app/metric/meter';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CardProps } from '@/features/layouts';
import { EMPTY_VALUE, formatCurrency, formatInteger, formatPercent } from '@/lib/format';
import { useCan } from '@/lib/permissions';

/** One fact of the card: its label and its text, in the Table view and in the export. */
interface Fact {
  label: string;
  text: string;
}

/**
 * `ops.ai_spend`: how much of this month's AI budget has been used, as the API counted it. One budget (the project's
 * `ai_prompt` budget, else the workspace's, else an `all` budget) and its scope is named; several are never added up.
 * Every percent stands beside the amounts it is a share of. An amount that is not a number is n/a, never $0.
 *
 * Money is read only with `costs:read`: the read does not run without it (`useBudgetStatus`), so a viewer makes no
 * request and sees none of it. The catalog hides the card from such a member too; this is the second guard.
 */
export default function AiSpendCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.activity.spend');
  const { project } = useOverview();
  const canReadCosts = useCan('costs:read');
  const canManageBudgets = useCan('budgets:manage');
  const read = useBudgetStatus({ subscribed: live });
  const facts: SpendFacts | null = read.data === undefined ? null : chooseSpend(read.data, project.id);

  const money = (usd: number | null): string => formatCurrency(usd);
  const percent = (pct: number, decimals: 0 | 1): string => formatPercent(pct / 100, { decimals });
  const scopeText = (spend: SpendFacts): string =>
    t(spend.scope === 'project' ? 'scopeProject' : 'scopeWorkspace', {
      workload: t(spend.workload === 'ai_prompt' ? 'workloadAiPrompt' : 'workloadAll'),
    });
  const usedText = (spend: SpendFacts): string =>
    t('used', { spent: money(spend.spentUsd), limit: money(spend.limitUsd), pct: percent(spend.pct, 1) });
  const stateText = (spend: SpendFacts): string | null => {
    if (spend.state === 'soft_exceeded') return t('stateSoft');
    if (spend.state !== 'hard_exceeded') return null;
    return t(spend.actionOnHard === 'pause' ? 'stateHardPause' : 'stateHardAlert');
  };
  const factsOf = (spend: SpendFacts): Fact[] => [
    { label: t('rowBudget'), text: scopeText(spend) },
    { label: t('rowSpent'), text: money(spend.spentUsd) },
    { label: t('rowLimit'), text: money(spend.limitUsd) },
    {
      label: t('rowShare'),
      text: t('share', { pct: percent(spend.pct, 1), spent: money(spend.spentUsd), limit: money(spend.limitUsd) }),
    },
    {
      label: t('rowSoft'),
      text: t('softLimit', { pct: percent(spend.softLimitPct, 0), limit: money(spend.limitUsd) }),
    },
    { label: t('rowCommitted'), text: spend.committedUsd === null ? EMPTY_VALUE : money(spend.committedUsd) },
    {
      label: t('rowState'),
      text: t(spend.state === 'ok' ? 'stateOk' : spend.state === 'soft_exceeded' ? 'stateSoftWord' : 'stateHardWord'),
    },
    { label: t('rowBlocked'), text: formatInteger(spend.blockedRuns) },
  ];

  const error = useErrorState(read, t('subject'));
  const stale = useStaleNotice(read.stale);
  let frame: FrameState;
  if (!canReadCosts) {
    frame = { status: 'empty', empty: { title: t('noAccessTitle'), reason: t('noAccessReason') } };
  } else if (read.status === 'error') {
    frame = { status: 'error', error };
  } else if (read.status === 'loading' || read.status === 'idle') {
    frame = { status: 'loading' };
  } else if (facts === null) {
    // The card links nothing: the budgets page ships with WP-30, so the way to it is words until its route exists
    frame = {
      status: 'empty',
      empty: { title: t('noBudgetTitle'), reason: canManageBudgets ? t('noBudgetManage') : t('noBudgetOther') },
    };
  } else {
    frame = { status: read.status === 'refetching' ? 'refetching' : 'ready', notice: stale };
  }

  const rows = facts === null ? [] : factsOf(facts);
  useCardExport(item.id, () =>
    frame.status === 'ready' || frame.status === 'refetching'
      ? { id: item.id, header: [t('headerItem'), t('headerValue')], rows: rows.map((fact) => [fact.label, fact.text]) }
      : null,
  );

  const columns: PlainColumn<Fact>[] = [
    { id: 'item', header: t('headerItem'), cell: (fact) => fact.label },
    { id: 'value', header: t('headerValue'), cell: (fact) => fact.text },
  ];
  const used = facts === null ? null : usedText(facts);
  const state = facts === null ? null : stateText(facts);
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={140}
      title={t('title')}
      summary={facts === null || used === null ? t('title') : t('summary', { used, scope: scopeText(facts) })}
      body={
        facts === null || used === null ? null : (
          <div className="flex flex-col gap-3">
            <p className="num type-body-strong">{used}</p>
            <BudgetMeter
              pct={facts.pct}
              softLimitPct={facts.softLimitPct}
              state={facts.state}
              size="summary"
              label={t('meterLabel', { used })}
            />
            <div className="flex flex-col gap-1 type-meta">
              <p>{scopeText(facts)}</p>
              {facts.committedUsd === null || facts.committedUsd <= 0 ? null : (
                <p>{t('committed', { amount: money(facts.committedUsd) })}</p>
              )}
              {state === null ? null : <p>{state}</p>}
              {facts.blockedRuns > 0 ? <p>{t('blockedRuns', { count: facts.blockedRuns })}</p> : null}
            </div>
          </div>
        )
      }
      table={
        <PlainTable
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(fact) => fact.label}
          status="ready"
          errorState={null}
          emptyText={t('noBudgetTitle')}
        />
      }
      menu={{
        fileName: t('fileName'),
        csv: { header: [t('headerItem'), t('headerValue')], rows: rows.map((fact) => [fact.label, fact.text]) },
      }}
      {...frame}
    />
  );
}
