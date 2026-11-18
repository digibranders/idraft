'use client';

import { useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, type ReactElement } from 'react';

import { SkeletonRows } from '../crawl-states';
import { UNTIERED_VALUE } from '../pages/page-filters';
import { ScopeMenu } from '../scope-menu';
import type { LinksTabContext } from '../tabs';
import { SEQUENTIAL_BINS } from '@/components/app/chart/heat-bins';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { csvBlob, downloadBlob, safeText } from '@/lib/csv/csv-write';
import { formatDecimal, formatInteger, formatPercent } from '@/lib/format';
import { flowLevel, strongestSenderToT1, tierShares } from '@/lib/internal-links/flow';
import { tierFlowQuery } from '@/lib/internal-links/queries';
import { SCOPE_KEY } from '@/lib/internal-links/scopes';
import { tierLabel, tierPosition } from '@/lib/internal-links/tiers';
import type { TierRef } from '@/lib/internal-links/types';
import { withQuery, workspaceSettingsPath } from '@/lib/routes/paths';
import { cn } from '@/lib/utils';

const CELL = 'px-3';
const HEAD = 'h-row-header border-b border-border bg-surface-subtle type-table-header text-foreground-tertiary';
const keyOf = (tier: TierRef | null): string => tier?.tier_id ?? UNTIERED_VALUE;
const pairKey = (from: TierRef | null, to: TierRef | null): string => `${keyOf(from)}>${keyOf(to)}`;

/**
 * The Tier flow tab (spec 7.6, mock `il-flow.js`): pages per tier with their share and average depth, the sentence
 * about what reaches T1, and the matrix of unique links from tier to tier in the scope in view. A cell opens the
 * Links tab on that pair. The response carries an equity share per tier; it is never read here (decision W4).
 */
