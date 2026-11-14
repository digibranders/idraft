'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import type { SourceIdentity } from './source-model';
import { DomainRoleBadge } from '@/components/app/cells/domain-cell';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { displayUrl, formatRelative, formatTableDate } from '@/lib/format';

/**
 * The title of the header: the page's title when an answer gave it one, else its path (the host when the address
 * is the site itself), else "Untitled page". Provider text, so it only ever goes out as a string React escapes.
 */
export function sourceTitle(identity: SourceIdentity, untitled: string): string {
  if (identity.title !== null && identity.title.trim() !== '') return identity.title;
  const address = displayUrl(identity.url);
  return address.valid ? address.path || address.host : untitled;
}

/**
 * The badges of the header (WB-SRC-01): the role the page's domain was cited in, the host as text (the title does
 * not say it), and the category, which is n/a until the Sources work returns it.
 */
export function SourceBadges({ identity }: { identity: SourceIdentity }): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <DomainRoleBadge role={identity.role} />
      <span className="type-meta text-foreground-secondary">
        <bdi>{identity.host}</bdi>
      </span>
      <Tooltip content={t('categoryTip')}>
        <Badge variant="outline" tabIndex={0} className="outline-none focus-visible:focus-ring">
          {t('categoryNone')}
        </Badge>
      </Tooltip>
    </span>
  );
}

/** "First cited Oct 20" (when the page's row says it) and "Last cited 2d ago", in the project's zone. */
export function SourceDates({
  identity,
  firstSeenAt,
  timeZone,
}: {
  identity: SourceIdentity;
  /** From the page's row; `null` while that read has nothing: the date is left out, never guessed. */
  firstSeenAt: string | null;
  timeZone: string;
}): ReactElement {
  const t = useTranslations('citations.inspectors.source');
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      {firstSeenAt === null ? null : <span>{t('firstSeen', { date: formatTableDate(firstSeenAt, timeZone) })}</span>}
      <span>{t('lastCited', { time: formatRelative(identity.lastCitedAt, timeZone) })}</span>
    </span>
  );
}
