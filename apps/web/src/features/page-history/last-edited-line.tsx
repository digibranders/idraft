'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import type { LinksScope } from '@/lib/internal-links/types';
import { usePageHistory } from './data/use-page-history';
import { lastEditedLine } from './model/page-history';

export interface LastEditedLineProps {
  scope: LinksScope;
  urlId: string;
  timeZone: string;
  /** Opens the History tab. */
  onOpen: () => void;
}

/**
 * The Overview line: "Last edited Nov 12, 2026. See history". It falls back to the last change seen, then to "No change
 * seen since" the start of the history. Nothing for a page that cannot be read, while loading, or when the read failed
 * (the History tab shows that error).
 */
export function LastEditedLine({ scope, urlId, timeZone, onOpen }: LastEditedLineProps): ReactElement | null {
  const t = useTranslations('pageHistory.line');
  const read = usePageHistory(scope, urlId);
  const line = read.data === undefined ? null : lastEditedLine(read.data.data, timeZone);
  if (line === null) return null;
  const text = { edited: 'lastEdited', changed: 'lastChange', unchanged: 'noChange' } as const;
  return (
    <p className="type-body text-foreground-secondary">
      {t(text[line.kind], { date: line.date })}{' '}
      <Button variant="link" size="sm" onClick={onOpen}>
        {t('seeHistory')}
      </Button>
    </p>
  );
}
