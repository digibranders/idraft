'use client';

import { Ban } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs';
import { useMemo, type ReactElement } from 'react';

import { BudgetMeter } from './budget-meter';
import { COST_TABS, CostBreakdown, type CostsProject } from './cost-breakdown';
import { money, shareOf, workspaceBudget } from './cost-model';
import { CostTable, type CostColumn } from './cost-table';
import { CostsError } from './costs-error';
import { useBudgetStatus, useCosts, type CostScope } from './costs-queries';
import { useSpendChart } from './use-spend-chart';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { FilterBar } from '@/components/app/filters/filter-bar';
import type { FilterField } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { MetricStrip, type MetricStripItem } from '@/components/app/metric/metric-strip';
import { PageHeader } from '@/components/app/shell/page-header';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { costWorkloadValues } from '@/lib/api/schema';
import type { CostRow } from '@/lib/api/types';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import type { FilterValue } from '@/lib/filters/filter-values';
import { EMPTY_VALUE, formatCurrency, formatDateRange, formatInteger, formatList, formatPercent } from '@/lib/format';
import { currentMonth, monthDays, monthLabel, recentMonths, type MonthKey } from '@/lib/format/month';
import { useCan } from '@/lib/permissions';
import { workspacePath } from '@/lib/routes/paths';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';
import { isCostWorkload } from '@/lib/workloads/workloads';

export interface CostsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  /** The projects the member can open: the names of the cost rows and the options of the Project filter. */
  projects: readonly CostsProject[];
}

const PAGE = 'flex flex-col gap-4 px-3 pt-5 pb-8 md:px-4 lg:px-5';

/** The axis and tooltip format of the spend chart. */
const axisCurrency = (value: number): string => formatCurrency(value, { context: 'axis' });

const usd = (value: string): string => formatCurrency(money(value), { context: 'summary' });

const enumValues = (value: FilterValue | undefined): string[] => (value?.kind === 'enum' ? [...value.values] : []);

/**
 * Workspace Costs (T1 with tables, 24-page-templates.md section 9.14): what the month's data collection
 * cost, where it went, and where the budgets stand. Without `costs:read` the page says so and asks for
 * nothing.
 */
export function CostsScreen(props: CostsScreenProps): ReactElement {
  const t = useTranslations('costs');
  const canRead = useCan('costs:read');
  if (canRead) return <CostsContent {...props} />;
  return (
    <div className={PAGE}>
      <PageHeader title={t('title')} />
      <EmptyState
        icon={Ban}
        title={t('noAccessTitle')}
        reason={t('noAccessReason')}
        secondaryAction={
          <TextLink render={<Link href={workspacePath(props.workspaceSlug)} />}>{t('backToOverview')}</TextLink>
        }
        headingLevel={2}
      />
    </div>
  );
}

