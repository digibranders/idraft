'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, type ReactElement } from 'react';

import { aiEnginePrice, money, unitCostRows, type UnitCostLine } from './cost-model';
import { CostsError } from './costs-error';
import { useUnitCosts, type CostScope, type usePriceBook } from './costs-queries';
import { EngineBadge } from '@/components/app/engine/engine-badge';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { Button } from '@/components/ui/button';
import { EMPTY_VALUE, formatUnitPrice } from '@/lib/format';
import { monthLabel } from '@/lib/format/month';
import { useCan } from '@/lib/permissions';
import { useEngineNames } from '@/lib/runs/ai-reads';

export interface AiUnitCostsProps {
  /** The month and the Project filter of the page; the other filters do not apply to unit costs. */
  scope: CostScope;
  /** The name of a project in the Project column, which the Project filter takes away. */
  projectName: (projectId: string) => string;
  /** A project whose engine list names the engines (their names are the same in every project); none leaves the codes. */
  engineProjectId: string | undefined;
  /** The price book the tab already reads, for the Provider price column. */
  prices: ReturnType<typeof usePriceBook>;
}

/**
 * What one AI answer cost on each engine in the month, from the figures the provider reported (WB-OPS-07): one
 * row per project and engine, with the answers the average is taken over. An engine with no costed answer says
 * so in words ("n/a" and why); it is never $0.00. The price book gives the provider's own price of a task for
 * comparison.
 */
export function AiUnitCosts({ scope, projectName, engineProjectId, prices }: AiUnitCostsProps): ReactElement {
  const t = useTranslations('costs');
  const common = useTranslations('common');
  const locale = useLocale();
  const headingId = useId();
  const query = useUnitCosts(scope);
  // The engine list needs `data:read`, which a billing member has not: their rows name the engine by its code
  const canReadEngines = useCan('data:read');
  const engineName = useEngineNames(
    { workspaceId: scope.workspaceId, projectId: engineProjectId ?? '' },
    canReadEngines && engineProjectId !== undefined,
  );
  const lines = useMemo(() => unitCostRows(query.data?.data ?? []), [query.data]);
  const priceList = prices.data?.data ?? [];
  const showProject = scope.projectId === undefined;
  // With no figure on any row the table says so once, in place of a wall of n/a
  const rows = lines.some((line) => line.perAnswer !== null) ? lines : [];
  const hasRows = query.data !== undefined;
  const refetching = query.isFetching && hasRows;

  const columns: PlainColumn<UnitCostLine>[] = [
    ...(showProject
      ? [
          {
            id: 'project',
            header: t('project'),
            cell: (line) => projectName(line.projectId),
          } satisfies PlainColumn<UnitCostLine>,
        ]
      : []),
    {
      id: 'engine',
      header: t('aiAnswers.engine'),
      cell: (line) => <EngineBadge engine={line.engine} name={engineName(line.engine)} />,
    },
    {
      id: 'perAnswer',
      header: t('aiAnswers.perAnswerAndCount'),
      wrap: true,
      cell: (line) => {
        const cost = line.perAnswer === null ? null : money(line.perAnswer);
        return cost === null ? (
          <span className="inline-flex flex-wrap items-baseline gap-x-2">
            <span>{EMPTY_VALUE}</span>
            <span className="type-label">{t('aiAnswers.noAnswers')}</span>
          </span>
        ) : (
          // The count sits under the figure so a phone, which scrolls the later columns away, still shows it
          <span className="flex flex-col">
            <span>{formatUnitPrice(cost)}</span>
            {line.answers > 0 ? (
              <span className="type-meta text-foreground-secondary">
                {t('aiAnswers.answerCount', { count: line.answers })}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'price',
      header: t('aiAnswers.providerPrice'),
      description: t('aiAnswers.providerPriceHint'),
      cell: (line) => {
        const price = aiEnginePrice(priceList, line.engine);
        return price === null ? EMPTY_VALUE : formatUnitPrice(money(price));
      },
    },
  ];

  return (
    <section aria-labelledby={headingId} aria-busy={refetching} className="flex flex-col gap-2">
      <h2 id={headingId} className="type-section-title">
        {t('aiAnswers.title')}
      </h2>
      <p className="type-meta">{t('aiAnswers.note')}</p>
      {query.isError && hasRows ? (
        <div role="status" className="flex flex-wrap items-center gap-3">
          <p className="type-meta">{t('aiAnswers.stale')}</p>
          <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            {common('retry')}
          </Button>
        </div>
      ) : null}
      <div className="relative">
        <PlainTable
          caption={t('aiAnswers.title')}
          columns={columns}
          rows={rows}
          rowKey={(line) => `${line.projectId}/${line.engine}`}
          status={query.isError && !hasRows ? 'error' : query.isPending && !hasRows ? 'loading' : 'ready'}
          errorState={
            <CostsError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
          }
          emptyText={t('aiAnswers.empty', { month: monthLabel(scope.month, locale) })}
        />
        {/* After the table so it paints over the table's top edge: the static bar of a refetch with rows kept */}
        {refetching ? (
          <div
            aria-hidden="true"
            data-slot="unit-costs-refetch-bar"
            className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg bg-primary"
          />
        ) : null}
      </div>
    </section>
  );
}
