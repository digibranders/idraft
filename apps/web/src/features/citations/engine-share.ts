import type { useTranslations } from 'next-intl';

import { engineShare, type EngineTotals, type UnitShare } from '@/lib/citations/share-model';
import type { EngineCode, EngineUnits } from '@/lib/citations/types';
import { formatPercent } from '@/lib/format';

/** The translator of `citations.table`, as `useTranslations('citations.table')` and `createTranslator` give it. */
export type TableTranslate = ReturnType<typeof useTranslations<'citations.table'>>;

/** An engine in scope: its code and its name. */
export interface EngineInScope {
  code: EngineCode;
  label: string;
}

/**
 * What an engine's cell of a row says. A share carries its text and a tooltip with the units it is of; an engine
 * that cannot give one (no citation on it in scope, or its totals not known) is `none` with the reason: never 0%.
 */
export type EngineCell =
  { state: 'share'; share: UnitShare; text: string; tip: string } | { state: 'none'; tip: string };

/** One engine of a row: its units over every unit of that engine in scope, in words for a table cell and its tooltip. */
export function engineCell(
  row: { engines: readonly EngineUnits[] },
  engine: EngineInScope,
  totals: EngineTotals | null,
  t: TableTranslate,
  locale: string,
): EngineCell {
  if (totals === null) return { state: 'none', tip: t('engineUnknown', { engine: engine.label }) };
  const share = engineShare(row, engine.code, totals);
  if (share === null || share.value === null) return { state: 'none', tip: t('engineNone', { engine: engine.label }) };
  return {
    state: 'share',
    share,
    text: formatPercent(share.value, { locale }),
    tip: t('engineCell', { units: share.units, total: share.total, engine: engine.label }),
  };
}
