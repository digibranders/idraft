'use client';

import { Archive } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { EmptyState } from '@/components/app/status/empty-state';

/**
 * What a link level tab (Links, Journey) shows for a crawl past the last four, whose links are no longer stored (the
 * API answers `410 links_dropped`). A plain fact with the way out, not an error: there is nothing to try again.
 */
export function LinksDropped({
  variant = 'region',
  headingLevel = 3,
}: {
  variant?: 'region' | 'inline';
  /** 2 when nothing else on the tab is a section heading above it, so the levels never skip. */
  headingLevel?: 2 | 3;
}): ReactElement {
  const t = useTranslations('internalLinks.linksDropped');
  return (
    <EmptyState variant={variant} icon={Archive} title={t('title')} reason={t('reason')} headingLevel={headingLevel} />
  );
}