function CostsContent({ workspaceId, projects }: CostsScreenProps): ReactElement {
  const t = useTranslations('costs');
  const common = useTranslations('common');
  const locale = useLocale();
  const workloadName = useWorkloadName();
  // The same date all UTC day, so the keys of its queries hold; a new day (or a tab woken after one) is read
  const now = useUtcDay();
  const months = useMemo(() => recentMonths(now), [now]);
  const thisMonth = currentMonth(now);
  const [monthParam, setMonthParam] = useQueryState('month', parseAsString.withOptions({ history: 'replace' }));
  const month = months.find((candidate) => candidate === monthParam) ?? thisMonth;
  const [tab, setTab] = useQueryState(
    'tab',
    parseAsStringLiteral(COST_TABS).withDefault('provider').withOptions({ history: 'replace' }),
  );
  const label = monthLabel(month, locale);
  const { from, to } = monthDays(month, now);

  // The providers the month has costs for, whatever the filters: the options of the Provider filter
  const providerRows = useCosts({ workspaceId, month }, ['provider'], now);
  const fields = useMemo(
    (): FilterField[] => [
      {
        id: 'project',
        kind: 'enum',
        label: t('filters.project'),
        multi: false,
        options: projects.map((project) => ({ value: project.id, label: project.name })),
      },
      {
        id: 'workload',
        kind: 'enum',
        label: t('filters.workload'),
        multi: true,
        options: costWorkloadValues.map((workload) => ({ value: workload, label: workloadName(workload) })),
      },
      {
        id: 'provider',
        kind: 'enum',
        label: t('filters.provider'),
        multi: false,
        options: (providerRows.data?.data ?? []).flatMap((row) =>
          row.keys.provider === undefined ? [] : [{ value: row.keys.provider, label: row.keys.provider }],
        ),
        optionsLoading: providerRows.isPending || providerRows.isError,
      },
    ],
    [t, projects, workloadName, providerRows.data, providerRows.isPending, providerRows.isError],
  );
  // A filter of the link that the month has nothing for (a provider with no costs in it) is left out, and the person is told
  const [values, setValues] = useUrlFilters(fields, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: t('droppedFilters.title', { count: dropped.length }),
        description: t('droppedFilters.description', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
          month: label,
        }),
      }),
  });
  const [projectId] = enumValues(values.project);
  const [provider] = enumValues(values.provider);
  const scope: CostScope = {
    workspaceId,
    month,
    projectId,
    workloads: enumValues(values.workload).filter(isCostWorkload),
    provider,
  };
  const filtered = Object.keys(values).length > 0;
  const emptyText = filtered ? t('emptyFiltered', { month: label }) : t('empty', { month: label });

  const total = useCosts(scope, [], now);
  const byDay = useCosts(scope, ['day', 'workload'], now);
  const byWorkload = useCosts(scope, ['workload'], now);
  const budgets = useBudgetStatus(workspaceId, month);

  const chart = useSpendChart(byDay.data?.data, from, to);

  const budgetList = budgets.data?.data ?? [];
  const workspace = workspaceBudget(budgetList);
  const blockedRuns = budgetList.reduce((sum, row) => sum + row.blocked_runs, 0);
  const totalUsd = total.data?.meta.total_cost_usd;
  const stripItems: MetricStripItem[] = [
    {
      id: 'monthToDate',
      label: t('monthToDate'),
      value: totalUsd === undefined ? EMPTY_VALUE : usd(totalUsd),
      context: formatDateRange(from, to),
    },
    budgets.isError
      ? {
          id: 'budget',
          label: t('budget'),
          value: t('budgetFailed'),
          unknown: { kind: 'pending' },
          meter: (
            <Button variant="secondary" size="sm" loading={budgets.isFetching} onClick={() => void budgets.refetch()}>
              {common('retry')}
            </Button>
          ),
        }
      : workspace === null
        ? { id: 'budget', label: t('budget'), value: t('noBudget'), unknown: { kind: 'not-applicable' } }
        : {
            id: 'budget',
            label: t('budget'),
            value: t('budgetValue', {
              pct: formatPercent(workspace.pct_used / 100, { decimals: 1 }),
              limit: usd(workspace.budget.limit_usd),
            }),
            meter: (
              <BudgetMeter
                size="summary"
                pct={workspace.pct_used}
                softLimitPct={workspace.budget.soft_limit_pct}
                state={workspace.state}
                label={t('budgetValue', {
                  pct: formatPercent(workspace.pct_used / 100, { decimals: 1 }),
                  limit: usd(workspace.budget.limit_usd),
                })}
              />
            ),
          },
    // Without the budgets the count is unknown, not zero
    ...(budgets.isError
      ? [{ id: 'blockedRuns', label: t('blockedRuns'), value: EMPTY_VALUE, unknown: { kind: 'pending' as const } }]
      : blockedRuns > 0
        ? [{ id: 'blockedRuns', label: t('blockedRuns'), value: formatInteger(blockedRuns) }]
        : []),
  ];

  const stripGroups = [{ id: 'month', items: stripItems }];

  const workloadColumns: CostColumn<CostRow>[] = [
    { id: 'workload', header: t('workload'), align: 'left', cell: (row) => workloadName(row.keys.workload ?? '') },
    { id: 'cost', header: t('cost'), align: 'right', cell: (row) => formatCurrency(money(row.cost_usd)) },
    {
      id: 'share',
      header: t('share'),
      align: 'right',
      cell: (row) => formatPercent(shareOf(row.cost_usd, byWorkload.data?.meta.total_cost_usd ?? '0'), { decimals: 1 }),
    },
  ];
  const sources = total.data?.meta.cost_sources;

  return (
    <div className={PAGE}>
      <PageHeader title={t('title')} meta={t('meta', { month: label })} />
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-48">
          <Select<MonthKey>
            size="sm"
            aria-label={t('month')}
            placeholder={t('month')}
            value={month}
            onValueChange={(next) => void setMonthParam(next === thisMonth ? null : next)}
            options={months.map((value) => ({ value, label: monthLabel(value, locale) }))}
          />
        </div>
        <div className="min-w-0 flex-1">
          <FilterBar fields={fields} values={values} onChange={setValues} />
        </div>
      </div>
      {providerRows.isError ? (
        <div role="status" className="flex flex-wrap items-center gap-3">
          <p className="type-meta">{t('providersFailed')}</p>
          <Button
            variant="secondary"
            size="sm"
            loading={providerRows.isFetching}
            onClick={() => void providerRows.refetch()}
          >
            {common('retry')}
          </Button>
        </div>
      ) : null}
      {total.isError ? (
        <div className="rounded-lg border border-border bg-surface">
          <CostsError onRetry={() => void total.refetch()} retrying={total.isFetching} />
        </div>
      ) : (
        <MetricStrip
          size="md"
          label={t('strip')}
          groups={stripGroups}
          status={total.isPending || budgets.isPending ? 'loading' : 'ready'}
        />
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 lg:flex-1">
          {byDay.isError ? (
            <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <h2 className="type-section-title">{t('chartTitle')}</h2>
              <CostsError onRetry={() => void byDay.refetch()} retrying={byDay.isFetching} />
            </section>
          ) : !byDay.isPending && chart.series.length === 0 ? (
            <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
              <h2 className="type-section-title">{t('chartTitle')}</h2>
              <p className="type-body text-foreground-secondary">{emptyText}</p>
            </section>
          ) : (
            <ChartFrame
              title={t('chartTitle')}
              variant="panel"
              kind="bar"
              stacked
              categories={chart.categories}
              categoryHeader={t('day')}
              series={chart.series}
              formatValue={axisCurrency}
              height={240}
              summary={t('chartSummary', { month: label, total: totalUsd === undefined ? EMPTY_VALUE : usd(totalUsd) })}
              status={byDay.isPending ? 'loading' : 'ready'}
              footnote={
                sources === undefined
                  ? undefined
                  : t('sources', {
                      provider: usd(sources.provider_reported),
                      tokens: usd(sources.computed_from_tokens),
                      estimate: usd(sources.price_book_estimate),
                    })
              }
            />
          )}
        </div>
        <section aria-labelledby="costs-by-workload" className="flex min-w-0 flex-col gap-2 lg:w-90 lg:shrink-0">
          <h2 id="costs-by-workload" className="type-section-title">
            {t('byWorkload')}
          </h2>
          <CostTable
            caption={t('byWorkload')}
            columns={workloadColumns}
            rows={byWorkload.data?.data ?? []}
            rowKey={(row) => row.keys.workload ?? ''}
            footer={[
              t('total'),
              byWorkload.data === undefined ? '' : formatCurrency(money(byWorkload.data.meta.total_cost_usd)),
              '',
            ]}
            status={byWorkload.isError ? 'error' : byWorkload.isPending ? 'loading' : 'ready'}
            errorState={<CostsError onRetry={() => void byWorkload.refetch()} retrying={byWorkload.isFetching} />}
            emptyText={emptyText}
          />
        </section>
      </div>
      <CostBreakdown
        scope={scope}
        now={now}
        month={month}
        projects={projects}
        budgets={budgets}
        tab={tab}
        onTabChange={(next) => void setTab(next === 'provider' ? null : next)}
        emptyText={emptyText}
      />
    </div>
  );
}
