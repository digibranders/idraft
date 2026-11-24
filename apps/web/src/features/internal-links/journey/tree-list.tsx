'use client';

import { ChevronDown, ChevronRight, Crosshair, PanelRightOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, type KeyboardEvent, type ReactElement } from 'react';

import { useNeighborLookup } from './use-neighbor-lookup';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '../status-badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { TextLink } from '@/components/ui/text-link';
import { formatInteger } from '@/lib/format';
import { buildTree, type Direction, type TreeRow } from '@/lib/internal-links/journey-layout';
import { PLACEMENT_KEY, type LinkScope, type Placement } from '@/lib/internal-links/scopes';
import type { LinksScope, Neighbor, PageRow } from '@/lib/internal-links/types';
import { cn } from '@/lib/utils';

const CELL = 'px-3 align-middle';
const TREE_COLUMNS = ['page', 'tier', 'anchor', 'type', 'linking', 'status'] as const;
/** Indent per level (mock: 20 px); a style, since it multiplies with the level. */
const INDENT = 20;

/**
 * The tree list (spec 7.5, decision W3): the canvas's text alternative and the better view for anchors. One
 * direction at a time; back links and pages listed higher are muted rows that do not open. Each row names its level
 * for a screen reader, and a disclosure button opens it (Right Arrow) or closes it (Left Arrow).
 */
