import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import { withColumnEntries, type PromptColumnContext, type PromptColumnEntry } from './columns';
import type { PromptRow } from '../prompt-columns';
import { SORT_ID } from '../prompt-model';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import messages from '../../../../messages/en.json';

const translate = createTranslator({ locale: 'en', messages });

const context: PromptColumnContext = {
  engines: [],
  metric: 'mention',
  t: translate,
  locale: 'en',
  compare: true,
  comparedWindow: null,
  changeWords: { tip: () => '', label: () => '', gap: () => '' },
};

const column = (id: string): DataTableColumn<PromptRow> =>
  col.text<PromptRow>(id, () => id, { header: id, defaultVisible: false });
const BUILT_INS = [SORT_ID.prompt, SORT_ID.mention, SORT_ID.citation, SORT_ID.country].map(column);
const entry = (id: string, columns: readonly string[], after?: string): PromptColumnEntry => ({
  id,
  after,
  build: () => columns.map(column),
});
const idsOf = (columns: readonly DataTableColumn<PromptRow>[]): string[] =>
  columns.map((entryColumn) => entryColumn.id);

describe('withColumnEntries', () => {
  it('is the built-in columns while no entry is added', () => {
    expect(idsOf(withColumnEntries(BUILT_INS, [], context))).toEqual(['prompt', 'mention', 'citation', 'country']);
  });

  it('places the columns of an entry after the column it names', () => {
    const placed = withColumnEntries(BUILT_INS, [entry('compare', ['delta', 'delta_note'], SORT_ID.citation)], context);
    expect(idsOf(placed)).toEqual(['prompt', 'mention', 'citation', 'delta', 'delta_note', 'country']);
  });

  it('appends the columns of an entry without an anchor', () => {
    expect(idsOf(withColumnEntries(BUILT_INS, [entry('last', ['tail'])], context))).toEqual([
      'prompt',
      'mention',
      'citation',
      'country',
      'tail',
    ]);
  });

  it('builds each entry for the context it is given', () => {
    const build = vi.fn(() => [column('built')]);
    withColumnEntries(BUILT_INS, [{ id: 'seen', build }], context);
    expect(build).toHaveBeenCalledExactlyOnceWith(context);
  });

  it('throws for a column id that repeats', () => {
    expect(() => withColumnEntries(BUILT_INS, [entry('clash', ['mention'])], context)).toThrow(/"mention"/);
  });
});
