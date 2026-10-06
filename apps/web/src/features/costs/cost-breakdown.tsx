'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { BudgetMeter } from './budget-meter';
import { BudgetStatusBadge } from './budget-status-badge';
import { budgetRows, money, projectBudget, shareOf } from './cost-model';
import { CostsError } from './costs-error';
import { useCosts, usePriceBook, type CostScope } from './costs-queries';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import type { BudgetStatus, BudgetStatusList, CostRow, Price } from '@/lib/api/types';
import { formatBusinessDate, formatCurrency, formatInteger, formatPercent, formatUnitPrice } from '@/lib/format';
import type { MonthKey } from '@/lib/format/month';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';

export const COST_TABS = ['provider', 'project', 'units', 'budgets'] as const;
export type CostTab = (typeof COST_TABS)[number];

export interface CostsProject {
  id: string;
  slug: string;
  name: string;
  /** The project is archived: the cost routes still count what it spent, so it is listed, named as archived. */
  archived?: boolean;
}

/** The name of a project in a cost table or filter: an archived one says so. */
export function useProjectLabel(): (project: CostsProject) => string {
  const t = useTranslations('costs');
  return (project) => (project.archived === true ? t('archivedProject', { name: project.name }) : project.name);
}

export interface CostBreakdownProps {
  scope: CostScope;
  now: Date;
  month: MonthKey;
  projects: readonly CostsProject[];
  budgets: UseQueryResult<BudgetStatusList>;
  tab: CostTab;
  onTabChange: (tab: CostTab) => void;
  /** The sentence of a table with no rows: no costs in the month, or none for the filters. */
  emptyText: string;
}

type Status = 'loading' | 'ready' | 'error';

const statusOf = (query: { isError: boolean; isPending: boolean }): Status =>
  query.isError ? 'error' : query.isPending ? 'loading' : 'ready';

const rowKeyOf = (row: CostRow): string => JSON.stringify(row.keys);

/** Money as the tables show it. */
const usd = (value: string): string => formatCurrency(money(value));

/** A part of a total, as "47.7%". */
const share = (value: string, total: string): string => formatPercent(shareOf(value, total), { decimals: 1 });

/**
 * Where the month's money went, in four tables (24-page-templates.md section 9.14): by provider, by project,
 * the price book that estimates are made from, and the budgets. Each panel asks for its own data when it is
 * opened, and shows its own failure.
 */
