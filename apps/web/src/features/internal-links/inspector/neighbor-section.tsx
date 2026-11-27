'use client';

import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TextLink } from '@/components/ui/text-link';
import type { Direction } from '@/lib/internal-links/journey-layout';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import { READ_LIMIT } from '@/lib/internal-links/journey-layout';
import { neighborsQuery } from '@/lib/internal-links/queries';
import { otherHost } from '@/lib/internal-links/redirect-rows';
import type { LinkScope } from '@/lib/internal-links/scopes';
import type { LinksScope } from '@/lib/internal-links/types';

export interface NeighborSectionProps {
  scope: LinksScope;
  urlId: string;
  direction: Direction;
  linkScope: LinkScope;
  /** The site's host: a neighbor on another host (the www form) names it. */
  host: string;
  /** The crawl read: `null` for the latest. */
  run: string | null;
  /** False for a crawl whose links are no longer stored: no neighbors are read. */
  linksAvailable: boolean;
  /** The pages on this side in the scope in view, from the page read. */
  total: number;
  title: string;
  onOpen: (urlId: string) => void;
  /** Where View all in Links goes: a link that carries the crawl and the scope. */
  viewAllHref: Route;
}

/** One read of `READ_LIMIT` neighbors; a failed read says so and offers Try again, so the pages before it stay. */
function NeighborRows({
  scope,
  urlId,
  direction,
  linkScope,
  host,
  run,
  offset,
  onOpen,
}: Pick<NeighborSectionProps, 'scope' | 'urlId' | 'direction' | 'linkScope' | 'host' | 'run' | 'onOpen'> & {
  offset: number;
}): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const dropped = useTranslations('internalLinks.linksDropped');
  const common = useTranslations('common');
  const read = useQuery(neighborsQuery(scope, { urlId, direction, linkScope, offset }, run));
  if (isLinksDropped(read.error)) {
    // Nothing to try again: the crawl no longer holds its links
    return <li className="type-meta text-foreground-secondary">{dropped('reason')}</li>;
  }
  if (read.isError) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-2">
        <span className="type-meta text-foreground-secondary">{t(offset === 0 ? 'listFailed' : 'moreFailed')}</span>
        <Button variant="link" size="sm" onClick={() => void read.refetch()}>
          {common('retry')}
        </Button>
      </li>
    );
  }
  if (read.data === undefined) {
    return (
      <li aria-hidden="true">
        <Skeleton shape="text-13" widthPct={64} />
      </li>
    );
  }
  return (
    <>
      {read.data.data.map((item) => (
        <li key={item.url_id} className="flex min-w-0 items-center gap-2">
          <TierBadge tier={item.tier} />
          <button
            type="button"
            className="min-w-0 truncate text-left type-table text-link hover:underline focus-visible:focus-ring"
            onClick={() => onOpen(item.url_id)}
          >
            {item.path}
          </button>
          {/* A redirect or the www form shares its path with a real page, so it says what it is */}
          {otherHost(item.url, host) === null ? null : (
            <span className="shrink-0 type-meta text-foreground-secondary">{otherHost(item.url, host)}</span>
          )}
          {item.status_code !== null && item.status_code >= 300 && item.status_code < 400 ? (
            <Badge className="shrink-0">{t('redirectBadge')}</Badge>
          ) : null}
        </li>
      ))}
    </>
  );
}

/**
 * The linking pages or the outlinks of the open page (mock `pageList`): the neighbors read, `READ_LIMIT` (50, the
 * most the API gives for one read) at a time, with Show more while the page read says there are more, and View all in Links for the whole list.
 */
export function NeighborSection({
  total,
  title,
  viewAllHref,
  linksAvailable,
  ...read
}: NeighborSectionProps): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const dropped = useTranslations('internalLinks.linksDropped');
  const [loaded, setLoaded] = useState(1);
  return (
    <InspectorSection title={title} icon={Link2} status="ready">
      {!linksAvailable ? (
        // No read is made for a crawl whose links are gone
        <p className="type-body text-foreground-tertiary">{dropped('reason')}</p>
      ) : total === 0 ? (
        <p className="type-body text-foreground-tertiary">{t('noneInScope')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {Array.from({ length: loaded }, (_, index) => (
            <NeighborRows key={index} {...read} offset={index * READ_LIMIT} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {linksAvailable && loaded * READ_LIMIT < total ? (
          <Button
            variant="link"
            size="sm"
            aria-label={t('showMoreName', { title })}
            onClick={() => setLoaded((count) => count + 1)}
          >
            {t('showMore')}
          </Button>
        ) : null}
        {linksAvailable && total > 0 ? <TextLink render={<Link href={viewAllHref} />}>{t('viewAll')}</TextLink> : null}
      </div>
    </InspectorSection>
  );
}
