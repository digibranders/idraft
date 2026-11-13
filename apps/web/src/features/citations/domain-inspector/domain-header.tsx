'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { DomainRoleBadge } from '@/components/app/cells/domain-cell';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import type { SourceDomainRow } from '@/lib/citations/types';
import { formatRelative } from '@/lib/format';

/**
 * The badges of the domain inspector's header (WB-DOM-01): a role badge for each row the API read (a domain is a
 * row for each role and entity that cited it) and the category, which is n/a until the Sources work returns it.
 * A domain with several rows says why in a tooltip the group takes the keyboard to.
 */
export function DomainBadges({ rows }: { rows: readonly SourceDomainRow[] }): ReactElement {
  const t = useTranslations('citations.inspectors.domain');
  const roles = (
    <span
      // A tooltip on an element nothing focuses reaches no keyboard user (20 section 6.2 rule 6); the lint rule cannot see why
      {...(rows.length > 1 ? { tabIndex: 0 } : {})}
      className="inline-flex flex-wrap items-center gap-1.5 rounded-sm outline-none focus-visible:focus-ring"
    >
      {rows.map((row) => (
        <DomainRoleBadge key={`${row.domain_role}|${row.role_entity_id ?? ''}`} role={row.domain_role} />
      ))}
    </span>
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Tooltip content={t('rolesTip', { roles: rows.length })} disabled={rows.length < 2}>
        {roles}
      </Tooltip>
      <Tooltip content={t('categoryTip')}>
        <Badge variant="outline" tabIndex={0} className="outline-none focus-visible:focus-ring">
          {t('categoryNone')}
        </Badge>
      </Tooltip>
    </span>
  );
}

/** "Last cited 2d ago": the newest of the rows' last citations, in the project's zone. */
export function LastCited({
  rows,
  timeZone,
}: {
  rows: readonly SourceDomainRow[];
  timeZone: string;
}): ReactElement | null {
  const t = useTranslations('citations.inspectors.domain');
  const newest = rows.reduce<string | null>(
    (latest, row) => (latest === null || Date.parse(row.last_seen_at) > Date.parse(latest) ? row.last_seen_at : latest),
    null,
  );
  return newest === null ? null : <span>{t('lastCited', { time: formatRelative(newest, timeZone) })}</span>;
}
