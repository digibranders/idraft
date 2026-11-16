import { intentOf, type PromptIntent } from '../facts';
import { SORT_ID } from '../prompt-model';
import type { Translate } from '../seams/shared';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE } from '@/lib/format';

/** The preview's Intent column: 128 px. */
const INTENT_WIDTH = 128;

/**
 * Intent: what the asker wants, as plain text (no badge, one line, truncated), the same on every platform. It sorts
 * A to Z by the word shown; a prompt the API has not classified (`unknown`) says so and sorts last. `intentOf` reads
 * the row's intent, `undefined` when the row has none.
 */
export function intentColumn<TRow>(
  t: Translate,
  intentOfRow: (row: TRow) => PromptIntent | undefined,
): DataTableColumn<TRow> {
  const reading = (row: TRow): ReturnType<typeof intentOf> => intentOf(intentOfRow(row));
  const base = col.text<TRow>(
    SORT_ID.intent,
    (row) => {
      const found = reading(row);
      return found.state === 'ok' ? t(`prompts.metrics.intent.values.${found.intent}`) : null;
    },
    {
      header: t('prompts.metrics.intent.header'),
      headerTooltip: t('prompts.metrics.intent.tip'),
      priority: 3,
      width: INTENT_WIDTH,
      unknown: (row) => {
        const found = reading(row);
        return {
          label: EMPTY_VALUE,
          tooltip:
            found.state === 'unknown' && found.reason === 'unclassified'
              ? t('prompts.metrics.intent.unclassifiedTip')
              : t('prompts.metrics.notCollectedTip'),
        };
      },
    },
  );
  return {
    ...base,
    cellTip: (row) => {
      const found = reading(row);
      return found.state === 'ok' ? { content: t(`prompts.metrics.intent.tips.${found.intent}`) } : base.cellTip?.(row);
    },
  };
}
