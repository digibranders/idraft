'use client';

import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';

import { MentionText } from './mention-text';
import type { LinksTranslate } from '../tabs';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Truncate } from '@/components/ui/truncate';
import type { Opportunity, OpportunityStatus } from '@/lib/internal-links/types';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

type Column = DataTableColumn<Opportunity>;

/** The decision controls of a row: Accept and Dismiss while it is open, Undo once it is decided. */
export interface OpportunityActions {
  /** False for a viewer and for an older crawl: the row shows Copy only. */
  canDecide: boolean;
  /** A decision is in flight. */
  pending: boolean;
  onDecide: (row: Opportunity, status: OpportunityStatus) => void;
  onCopy: (row: Opportunity) => void;
  onOpenPage: (urlId: string) => void;
}

type OpportunityWord =
  | 'accept'
  | 'dismiss'
  | 'undo'
  | 'columns.source'
  | 'columns.sourceTier'
  | 'columns.mentions'
  | 'columns.target'
  | 'columns.targetTier'
  | 'columns.anchor'
  | 'columns.statusHeader'
  | 'columns.actions';

const STATUS_TONE = { open: 'neutral', accepted: 'positive', dismissed: 'neutral' } as const;

/** A column whose cell this screen draws, with the type's width rules. */
const custom = (
  id: string,
  type: Column['type'],
  header: string,
  cell: (row: Opportunity) => ReactNode,
  extra: Partial<Column> = {},
): Column => ({ id, type, header, cell, priority: 1, defaultVisible: true, ...extra });

/**
 * The Opportunities columns (mock `il-opps.js` `COLUMNS`): source page and tier, the mention in its sentence, target
 * page and tier, the suggested anchor, the status and the actions. The source page's equity share is in the payload
 * and is not a column.
 */
export function opportunityColumns(t: LinksTranslate, actions: OpportunityActions): Column[] {
  const o = (key: OpportunityWord): string => t(`opportunities.${key}`);
  const names = (row: Opportunity): { from: string; to: string } => ({ from: row.source.path, to: row.target.path });
  const decision = (
    row: Opportunity,
    status: OpportunityStatus,
    label: 'accept' | 'dismiss' | 'undo',
    first: boolean,
  ): ReactNode => (
    <Button
      {...CELL_CONTROL}
      {...(first ? { 'data-decision': row.key } : {})}
      variant="secondary"
      size="sm"
      disabled={actions.pending}
      aria-label={t(`opportunities.${label}Named`, names(row))}
      onClick={(event) => {
        event.stopPropagation();
        actions.onDecide(row, status);
      }}
    >
      {o(label)}
    </Button>
  );
  return [
    col.keyword<Opportunity>('source', (row) => row.source.path, {
      header: o('columns.source'),
      width: 240,
      sortable: false,
    }),
    custom('sourceTier', 'badge', o('columns.sourceTier'), (row) => <TierBadge tier={row.source.tier} />, {
      width: 96,
    }),
    custom(
      'mentions',
      'url',
      o('columns.mentions'),
      (row) => <MentionText context={row.context} phrase={row.phrase} className="truncate" />,
      { width: 380, minWidth: 240, cellTip: (row) => ({ content: row.context }) },
    ),
    custom(
      'target',
      'url',
      o('columns.target'),
      (row) => (
        <button
          {...CELL_CONTROL}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            actions.onOpenPage(row.target.url_id);
          }}
          className="block max-w-full min-w-0 rounded-sm text-left outline-none hover:underline focus-visible:focus-ring"
        >
          <Truncate text={row.target.path} className="type-table text-foreground" />
        </button>
      ),
      { width: 240, hasControls: true, cellLabel: (row) => row.target.path },
    ),
    custom('targetTier', 'badge', o('columns.targetTier'), (row) => <TierBadge tier={row.target.tier} />, {
      width: 96,
    }),
    custom(
      'anchor',
      'text',
      o('columns.anchor'),
      (row) => (
        <Truncate text={t('changes.anchorQuoted', { anchor: row.anchor })} className="type-table text-foreground" />
      ),
      { width: 200 },
    ),
    custom(
      'status',
      'status',
      o('columns.statusHeader'),
      (row) => <Badge tone={STATUS_TONE[row.status]}>{t(`opportunities.status.${row.status}`)}</Badge>,
      { width: 112 },
    ),
    custom(
      'actions',
      'text',
      o('columns.actions'),
      (row) => (
        <span className="flex items-center gap-2">
          {actions.canDecide ? (
            row.status === 'open' ? (
              <>
                {decision(row, 'accepted', 'accept', true)}
                {decision(row, 'dismissed', 'dismiss', false)}
              </>
            ) : (
              decision(row, 'open', 'undo', true)
            )
          ) : null}
          <IconButton
            {...CELL_CONTROL}
            icon={Copy}
            size="icon-xs"
            label={t('opportunities.copy', names(row))}
            onClick={(event) => {
              event.stopPropagation();
              actions.onCopy(row);
            }}
          />
        </span>
      ),
      { width: 232, hasControls: true, cellLabel: (row) => `${row.source.path} ${row.target.path}` },
    ),
  ];
}
