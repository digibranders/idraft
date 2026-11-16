import type { ReactElement } from 'react';

import { brandsOf, type BrandsReading, type FactsRow, type TrackedEntity } from '../facts';
import { BrandsCell } from '../lists/brands-cell';
import type { PromptScope } from '../prompt-queries';
import type { Translate } from '../seams/shared';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE } from '@/lib/format';

/** The column's width in the preview: three names and "+7" with the mark before them. */
export const BRANDS_WIDTH = 272;

export interface BrandsColumnOptions<TRow> {
  id?: string;
  /**
   * The rows the row's list is over: a prompt's own row, or the rows of a group. Empty when the summary has none for it:
   * with `loaded` the row has no answers, without it the facts are not read.
   */
  rowsOf: (row: TRow) => readonly FactsRow[];
  /** What the list is about: "This prompt", or the group's name. */
  labelOf: (row: TRow) => string;
  /** The facts were read (the summary came back with them). */
  loaded: boolean;
  /** The platform codes in view. */
  scope: readonly string[];
  entities: readonly TrackedEntity[];
  project: PromptScope;
  platformName: (code: string) => string;
  t: Translate;
  /** Hide the column from the table's default set. */
  defaultVisible?: boolean;
}

/** Why a row has no list, in words, or `undefined` when it has one. */
function unknownTip(reading: BrandsReading, t: Translate): string | undefined {
  if (reading.state === 'ok' && reading.shown.length > 0) return undefined;
  if (reading.reason === 'not_collected') return t('prompts.lists.notCollectedTip');
  return reading.reason === 'too_few_answers' || reading.state === 'ok'
    ? t('prompts.lists.brands.tooFewTip')
    : t('prompts.lists.noAnswersTip');
}

/**
 * The Brands column, generic over the row: a prompt row reads its own summary row, a group row the rows of its prompts, so
 * the Groups tab reuses it. A plain column (no order), 272 px, with the list popover of `BrandsCell`.
 */
export function brandsColumn<TRow>(options: BrandsColumnOptions<TRow>): DataTableColumn<TRow> {
  const { rowsOf, labelOf, loaded, scope, entities, project, platformName, t } = options;
  const readingOf = (row: TRow): { reading: BrandsReading; rows: readonly FactsRow[] } => {
    const rows = rowsOf(row);
    if (rows.length === 0) {
      return {
        rows,
        reading: {
          state: 'unknown',
          reason: loaded ? 'unobserved' : 'not_collected',
          shown: [],
          own: null,
          codes: [],
          answers: 0,
          prompts: 0,
          total: 0,
        },
      };
    }
    return { rows, reading: brandsOf(rows, scope, entities) };
  };
  return col.url<TRow>(options.id ?? 'brands', () => null, {
    header: t('prompts.lists.columns.brands'),
    headerTooltip: t('prompts.lists.headers.brandsTip'),
    width: BRANDS_WIDTH,
    sortable: false,
    hasControls: true,
    defaultVisible: options.defaultVisible,
    cell: (row): ReactElement => {
      const { reading, rows } = readingOf(row);
      if (unknownTip(reading, t) !== undefined) return <span className="text-foreground-tertiary">{EMPTY_VALUE}</span>;
      return (
        <BrandsCell
          reading={reading}
          rows={rows}
          entities={entities}
          label={labelOf(row)}
          project={project}
          platformName={platformName}
        />
      );
    },
    cellTip: (row) => {
      const tip = unknownTip(readingOf(row).reading, t);
      return tip === undefined ? undefined : { content: tip };
    },
  });
}
