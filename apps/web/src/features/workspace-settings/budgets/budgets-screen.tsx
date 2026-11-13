'use client';

import { Ban, MoreHorizontal, PiggyBank, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';

import { BudgetDialog, type BudgetDialogOutcome } from './budget-dialog';
import { aiBudgetOf, forecastTotalOf, GROUP_KEYS, type BudgetGroup, type BudgetsProject } from './budget-model';
import { BudgetStateBadge } from './budget-state-badge';
import { useBudgetStatus, useForecast } from './budgets-queries';
import { DeleteBudgetDialog } from './delete-budget-dialog';
import { UsageMeters } from './usage-meters';
import { BudgetMeter } from '@/components/app/metric/meter';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorId } from '@/lib/api/use-error-id';
import type { Budget, BudgetStatus } from '@/lib/api/types';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import { formatCurrency, formatPercent } from '@/lib/format';
import { money } from '@/lib/format/money';
import { currentMonth, monthLabel } from '@/lib/format/month';
import { useCan, useMembership } from '@/lib/permissions';
import { projectPath } from '@/lib/routes/paths';

export interface BudgetsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  /** The projects the member can open: the names of the scopes and the options of the Scope select. */
  projects: readonly BudgetsProject[];
  /** The project the quotas are read through: the route's project, else the first one the member can open. */
  limitsProjectId: string | null;
}

/** The group a budget added from the page's own button starts with. */
const DEFAULT_GROUP: BudgetGroup = 'all';
const SKELETON_ROWS = 3;

/** Money as the page shows it. */
const usd = (value: string): string => formatCurrency(money(value));
const percentOf = (status: BudgetStatus): string => formatPercent(status.pct_used / 100, { decimals: 1 });

/**
 * Settings > Workspace settings > Budgets and usage (20 section 5.19.2): the plan's two quotas, the month's AI
 * budget with its forecast, and every budget with what it has spent. A member with `budgets:manage` adds, changes
 * and deletes budgets; everyone else with `costs:read` sees them read-only. The page only stores limits and shows
 * estimates: it never starts a run, enables an engine or spends.
 */
export function BudgetsScreen(props: BudgetsScreenProps): ReactElement {
  const t = useTranslations('budgets');
  const canRead = useCan('costs:read');
  if (canRead) return <BudgetsContent {...props} />;
  return (
    <section aria-labelledby="budgets-title" className="flex flex-col gap-5">
      <h2 id="budgets-title" className="type-section-title">
        {t('title')}
      </h2>
      <EmptyState icon={Ban} title={t('noAccessTitle')} reason={t('noAccessReason')} headingLevel={3} />
    </section>
  );
}