export function TreeList({
  scope,
  run,
  focus,
  linkScope,
  dir,
  open,
  onToggle,
  onRefocus,
  onDetails,
  onOrder,
  linksHref,
}: {
  scope: LinksScope;
  /** The crawl the lists are read from: `null` for the latest. */
  run: string | null;
  focus: PageRow;
  linkScope: LinkScope;
  dir: Direction;
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onRefocus: (urlId: string) => void;
  onDetails: (urlId: string) => void;
  /** Tells the inspector which pages the list shows, in order, so it can step through them. */
  onOrder: (urlIds: readonly string[]) => void;
  /** The Links tab for the links of one page in the direction followed: where a "more" row sends the person. */
  linksHref: (urlId: string) => Route;
}): ReactElement {
  const t = useTranslations('internalLinks.journey');
  const words = useTranslations('internalLinks');
  const bothWays = useTranslations('linkCanvas')('bothWaysIcon');
  const { lookup, useLoad, retry } = useNeighborLookup(scope, run);
  const tree = buildTree<Neighbor>({ focus: focus.url_id, dir, scope: linkScope, open }, lookup);
  useLoad(tree.requests);
  const placementLabel = (placement: Placement): string => words(`placement.${PLACEMENT_KEY[placement]}`);

  const onKey = (event: KeyboardEvent<HTMLButtonElement>, row: Extract<TreeRow<Neighbor>, { kind: 'page' }>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    if ((event.key === 'ArrowRight') === row.open) return;
    event.preventDefault();
    onToggle(row.key);
  };

  // A "more" row's key is its parent row's key and `.more`; a row key ends in the url id of its page (`t` is the focus)
  const parentOf = (key: string): string => {
    const id = key.split('.').at(-2);
    return id === undefined || id === 't' ? focus.url_id : id;
  };
  const indent = (level: number) => ({ paddingInlineStart: level * INDENT });

  // The inspector steps through the pages of the list, as the rows read
  const order = [...new Set(tree.rows.flatMap((row) => (row.kind === 'page' ? [row.urlId] : [])))];
  const orderText = order.join(',');
  useEffect(() => {
    onOrder(orderText === '' ? [] : orderText.split(','));
    return () => onOrder([]);
  }, [orderText, onOrder]);
  const levelText = (level: number): ReactElement => <span className="sr-only">{t('level', { level })}</span>;

  const renderRow = (row: TreeRow<Neighbor>): ReactElement => {
    if (row.kind === 'loading') {
      return (
        <tr key={row.key} className="h-row-compact border-b border-border-subtle" aria-busy="true">
          <th scope="row" className={cn(CELL, 'text-left')} colSpan={TREE_COLUMNS.length}>
            <div className="flex items-center gap-1.5" style={indent(row.level)}>
              {levelText(row.level)}
              <span className="size-6 shrink-0" />
              <span className="type-table text-foreground-tertiary">{t('loadingRows')}</span>
            </div>
          </th>
        </tr>
      );
    }
    if (row.kind === 'failed') {
      return (
        <tr key={row.key} className="h-row-compact border-b border-border-subtle">
          <th scope="row" className={cn(CELL, 'text-left')} colSpan={TREE_COLUMNS.length}>
            <div className="flex items-center gap-2" style={indent(row.level)}>
              {levelText(row.level)}
              <span className="size-6 shrink-0" />
              <span className="type-table text-foreground-secondary">{t('rowFailed')}</span>
              <Button variant="secondary" size="sm" onClick={() => retry(row.request)}>
                {t('retry')}
              </Button>
            </div>
          </th>
        </tr>
      );
    }
    if (row.kind === 'more') {
      return (
        <tr key={row.key} className="h-row-compact border-b border-border-subtle">
          <th scope="row" className={cn(CELL, 'text-left')} colSpan={TREE_COLUMNS.length}>
            <div className="flex items-center gap-1.5" style={indent(row.level)}>
              {levelText(row.level)}
              <span className="size-6 shrink-0" />
              <span className="type-table text-foreground-tertiary">{t('moreRows', { count: row.count })}</span>
              <TextLink render={<Link href={linksHref(parentOf(row.key))} />}>{t('seeInLinks')}</TextLink>
            </div>
          </th>
        </tr>
      );
    }

    const node = row.node;
    const path = node === null ? focus.path : node.path;
    const muted = row.kind !== 'page';
    let label = path;
    if (row.kind === 'back') label = t(dir === 'out' ? 'backOut' : 'backIn', { path, step: row.step });
    else if (row.kind === 'listed') label = t('listed', { path });
    const status = node === null ? focus.status_code : node.status_code;
    const tier = node === null ? focus.tier : node.tier;
    const linking = node === null ? focus.linking_pages : node.linking_pages;
    return (
      <tr key={row.key} className="group h-row-compact border-b border-border-subtle hover:bg-surface-hover">
        <th scope="row" className={cn(CELL, 'min-w-72 text-left')}>
          <div className="flex items-center gap-1.5" style={indent(row.level)}>
            {levelText(row.level)}
            {row.kind === 'page' && row.level > 0 && row.canOpen ? (
              <button
                type="button"
                aria-expanded={row.open}
                aria-label={t(row.open ? 'collapse' : 'expand', { path })}
                onClick={() => onToggle(row.key)}
                onKeyDown={(event) => onKey(event, row)}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-foreground-tertiary hover:bg-surface-selected hover:text-foreground focus-visible:focus-ring"
              >
                <Icon icon={row.open ? ChevronDown : ChevronRight} size="sm" />
              </button>
            ) : (
              <span className="size-6 shrink-0" />
            )}
            <span className={cn('truncate type-table', muted ? 'text-foreground-tertiary' : 'text-foreground')}>
              {label}
            </span>
            {row.kind === 'page' && row.bothWays ? <Badge tone="info">{bothWays}</Badge> : null}
            {row.kind === 'page' ? (
              <span className="ml-auto flex shrink-0 gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                {row.level > 0 ? (
                  <IconButton
                    icon={Crosshair}
                    size="icon-xs"
                    variant="secondary"
                    label={t('makeFocus', { path })}
                    onClick={() => onRefocus(row.urlId)}
                  />
                ) : null}
                <IconButton
                  icon={PanelRightOpen}
                  size="icon-xs"
                  variant="secondary"
                  label={t('details', { path })}
                  onClick={() => onDetails(row.urlId)}
                />
              </span>
            ) : null}
          </div>
        </th>
        <td className={CELL}>{muted ? null : <TierBadge tier={tier} />}</td>
        <td className={cn(CELL, 'type-table', muted ? 'text-foreground-tertiary' : 'text-foreground-secondary')}>
          {node === null ? t('focusRow') : node.anchor === null ? '' : t('anchor', { anchor: node.anchor })}
        </td>
        <td className={cn(CELL, 'type-table text-foreground-secondary')}>
          {node === null || node.placement === null ? '' : placementLabel(node.placement)}
        </td>
        <td className={cn(CELL, 'text-right num type-table text-foreground-secondary')}>
          {muted ? '' : formatInteger(linking)}
        </td>
        <td className={CELL}>
          {muted || status === null ? null : status === 200 ? (
            <span className="num type-table text-foreground-secondary">200</span>
          ) : (
            <StatusBadge status={status} />
          )}
        </td>
      </tr>
    );
  };

  const empty = tree.rows.length === 1 && !tree.pending;
  return (
    <div className="overflow-x-auto">
      <table aria-label={t('treeCaption')} className="w-full border-collapse">
        <thead>
          <tr className="h-row-header">
            {TREE_COLUMNS.map((key) => (
              <th
                key={key}
                scope="col"
                className={cn(
                  'sticky top-0 z-(--z-table-header) border-b border-border bg-surface-subtle text-left type-table-header text-foreground-secondary',
                  CELL,
                  key === 'linking' && 'text-right',
                )}
              >
                {t(`treeColumns.${key}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tree.rows.map(renderRow)}
          {empty ? (
            <tr>
              <td colSpan={TREE_COLUMNS.length} className="px-3 py-6 type-body text-foreground-secondary">
                {t(dir === 'out' ? 'treeEmptyOut' : 'treeEmptyIn')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
