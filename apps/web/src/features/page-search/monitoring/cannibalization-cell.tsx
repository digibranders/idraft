'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { cannibalizationParts } from './monitoring-rows';
import type { PageCannibalization } from '../types';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

/** The tooltip of a part of a cell is a tab stop that opens it (20 section 6.2 rule 6). */
const TAB_STOP = { tabIndex: 0 } as const;

export interface CannibalizationCellProps {
  /** `null`: the API has no value for the page; the column is not drawn then, and the cell draws nothing. */
  value: PageCannibalization | null;
  path: string;
  /** The project's Cannibalization page; `null` while the app has no such route, and the badge is then plain text. */
  href: Route | null;
}

/** How many tracked keywords the page competes on with another page of the site (spec D22). */
export function CannibalizationCell({ value, path, href }: CannibalizationCellProps): ReactElement | null {
  const t = useTranslations('monitoring.cannibalization');
  const router = useRouter();
  if (value === null) return null;
  if (value.keywords === 0) return <span className="type-table text-foreground-tertiary">{t('none')}</span>;
  const badge = (
    <Badge tone={value.likely > 0 ? 'warning' : 'neutral'}>{t('keywords', { count: value.keywords })}</Badge>
  );
  const parts = cannibalizationParts(value)
    .map(([count, kind]) => t(kind, { count }))
    .join(', ');
  if (href === null) {
    return (
      <Tooltip content={t('tipPlain', { count: value.keywords, parts })}>
        <span {...TAB_STOP} className="rounded-sm outline-none focus-visible:focus-ring">
          {badge}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={t('tip', { count: value.keywords, parts })}>
      <button
        {...CELL_CONTROL}
        type="button"
        aria-label={t('label', { path, count: value.keywords })}
        className="rounded-sm outline-none focus-visible:focus-ring"
        onClick={(event) => {
          // The row opens the page's detail; this goes to Cannibalization instead
          event.stopPropagation();
          router.push(href);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
      >
        {badge}
      </button>
    </Tooltip>
  );
}
