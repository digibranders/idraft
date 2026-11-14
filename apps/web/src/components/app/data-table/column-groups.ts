import type { ColumnGroup } from './types';

/**
 * What one column's place in the header is. A `group` slot sits at the first column of a run: it draws the
 * group cell over `span` columns in row 1, and its own column header in row 2. A `covered` slot is a later
 * column of that run: its header is in row 2 only. A `tall` column (no group, alone in its group, the
 * selection and actions columns) has one header cell spanning both rows.
 */
export type HeaderSlot = { kind: 'group'; group: ColumnGroup; span: number } | { kind: 'tall' } | { kind: 'covered' };

export interface HeaderPlan {
  /** 2 only when some group cell is drawn; otherwise one row, exactly as a table without groups. */
  rows: 1 | 2;
  /** One slot per shown column, in order. */
  slots: readonly HeaderSlot[];
}

/**
 * The header's shape for the shown columns, each given its group (`undefined` for a column with none).
 * Adjacent columns with the same group id make one group cell when there are two or more; the same id in
 * two separate runs makes two cells.
 */
export function planHeader(groups: readonly (ColumnGroup | undefined)[]): HeaderPlan {
  const slots: HeaderSlot[] = [];
  let index = 0;
  while (index < groups.length) {
    const group = groups[index];
    let end = index + 1;
    if (group !== undefined) while (groups[end]?.id === group.id) end += 1;
    const span = end - index;
    if (group === undefined || span === 1) {
      slots.push({ kind: 'tall' });
    } else {
      slots.push({ kind: 'group', group, span });
      for (let covered = 1; covered < span; covered += 1) slots.push({ kind: 'covered' });
    }
    index = end;
  }
  return { rows: slots.some((slot) => slot.kind === 'group') ? 2 : 1, slots };
}
