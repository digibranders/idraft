import { describe, expect, it } from 'vitest';

import { planHeader } from './column-groups';
import type { ColumnGroup } from './types';

const A: ColumnGroup = { id: 'a', label: 'Engine A' };
const B: ColumnGroup = { id: 'b', label: 'Engine B' };

describe('planHeader', () => {
  it('plans one row when no column has a group', () => {
    expect(planHeader([undefined, undefined])).toEqual({ rows: 1, slots: [{ kind: 'tall' }, { kind: 'tall' }] });
    expect(planHeader([])).toEqual({ rows: 1, slots: [] });
  });

  it('spans a run of adjacent columns of one group', () => {
    expect(planHeader([A, A, A])).toEqual({
      rows: 2,
      slots: [{ kind: 'group', group: A, span: 3 }, { kind: 'covered' }, { kind: 'covered' }],
    });
  });

  it('matches a group by its id, and takes the label of the first column', () => {
    const again: ColumnGroup = { id: 'a', label: 'Other label' };
    expect(planHeader([A, again]).slots[0]).toEqual({ kind: 'group', group: A, span: 2 });
  });

  it('makes a group of one shown column a tall cell and keeps rows at 1 when no other group spans', () => {
    expect(planHeader([A])).toEqual({ rows: 1, slots: [{ kind: 'tall' }] });
    expect(planHeader([A, B])).toEqual({ rows: 1, slots: [{ kind: 'tall' }, { kind: 'tall' }] });
  });

  it('draws two rows when one group spans, and a group of one stays tall beside it', () => {
    expect(planHeader([A, A, B])).toEqual({
      rows: 2,
      slots: [{ kind: 'group', group: A, span: 2 }, { kind: 'covered' }, { kind: 'tall' }],
    });
  });

  it('splits a group whose columns are not adjacent into two cells', () => {
    expect(planHeader([A, A, B, A, A])).toEqual({
      rows: 2,
      slots: [
        { kind: 'group', group: A, span: 2 },
        { kind: 'covered' },
        { kind: 'tall' },
        { kind: 'group', group: A, span: 2 },
        { kind: 'covered' },
      ],
    });
  });

  it('treats columns with no group (select, actions) as tall', () => {
    expect(planHeader([undefined, A, A, undefined])).toEqual({
      rows: 2,
      slots: [{ kind: 'tall' }, { kind: 'group', group: A, span: 2 }, { kind: 'covered' }, { kind: 'tall' }],
    });
  });
});
