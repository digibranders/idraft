'use client';

import type { Route } from 'next';
import { useCallback } from 'react';

import { drillHref, type DrillExtra, type DrillKind } from '../../drilldown/drill-links';
import { useExportBlock, type GetExportBlock } from '../../export/export-registry';
import { useOverview } from '../../overview-context';

/*
 * The two things a card takes from WP-33: the drill-down link and the export registry. A card never builds a link
 * or registers an export by hand: it goes through these two hooks, so a change of either seam is a change to this
 * file and no card.
 */

/** Where a number leads, carrying the scope of the page; `null` where there is no page for it (plain text). */
export type CardDrill = (kind: DrillKind, extra?: DrillExtra) => Route | null;

/**
 * The link of a destination with the page's scope (`drillHref`), both slugs from the page. An engine that is off in
 * the project is not in `scope.engines` unless the person chose it, so a card that links one engine's number passes
 * `extra.engine` for an engine it knows is asked.
 */
export function useCardDrill(): CardDrill {
  const { scope, workspaceSlug, project } = useOverview();
  const slug = project.slug;
  return useCallback(
    (kind, extra = {}) => drillHref(kind, scope, extra, { workspace: workspaceSlug, project: slug }),
    [scope, workspaceSlug, slug],
  );
}

/**
 * Registers the card's table with the page's export while the card is mounted. `id` is the layout ITEM id of the
 * card (`CardProps.item.id`), not its catalog key: two instances of one type must not share one id. `getBlock` is
 * read only when the Export menu runs, and returns `null` while the card has nothing to hand over.
 */
export const useCardExport = (id: string, getBlock: GetExportBlock): void => {
  useExportBlock(id, getBlock);
};
