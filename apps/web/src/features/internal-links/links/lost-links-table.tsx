'use client';

import type { ReactElement } from 'react';

import { ChangeLinksPanel } from '../changes/change-links-panel';
import type { LinksTabContext } from '../tabs';
import { sinceText } from '@/lib/internal-links/changes-format';
import type { LinkScope } from '@/lib/internal-links/scopes';
import type { ChangeScope } from '@/lib/internal-links/types';

/** The Links scope as the changes read it: editorial stays editorial, every other scope reads all links. */
export const changesScopeOf = (scope: LinkScope): ChangeScope => (scope === 'editorial' ? 'editorial' : 'all');

/**
 * The links the crawl lost since the one before, for the Links tab: the Changes tab's lost links table, with a Lost on
 * column and no controls of its own (the Status and scope menus of the Links tab are the controls). `previousDate` is
 * the date of the earlier crawl, "none" when it has none.
 */
export function LostLinksTable({
  context,
  previousDate,
}: {
  context: LinksTabContext;
  previousDate: string;
}): ReactElement {
  return (
    <ChangeLinksPanel
      context={context}
      change="lost"
      onChange={() => undefined}
      linkScope={changesScopeOf(context.state.scope)}
      only="all"
      onOnlyChange={() => undefined}
      tiers=""
      date={previousDate}
      listOnly={{ lostOn: sinceText(context.crawl.crawl?.finished_at ?? null, context.timeZone) ?? '' }}
    />
  );
}
