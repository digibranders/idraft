'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { ListPopover, ListRow } from './list-popover';
import { MarkedList, PresenceMark } from './presence-mark';
import type { LinksReading } from '../facts';
import { Badge } from '@/components/ui/badge';
import { Truncate } from '@/components/ui/truncate';
import { displayUrl, formatSampleCount } from '@/lib/format';

export interface LinksCellProps {
  /** `citedLinksOf(rows, code)`: the cell draws a reading that has pages, the column words one that has not. */
  reading: LinksReading;
  /** The own site is among the pages the answers cited (all of them, not only the ten the list shows). */
  ownCited: boolean;
  /** What the list is about: "This prompt". */
  label: string;
}

/**
 * The Cited pages cell of one platform: a green check or a grey dash for the own site, the most cited page as text with
 * "+N" for the others, and the list of the top ten with how many of the answers cited each. A page counts once per answer.
 */
export function LinksCell({ reading, ownCited, label }: LinksCellProps): ReactElement | null {
  const t = useTranslations('prompts.lists');
  const [open, setOpen] = useState(false);
  const [first] = reading.shown;
  if (reading.state !== 'ok' || first === undefined) return null;
  return (
    <MarkedList mark={<PresenceMark present={ownCited} yes={t('links.ownPresent')} no={t('links.ownAbsent')} />}>
      <ListPopover
        open={open}
        onOpenChange={setOpen}
        label={t('links.openLabel', { label, count: reading.total })}
        title={t('links.title')}
        subtitle={t('links.subtitle', { label, answers: t('answers', { count: reading.answers }) })}
        note={t('links.note')}
        trigger={
          <>
            <span className="truncate">{displayUrl(first.url).display}</span>
            {reading.total > 1 ? (
              <span className="shrink-0 type-label text-foreground-tertiary">+{reading.total - 1}</span>
            ) : null}
          </>
        }
      >
        {reading.shown.map((link) => (
          <ListRow
            key={link.url}
            place={link.place}
            own={link.own}
            main={
              <span className="flex min-w-0 items-center gap-2">
                <Truncate
                  text={link.url}
                  display={displayUrl(link.url).display}
                  className="type-body text-foreground"
                />
                {link.own ? <Badge className="shrink-0">{t('links.yourSite')}</Badge> : null}
              </span>
            }
            value={
              <span className="num type-meta whitespace-nowrap">
                {formatSampleCount(link.answers, reading.answers)}
              </span>
            }
          />
        ))}
      </ListPopover>
    </MarkedList>
  );
}
