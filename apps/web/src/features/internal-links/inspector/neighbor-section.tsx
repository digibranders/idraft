'use client';

import { useQuery } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { Direction } from '@/lib/internal-links/journey-layout';
import { READ_LIMIT } from '@/lib/internal-links/journey-layout';
import { neighborsQuery } from '@/lib/internal-links/queries';
import type { LinkScope } from '@/lib/internal-links/scopes';
import type { LinksScope } from '@/lib/internal-links/types';

export interface NeighborSectionProps {
  scope: LinksScope;
  urlId: string;
  direction: Direction;
  linkScope: LinkScope;
  /** The pages on this side in the scope in view, from the page read. */
  total: number;
  title: string;
  onOpen: (urlId: string) => void;
  onViewAll: () => void;
}

/** One read of `READ_LIMIT` neighbors; a failed read says so and offers Try again, so the pages before it stay. */
function NeighborRows({
  scope,
  urlId,
  direction,
  linkScope,
  offset,
  onOpen,
}: Pick<NeighborSectionProps, 'scope' | 'urlId' | 'direction' | 'linkScope' | 'onOpen'> & {
  offset: number;
}): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const common = useTranslations('common');
  const read = useQuery(neighborsQuery(scope, { urlId, direction, linkScope, offset }));
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
        </li>
      ))}
    </>
  );
}

/**
 * The linking pages or the outlinks of the open page (mock `pageList`): the neighbors read, `READ_LIMIT` (50, the
 * most the API gives for one read) at a time, with Show more while the page read says there are more, and View all in Links for the whole list.
 */
export function NeighborSection({ total, title, onViewAll, ...read }: NeighborSectionProps): ReactElement {
  const t = useTranslations('internalLinks.inspector');
  const [loaded, setLoaded] = useState(1);
  return (
    <InspectorSection title={title} icon={Link2} status="ready">
      {total === 0 ? (
        <p className="type-body text-foreground-tertiary">{t('noneInScope')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {Array.from({ length: loaded }, (_, index) => (
            <NeighborRows key={index} {...read} offset={index * READ_LIMIT} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        {loaded * READ_LIMIT < total ? (
          <Button
            variant="link"
            size="sm"
            aria-label={t('showMoreName', { title })}
            onClick={() => setLoaded((count) => count + 1)}
          >
            {t('showMore')}
          </Button>
        ) : null}
        {total > 0 ? (
          <Button variant="link" size="sm" onClick={onViewAll}>
            {t('viewAll')}
          </Button>
        ) : null}
      </div>
    </InspectorSection>
  );
}
