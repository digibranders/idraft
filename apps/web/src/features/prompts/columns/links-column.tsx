import type { ReactElement } from 'react';

import { citedLinksOf, type FactsRow, type LinksReading } from '../facts';
import { engineOf } from '../facts/engine-rows';
import { LinksCell } from '../lists/links-cell';
import { PlatformMark } from '../platform-mark';
import type { Translate } from '../seams/shared';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE } from '@/lib/format';

/** The column's width in the preview: a page address and "+3" with the mark before them. */
export const LINKS_WIDTH = 344;

export interface LinksColumnOptions<TRow> {
  id?: string;
  /** The row's own summary row; `undefined` when the summary has none for it (with `loaded` it has no answers). */
  rowOf: (row: TRow) => FactsRow | undefined;
  labelOf: (row: TRow) => string;
  loaded: boolean;
  /** The one platform in view: the column exists only for one. */
  code: string;
  t: Translate;
}

interface Words {
  text: string;
  tip: string;
}

/** The cell of a row that has no list: `n/a` with its reason, or `None` when the answers cited no page. */
function wordsOf(reading: LinksReading, t: Translate): Words | undefined {
  if (reading.state === 'ok') {
    return reading.shown.length > 0
      ? undefined
      : { text: t('prompts.lists.links.none'), tip: t('prompts.lists.links.noneTip', { count: reading.answers }) };
  }
  return {
    text: EMPTY_VALUE,
    tip: t(reading.reason === 'not_collected' ? 'prompts.lists.notCollectedTip' : 'prompts.lists.noAnswersTip'),
  };
}

/**
 * The Cited pages column of one platform, generic over the row. A plain column (no order), 344 px, with the platform's
 * mark in its header. It exists only while one platform is in view: pages are counted per platform and never pooled.
 */
export function linksColumn<TRow>(options: LinksColumnOptions<TRow>): DataTableColumn<TRow> {
  const { rowOf, labelOf, loaded, code, t } = options;
  const readingOf = (row: TRow): LinksReading => {
    const found = rowOf(row);
    return found === undefined
      ? { state: 'unknown', reason: loaded ? 'unobserved' : 'not_collected', shown: [], total: 0, answers: 0 }
      : citedLinksOf([found], code);
  };
  return col.url<TRow>(options.id ?? 'links', () => null, {
    header: t('prompts.lists.columns.links'),
    headerTooltip: t('prompts.lists.headers.linksTip'),
    headerIcon: <PlatformMark code={code} />,
    width: LINKS_WIDTH,
    // The table scrolls sideways as the mock's does, rather than squeezing a page address to a few letters
    minWidth: LINKS_WIDTH,
    sortable: false,
    hasControls: true,
    cell: (row): ReactElement => {
      const reading = readingOf(row);
      const words = wordsOf(reading, t);
      if (words !== undefined) return <span className="text-foreground-tertiary">{words.text}</span>;
      const found = rowOf(row);
      const ownCited =
        found !== undefined && engineOf(found, code)?.top_links?.some((link) => link.domain_role === 'own') === true;
      return <LinksCell reading={reading} ownCited={ownCited} label={labelOf(row)} />;
    },
    cellTip: (row) => {
      const words = wordsOf(readingOf(row), t);
      return words === undefined ? undefined : { content: words.tip };
    },
  });
}