export function FlowTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.flow');
  const untiered = useTranslations('internalLinks.filters')('untiered');
  const scopeWords = useTranslations('linkCanvas.scope');
  const common = useTranslations('common');
  const { scope, state, setSearch, registerExport } = context;
  // No placeholder data: the answer of one scope is never shown under the name of another
  const read = useQuery(tierFlowQuery(scope, state.scope, context.crawl.run));
  const answer = read.data?.data;
  const flow = answer?.scope === state.scope ? answer : undefined;
  const scopeWord = scopeWords(SCOPE_KEY[state.scope]);
  const label = useMemo(
    () =>
      (tier: TierRef | null): string =>
        tierLabel(tier, untiered),
    [untiered],
  );

  const tiers = useMemo(
    () => (flow === undefined ? [] : [...flow.tiers].sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier))),
    [flow],
  );
  const keys = useMemo(() => tiers.map((stat) => stat.tier), [tiers]);
  const cells = useMemo(() => {
    // A pair named twice adds up
    const sums = new Map<string, number>();
    for (const cell of flow?.cells ?? []) {
      const key = pairKey(cell.from_tier, cell.to_tier);
      sums.set(key, (sums.get(key) ?? 0) + cell.links);
    }
    return sums;
  }, [flow]);
  const valueOf = (from: TierRef | null, to: TierRef | null): number => cells.get(pairKey(from, to)) ?? 0;

  // The page's Export downloads this matrix (a header, one line per tier, the row total last)
  useEffect(() => {
    if (flow === undefined) {
      registerExport(null);
      return undefined;
    }
    registerExport(() => {
      const header = [t('from'), ...keys.map((tier) => t('toTier', { tier: label(tier) })), t('total')];
      const rows = keys.map((from) => {
        const values = keys.map((to) => cells.get(pairKey(from, to)) ?? 0);
        return [safeText(label(from)), ...values, values.reduce((sum, value) => sum + value, 0)];
      });
      downloadBlob(csvBlob({ header, rows }), `internal-links-tier-flow-${flow.scope}.csv`);
      return Promise.resolve();
    });
    return () => registerExport(null);
  }, [registerExport, flow, keys, cells, label, t]);

  if (read.isError && answer === undefined) {
    return (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void read.refetch()}
        retrying={read.isFetching}
        retryLabel={common('retry')}
      />
    );
  }
  if (flow === undefined) return <SkeletonRows />;

  // No tiers, or none of the pages in one: the matrix would be a grid of zeros with nothing to compare
  const named = tiers.filter((stat) => stat.tier !== null);
  const tiered = named.reduce((sum, stat) => sum + stat.pages, 0);
  if (named.length === 0 || tiered === 0) {
    return (
      <EmptyState
        title={t(named.length === 0 ? 'noTiersTitle' : 'noTieredTitle')}
        reason={t(named.length === 0 ? 'noTiersReason' : 'noTieredReason')}
        headingLevel={3}
        primaryAction={
          // Page tiers settings: the route exists once the settings task of plan 03 is built
          <LinkButton
            variant="secondary"
            size="sm"
            render={<Link href={workspaceSettingsPath(context.workspaceSlug, 'tiers')} />}
          >
            {t('editTiers')}
          </LinkButton>
        }
      />
    );
  }

  const shares = tierShares(tiers);
  const strongest = strongestSenderToT1(flow.cells);
  const max = Math.max(0, ...cells.values());
  const base = context.hrefOf('/seo/internal-links');
  const pairHref = (from: TierRef | null, to: TierRef | null): Route =>
    withQuery(
      base,
      new URLSearchParams({
        tab: 'links',
        ...(state.scope === 'editorial' ? {} : { scope: state.scope }),
        stier: keyOf(from),
        ttier: keyOf(to),
      }).toString(),
    );

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t('stripLabel')} className="flex flex-wrap rounded-lg border border-border bg-surface">
        {shares.rows.map((row) => (
          <li
            key={keyOf(row.tier)}
            className="flex min-w-48 flex-1 flex-col gap-1.5 border-r border-border-subtle px-4 py-3 last:border-r-0"
          >
            <TierBadge tier={row.tier} className="self-start" />
            <p className="num type-body-strong text-foreground">{t('pages', { count: row.pages })}</p>
            <p className="num type-meta text-foreground-secondary">
              {row.average_depth === null
                ? t('shareNoDepth', { share: formatPercent(row.share) })
                : t('share', { share: formatPercent(row.share), depth: formatDecimal(row.average_depth, 1) })}
            </p>
          </li>
        ))}
      </ul>
      {strongest === null ? null : (
        <p className="type-body text-foreground">
          {strongest.links === 0
            ? t('sentenceNone', { to: strongest.top.code, scope: scopeWord })
            : t('sentence', {
                from: strongest.from === null ? t('untieredPages') : `${strongest.from.name} (${strongest.from.code})`,
                count: strongest.links,
                scope: scopeWord,
                to: strongest.top.code,
              })}
        </p>
      )}
      {flow.stale ? <Banner tone="info" placement="region" message={t('stale')} /> : null}
      {read.isError ? (
        <Banner
          tone="warning"
          placement="region"
          live
          message={t('refreshFailed')}
          actions={
            <Button variant="secondary" size="sm" loading={read.isFetching} onClick={() => void read.refetch()}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
      <section className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          <ScopeMenu
            scope={state.scope}
            onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })}
          />
          <span className="type-meta text-foreground-tertiary">{t('rowsToColumns')}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">{t('caption')}</caption>
            <thead>
              <tr>
                <th scope="col" className={cn(CELL, HEAD, 'text-left')}>
                  {t('from')}
                </th>
                {keys.map((tier) => (
                  <th key={keyOf(tier)} scope="col" className={cn(CELL, HEAD, 'text-right')}>
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {t('to')} <TierBadge tier={tier} />
                    </span>
                  </th>
                ))}
                <th scope="col" className={cn(CELL, HEAD, 'text-right')}>
                  {t('total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((from) => (
                <tr key={keyOf(from)}>
                  <th scope="row" className={cn(CELL, 'border-r border-b border-border-subtle text-left font-normal')}>
                    <TierBadge tier={from} withName />
                  </th>
                  {keys.map((to) => {
                    const value = valueOf(from, to);
                    const level = flowLevel(value, max);
                    const bin = level === null ? undefined : SEQUENTIAL_BINS[level];
                    const words = { count: value, scope: scopeWord, from: label(from), to: label(to) };
                    // A cell with no links has nothing to show in the Links tab: it is text, not a link
                    return (
                      <td key={keyOf(to)} className="border-b border-border-subtle p-0 text-right">
                        {bin === undefined ? (
                          <span className="block h-row px-3 py-2 num type-table text-foreground-tertiary">
                            <span aria-hidden="true">{formatInteger(value)}</span>
                            <span className="sr-only">{t('cellNone', words)}</span>
                          </span>
                        ) : (
                          <Link
                            href={pairHref(from, to)}
                            aria-label={t('cellName', words)}
                            className={cn(
                              'block h-row px-3 py-2 num type-table focus-visible:focus-ring-inset',
                              bin.fill,
                              bin.text,
                            )}
                          >
                            {formatInteger(value)}
                          </Link>
                        )}
                      </td>
                    );
                  })}
                  <td className={cn(CELL, 'border-b border-border-subtle text-right num type-table text-foreground')}>
                    {formatInteger(keys.reduce((sum, to) => sum + valueOf(from, to), 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