export function CostBreakdown({
  scope,
  now,
  month,
  projects,
  budgets,
  tab,
  onTabChange,
  emptyText,
}: CostBreakdownProps): ReactElement {
  const t = useTranslations('costs');
  return (
    <Tabs<CostTab>
      variant="segmented"
      label={t('tabs.label')}
      value={tab}
      onValueChange={onTabChange}
      className="gap-3"
      items={COST_TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
    >
      <TabsPanel value="provider">
        <ProviderPanel scope={scope} now={now} emptyText={emptyText} />
      </TabsPanel>
      <TabsPanel value="project">
        <ProjectPanel scope={scope} now={now} projects={projects} budgets={budgets} emptyText={emptyText} />
      </TabsPanel>
      <TabsPanel value="units">
        <UnitsPanel scope={scope} month={month} now={now} />
      </TabsPanel>
      <TabsPanel value="budgets">
        <BudgetsPanel projects={projects} budgets={budgets} />
      </TabsPanel>
    </Tabs>
  );
}

function ProviderPanel({
  scope,
  now,
  emptyText,
}: Pick<CostBreakdownProps, 'scope' | 'now' | 'emptyText'>): ReactElement {
  const t = useTranslations('costs');
  const query = useCosts(scope, ['provider'], now);
  const total = query.data?.meta.total_cost_usd ?? '0';
  const columns: PlainColumn<CostRow>[] = [
    { id: 'provider', header: t('provider'), align: 'left', cell: (row) => row.keys.provider ?? '' },
    { id: 'requests', header: t('requests'), align: 'right', cell: (row) => formatInteger(row.request_count) },
    { id: 'subjects', header: t('subjects'), align: 'right', cell: (row) => formatInteger(row.subjects) },
    { id: 'cost', header: t('cost'), align: 'right', cell: (row) => usd(row.cost_usd) },
    { id: 'share', header: t('share'), align: 'right', cell: (row) => share(row.cost_usd, total) },
  ];
  return (
    <PlainTable
      caption={t('tabs.provider')}
      columns={columns}
      rows={query.data?.data ?? []}
      rowKey={rowKeyOf}
      status={statusOf(query)}
      errorState={<CostsError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />}
      emptyText={emptyText}
    />
  );
}

function ProjectPanel({
  scope,
  now,
  projects,
  budgets,
  emptyText,
}: Pick<CostBreakdownProps, 'scope' | 'now' | 'projects' | 'budgets' | 'emptyText'>): ReactElement {
  const t = useTranslations('costs');
  const projectLabel = useProjectLabel();
  const query = useCosts(scope, ['project'], now);
  const total = query.data?.meta.total_cost_usd ?? '0';
  const budgetList = budgets.data?.data ?? [];
  const rows = query.data?.data ?? [];
  // A row's cost is of the filtered workloads, so its budget is one that covers them
  const budgetOf = (row: CostRow): BudgetStatus | null =>
    projectBudget(budgetList, row.keys.project ?? '', scope.workloads ?? []);
  // The budget columns appear when any listed project has a budget
  const showBudgets = rows.some((row) => budgetOf(row) !== null);
  const nameOf = (row: CostRow): string => {
    const id = row.keys.project ?? '';
    if (id === '') return t('noProject');
    const known = projects.find((project) => project.id === id);
    return known === undefined ? t('deletedProject') : projectLabel(known);
  };
  const columns: PlainColumn<CostRow>[] = [
    { id: 'project', header: t('project'), align: 'left', cell: nameOf },
    { id: 'cost', header: t('cost'), align: 'right', cell: (row) => usd(row.cost_usd) },
    { id: 'share', header: t('share'), align: 'right', cell: (row) => share(row.cost_usd, total) },
    ...(showBudgets
      ? [
          {
            id: 'used',
            header: t('used'),
            align: 'left',
            cell: (row: CostRow): ReactElement | null => {
              const status = budgetOf(row);
              return status === null ? null : <BudgetUse status={status} showWorkload />;
            },
          } satisfies PlainColumn<CostRow>,
          {
            id: 'status',
            header: t('status'),
            align: 'left',
            cell: (row: CostRow): ReactElement | null => {
              const status = budgetOf(row);
              return status === null ? null : <BudgetStatusBadge state={status.state} />;
            },
          } satisfies PlainColumn<CostRow>,
        ]
      : []),
  ];
  return (
    <PlainTable
      caption={t('tabs.project')}
      columns={columns}
      rows={rows}
      rowKey={rowKeyOf}
      status={statusOf(query)}
      errorState={<CostsError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />}
      emptyText={emptyText}
    />
  );
}

/**
 * The meter of a budget with the share used beside it. Where the budget is not named elsewhere in the row
 * (a project's row picks one of its budgets), a budget for one workload says which: "SEO rank budget".
 */
function BudgetUse({ status, showWorkload = false }: { status: BudgetStatus; showWorkload?: boolean }): ReactElement {
  const t = useTranslations('costs');
  const workloadName = useWorkloadName();
  return (
    <span className="flex items-center gap-2">
      <BudgetMeter
        size="cell"
        pct={status.pct_used}
        softLimitPct={status.budget.soft_limit_pct}
        state={status.state}
        label={t('budgetValue', {
          pct: formatPercent(status.pct_used / 100, { decimals: 1 }),
          limit: usd(status.budget.limit_usd),
        })}
      />
      <span className="num">{formatPercent(status.pct_used / 100, { decimals: 1 })}</span>
      {showWorkload && status.budget.workload !== 'all' ? (
        <span className="type-meta whitespace-nowrap text-foreground-tertiary">
          {t('workloadBudget', { workload: workloadName(status.budget.workload) })}
        </span>
      ) : null}
    </span>
  );
}

function UnitsPanel({ scope, month, now }: Pick<CostBreakdownProps, 'scope' | 'month' | 'now'>): ReactElement {
  const t = useTranslations('costs');
  const query = usePriceBook(scope.workspaceId, month, now);
  const columns: PlainColumn<Price>[] = [
    { id: 'provider', header: t('provider'), align: 'left', cell: (row) => row.provider_code },
    { id: 'endpoint', header: t('endpoint'), align: 'left', cell: (row) => row.endpoint },
    { id: 'unit', header: t('unit'), align: 'left', cell: (row) => row.price_unit },
    {
      id: 'price',
      header: t('unitPrice'),
      align: 'right',
      cell: (row) => formatUnitPrice(money(row.unit_price_usd)),
    },
    { id: 'from', header: t('validFrom'), align: 'right', cell: (row) => formatBusinessDate(row.valid_from) },
    { id: 'verified', header: t('verified'), align: 'right', cell: (row) => formatBusinessDate(row.verified_at) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 type-meta">
        <Badge variant="outline">{t('estimate')}</Badge>
        {t('unitCostsNote')}
      </p>
      <PlainTable
        caption={t('tabs.units')}
        columns={columns}
        rows={query.data?.data ?? []}
        rowKey={(row) => row.price_id}
        status={statusOf(query)}
        errorState={<CostsError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />}
        emptyText={t('noPrices')}
      />
    </div>
  );
}

function BudgetsPanel({ projects, budgets }: Pick<CostBreakdownProps, 'projects' | 'budgets'>): ReactElement {
  const t = useTranslations('costs');
  const projectLabel = useProjectLabel();
  const workloadName = useWorkloadName();
  const columns: PlainColumn<BudgetStatus>[] = [
    {
      id: 'scope',
      header: t('scope'),
      align: 'left',
      cell: (row) => {
        if (row.budget.project_id === null) return t('workspaceScope');
        const known = projects.find((project) => project.id === row.budget.project_id);
        return known === undefined ? t('deletedProject') : projectLabel(known);
      },
    },
    {
      id: 'workload',
      header: t('workload'),
      align: 'left',
      cell: (row) => (row.budget.workload === 'all' ? t('allWorkloads') : workloadName(row.budget.workload)),
    },
    { id: 'limit', header: t('limit'), align: 'right', cell: (row) => usd(row.budget.limit_usd) },
    { id: 'spent', header: t('spent'), align: 'right', cell: (row) => usd(row.spent_usd) },
    { id: 'committed', header: t('committed'), align: 'right', cell: (row) => usd(row.committed_estimate_usd) },
    { id: 'used', header: t('used'), align: 'left', cell: (row) => <BudgetUse status={row} /> },
    { id: 'status', header: t('status'), align: 'left', cell: (row) => <BudgetStatusBadge state={row.state} /> },
  ];
  return (
    <PlainTable
      caption={t('tabs.budgets')}
      columns={columns}
      rows={budgetRows(budgets.data?.data ?? [])}
      rowKey={(row) => row.budget.budget_id}
      status={statusOf(budgets)}
      errorState={
        <CostsError error={budgets.error} onRetry={() => void budgets.refetch()} retrying={budgets.isFetching} />
      }
      emptyText={t('noBudget')}
    />
  );
}
