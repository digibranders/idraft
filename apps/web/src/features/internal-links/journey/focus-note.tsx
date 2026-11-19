'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { LinkScope } from '@/lib/internal-links/scopes';
import type { PageRow } from '@/lib/internal-links/types';

/** The lines under the focus card (mock `focusNote`), without the route from home (slice 2). */
export function FocusNote({ page, scope }: { page: PageRow; scope: LinkScope }): ReactElement | null {
  const t = useTranslations('internalLinks.journey');
  const lines: string[] = [];
  const status = page.status_code ?? 0;
  if (status === 200 && scope === 'editorial') lines.push(t('editorialIn', { count: page.linking_pages }));
  if (status >= 400) lines.push(t('notFoundNote'));
  else if (status >= 300) lines.push(t('redirectNote'));
  if (page.flags.includes('orphan')) lines.push(t('orphanNote'));
  else if (page.flags.includes('editorial_orphan')) {
    lines.push(t(scope === 'editorial' ? 'editorialOrphanFull' : 'editorialOrphanNote'));
  } else if (page.outlinks_all === 0 && status < 400) lines.push(t('noOutlinksNote'));
  if (lines.length === 0) return null;
  return <p className="max-w-64 type-meta text-foreground-tertiary">{lines.join(' ')}</p>;
}
