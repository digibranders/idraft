'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { trackedSetNote } from '../model/tracked-set';
import type { TrackedSet } from '../model/types';
import { formatBusinessDate, formatList } from '@/lib/format';

export interface TrackedFootnoteProps {
  set: TrackedSet;
}

/**
 * The footnote of every share of voice chart (R9, D-9): who the shares are over ("you and 5 competitors"), and
 * when the set changed inside the window, which competitors were added and on which day. It never invents a date:
 * a change with no known day says only that the set changed.
 */
export function TrackedFootnote({ set }: TrackedFootnoteProps): ReactElement {
  const t = useTranslations('aiOverview.competitors.common');
  const note = trackedSetNote(set);
  const added = note.added.map((entry) =>
    t('footnoteAddedItem', { name: entry.name, date: formatBusinessDate(entry.addedOn, { withYear: false }) }),
  );
  return (
    <p data-testid="tracked-footnote">
      {t('footnoteSet', { competitors: note.competitors })}
      {added.length > 0 ? ` ${t('footnoteAdded', { list: formatList(added) })}` : null}
      {added.length === 0 && note.changed ? ` ${t('footnoteChanged')}` : null}
    </p>
  );
}