function BudgetsContent({ workspaceId, workspaceSlug, projects, limitsProjectId }: BudgetsScreenProps): ReactElement {
  const t = useTranslations('budgets');
  const groups = useTranslations('budgets.groups');
  const common = useTranslations('common');
  const locale = useLocale();
  const canManage = useCan('budgets:manage');
  // A member limited to some projects is shown the budgets of those projects only: the workspace's AI budget is never
  // listed for them, so the card and its empty state would only mislead
  const workspaceWide = useMembership().project_ids === null;
  // The same date all UTC day, so the keys of the queries hold (the month is UTC, as the API counts it)
  const month = currentMonth(useUtcDay());
  const label = monthLabel(month, locale);
  const status = useBudgetStatus(workspaceId, month);
  const errorId = useErrorId(status.error);
  const rows = status.data?.data ?? [];
  const aiBudget = aiBudgetOf(rows);
  const forecast = useForecast(workspaceId, month, aiBudget !== null);
  const hasRows = status.data !== undefined;
  const refetching = status.isFetching && hasRows;

  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const [initialGroup, setInitialGroup] = useState<BudgetGroup>(DEFAULT_GROUP);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  // Whether the add dialog was opened from the empty state, whose button is gone once the budget exists
  const [fromEmptyState, setFromEmptyState] = useState(false);
  // Once a row is gone together with its menu button, a closing delete question hands focus to the heading
  const [rowGone, setRowGone] = useState(false);
  // Whether focus goes to the heading when the add or edit dialog goes away: what opened it is gone
  const focusHeading = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // The budget whose menu opened a dialog: focus goes back to that row's menu button when the dialog closes. The
  // button is found by its attribute when it is needed, since a row is drawn again at every refresh.
  const [openedFrom, setOpenedFrom] = useState<string | null>(null);
  const latest = useRef({ openedFrom, rowGone });
  useEffect(() => {
    latest.current = { openedFrom, rowGone };
  });
  const menuButtonOfOpener = useCallback((): HTMLElement | null => {
    const from = latest.current.openedFrom;
    return from === null
      ? null
      : (document.querySelector<HTMLElement>(`[data-budget-menu="${from}"]`) ?? heading.current);
  }, []);
  const deleteFocus = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current(): HTMLElement | null {
        return latest.current.rowGone ? heading.current : menuButtonOfOpener();
      },
    }),
    [menuButtonOfOpener],
  );

  const scopeName = (projectId: string | null): string => {
    if (projectId === null) return t('table.workspace');
    return projects.find((project) => project.id === projectId)?.name ?? t('table.deletedProject');
  };
  const promptsProject = projects.find((project) => project.id === limitsProjectId);
  const promptsHref =
    promptsProject === undefined ? null : projectPath(workspaceSlug, promptsProject.slug, '/ai/prompts');

  const openAdd = (group: BudgetGroup, emptyState: boolean): void => {
    setInitialGroup(group);
    setFromEmptyState(emptyState);
    setOpenedFrom(null);
    setEditing('new');
  };

  const itemsFor = (budget: Budget): MenuItemDef[] => [
    {
      id: 'edit',
      label: t('table.edit'),
      onSelect: () => {
        setFromEmptyState(false);
        setOpenedFrom(budget.budget_id);
        setEditing(budget);
      },
    },
    {
      id: 'delete',
      label: t('table.delete'),
      tone: 'destructive',
      onSelect: () => {
        setRowGone(false);
        setOpenedFrom(budget.budget_id);
        setDeleting(budget);
      },
    },
  ];

  const columns: PlainColumn<BudgetStatus>[] = [
    {
      id: 'scope',
      header: t('table.scopeAndGroup'),
      cell: (row) => (
        // The row header cell has no vertical padding of its own: two lines keep 4 px from the dividers
        <span className="flex flex-col py-1">
          <span>{scopeName(row.budget.project_id)}</span>
          <span className="type-meta">{groups(GROUP_KEYS[row.budget.workload])}</span>
        </span>
      ),
    },
    {
      id: 'amount',
      header: t('table.spentAndLimit'),
      cell: (row) => t('table.spentOfLimit', { spent: usd(row.spent_usd), limit: usd(row.budget.limit_usd) }),
    },
    {
      id: 'used',
      header: t('table.used'),
      cell: (row) => (
        <span className="flex items-center gap-2">
          <BudgetMeter
            size="cell"
            pct={row.pct_used}
            softLimitPct={row.budget.soft_limit_pct}
            state={row.state}
            label={t('budgetValue', { pct: percentOf(row), limit: usd(row.budget.limit_usd) })}
          />
          <span className="num">{percentOf(row)}</span>
        </span>
      ),
    },
    { id: 'state', header: t('table.state'), cell: (row) => <BudgetStateBadge state={row.state} /> },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('table.actions'),
            hideHeader: true,
            actions: true,
            cell: (row: BudgetStatus) => (
              <Menu
                align="end"
                trigger={
                  <IconButton
                    icon={MoreHorizontal}
                    size="icon-sm"
                    variant="ghost"
                    label={t('table.actionsFor', {
                      scope: scopeName(row.budget.project_id),
                      group: groups(GROUP_KEYS[row.budget.workload]),
                    })}
                    data-budget-menu={row.budget.budget_id}
                  />
                }
                items={itemsFor(row.budget)}
              />
            ),
          } satisfies PlainColumn<BudgetStatus>,
        ]
      : []),
  ];

  return (
    <section aria-labelledby="budgets-title" className="flex flex-col gap-5">
      <div>
        <h2 id="budgets-title" ref={heading} tabIndex={-1} className="type-section-title outline-none">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('meta', { month: label })}</p>
      </div>
      {canManage ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      <UsageMeters workspaceId={workspaceId} limitsProjectId={limitsProjectId} promptsHref={promptsHref} />
      {workspaceWide && (status.isPending || hasRows) ? (
        <section
          aria-label={t('ai.title')}
          className={aiBudget === null ? 'rounded-lg border border-border bg-surface' : undefined}
        >
          {!hasRows ? (
            <div aria-busy="true" className="flex flex-col gap-3 p-4">
              <Skeleton shape="text-12" widthPct={48} />
              <Skeleton shape="text-12" widthPct={72} />
              <Skeleton shape="text-12" widthPct={56} />
            </div>
          ) : aiBudget === null ? (
            <EmptyState
              icon={PiggyBank}
              headingLevel={3}
              title={t('ai.emptyTitle')}
              reason={canManage ? t('ai.emptyReason') : t('ai.emptyReasonReadOnly')}
              primaryAction={
                canManage ? (
                  <Button variant="primary" icon={Plus} onClick={() => openAdd('ai_prompt', true)}>
                    {t('ai.add')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <AiBudgetCard
              status={aiBudget}
              forecast={{
                total: forecast.data === undefined ? null : forecastTotalOf(forecast.data.data),
                pending: forecast.isPending,
                failed: forecast.isError,
                retrying: forecast.isFetching,
                retry: () => void forecast.refetch(),
              }}
            />
          )}
        </section>
      ) : null}
      <section aria-labelledby="budgets-all" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="budgets-all" className="type-subsection-title">
            {t('table.title')}
          </h3>
          {canManage ? (
            <Button variant="secondary" icon={Plus} onClick={() => openAdd(DEFAULT_GROUP, false)}>
              {t('table.add')}
            </Button>
          ) : null}
        </div>
        {status.isError && hasRows ? (
          <div role="status" className="flex flex-wrap items-center gap-3">
            <p className="type-meta">{t('stale')}</p>
            <Button variant="secondary" size="sm" loading={status.isFetching} onClick={() => void status.refetch()}>
              {common('retry')}
            </Button>
          </div>
        ) : null}
        <div className="relative" aria-busy={refetching}>
          <PlainTable<BudgetStatus>
            caption={t('table.label')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.budget.budget_id}
            status={status.isError && !hasRows ? 'error' : status.isPending ? 'loading' : 'ready'}
            errorState={
              <InlineError
                title={t('loadFailed')}
                reason={t('loadFailedReason')}
                errorId={errorId}
                onRetry={() => void status.refetch()}
                retrying={status.isFetching}
                retryLabel={common('retry')}
              />
            }
            emptyText={t('table.empty', { month: label })}
            skeletonRows={SKELETON_ROWS}
          />
          {/* After the table so it paints over the table's top edge: the static bar of a refetch with rows kept */}
          {refetching ? (
            <div
              aria-hidden="true"
              data-slot="budgets-refetch-bar"
              className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg bg-primary"
            />
          ) : null}
        </div>
      </section>
      <BudgetDialog
        workspaceId={workspaceId}
        budget={editing}
        initialGroup={initialGroup}
        projects={projects}
        allowWorkspace={workspaceWide}
        scopeName={scopeName}
        onClose={(outcome: BudgetDialogOutcome) => {
          // The first AI budget is made from the empty state, whose button is gone once the card shows; a budget
          // deleted by someone else takes its row, and the menu the dialog came from, with it
          focusHeading.current = outcome === 'gone' || (outcome === 'created' && fromEmptyState);
          setEditing(null);
        }}
        // Read when the dialog goes away, after `onClose` has said how it ended; `true` is back to what opened it
        finalFocus={() => (focusHeading.current ? heading.current : menuButtonOfOpener()) ?? true}
      />
      <DeleteBudgetDialog
        workspaceId={workspaceId}
        budget={deleting}
        scopeName={scopeName}
        onRemoved={() => setRowGone(true)}
        onClose={() => setDeleting(null)}
        finalFocus={deleteFocus}
      />
    </section>
  );
}

interface ForecastReading {
  /** The month's forecast AI spend of the projects, or `null` while unknown. */
  total: number | null;
  pending: boolean;
  failed: boolean;
  retrying: boolean;
  retry: () => void;
}

/**
 * The AI answers budget of the workspace: what it has spent of its limit, the forecast of the month from the
 * price book (an estimate, said so), and the runs it blocked. The forecast is left out when it is unknown.
 */
function AiBudgetCard({ status, forecast }: { status: BudgetStatus; forecast: ForecastReading }): ReactElement {
  const t = useTranslations('budgets.ai');
  const common = useTranslations('common');
  const root = useTranslations('budgets');
  const pct = percentOf(status);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="type-subsection-title">{t('title')}</h3>
        <BudgetStateBadge state={status.state} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BudgetMeter
          size="summary"
          pct={status.pct_used}
          softLimitPct={status.budget.soft_limit_pct}
          state={status.state}
          label={root('budgetValue', { pct, limit: usd(status.budget.limit_usd) })}
        />
        <span className="num type-body">{pct}</span>
      </div>
      <p className="num type-body">
        {t('spent', { spent: usd(status.spent_usd), limit: usd(status.budget.limit_usd) })}
      </p>
      {forecast.pending ? (
        <Skeleton shape="text-12" widthPct={56} />
      ) : forecast.failed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="type-meta">{t('forecastFailed')}</p>
          <Button variant="secondary" size="sm" loading={forecast.retrying} onClick={forecast.retry}>
            {common('retry')}
          </Button>
        </div>
      ) : forecast.total === null ? null : (
        <p className="type-meta">{t('forecast', { amount: formatCurrency(forecast.total) })}</p>
      )}
      {status.blocked_runs > 0 ? <p className="type-meta">{t('blocked', { count: status.blocked_runs })}</p> : null}
    </div>
  );
}
