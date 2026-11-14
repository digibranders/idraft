import type { useTranslations } from 'next-intl';

import type { ChangeKind } from '../citation-scope';
import { shareChange, unitShare } from '@/lib/citations/share-model';
import type {
  DomainRole,
  MetricCell,
  SourceChangeRow,
  SourceDomainRow,
  SourcePageRow,
  SourcesMeta,
} from '@/lib/citations/types';
import { formatInteger, formatPercent, formatTableDateTime, EMPTY_VALUE, type MetricDeltaInput } from '@/lib/format';

/**
 * What a row of the Citations lists on a phone says (19-responsive-behavior.md section 6.7, WB-CIT-20): line 1 is the
 * identity and one value, line 2 the role with the counts behind that value. Pure: rows in, strings out, so a value
 * reads as it does in the table. A share is never shown without its counts, and a share that cannot be told is n/a,
 * never 0%.
 */

/** The translator of `citations.mobile`, as `useTranslations` and `createTranslator` give it. */
export type MobileTranslate = ReturnType<typeof useTranslations<'citations.mobile'>>;
/** The translator of the role words ("Own", "Competitor", "Third party"). */
export type RoleTranslate = ReturnType<typeof useTranslations<'common.domainCell.roles'>>;

export interface LineWords {
  t: MobileTranslate;
  roles: RoleTranslate;
  locale: string;
}
/** New and Lost rows carry dates, which are days of the project's zone. */
export interface ChangeWords extends LineWords {
  timeZone: string;
}

/** What a row says, before it is drawn. */
export interface RowLines {
  /** Plain text. */
  identity: string;
  /** Spoken before the value: "Source share", or "Share n/a" when there is none. */
  valueLabel: string;
  /** The value of line 1; `null` is n/a. */
  value: string | null;
  /** Line 2 on the left: the role and the counts behind the value. */
  context: string;
  /** The change in a share, never coloured: no test of it exists. `null` shows nothing, never a 0. */
  delta: MetricDeltaInput | null;
}

/** The periods a share change needs: both are `undefined` while the comparison is off or not read. */
export interface Comparison {
  meta: Pick<SourcesMeta, 'previous_answers'> | undefined;
  previousMeta: Pick<SourcesMeta, 'citation_units'> | undefined;
}

const ROLE_KEY = { own: 'own', competitor: 'competitor', third_party: 'thirdParty' } as const satisfies Record<
  DomainRole,
  string
>;

type ShareRow = Pick<SourceDomainRow, 'source_share' | 'previous' | 'domain_role'>;

function shareLines(
  row: ShareRow,
  context: 'domainContext' | 'pageContext',
  comparison: Comparison,
  { t, roles, locale }: LineWords,
): Pick<RowLines, 'value' | 'valueLabel' | 'context' | 'delta'> {
  const cell: MetricCell = row.source_share;
  const { value, units, total } = unitShare(cell);
  const moved = comparison.meta === undefined ? null : shareChange(row, comparison.meta, comparison.previousMeta);
  return {
    value: value === null ? null : formatPercent(value, { locale }),
    valueLabel: value === null ? t('shareUnknown') : t('shareLabel'),
    context: t(context, { role: roles(ROLE_KEY[row.domain_role]), units, total }),
    delta: moved === null ? null : { value: moved.delta, unit: 'points', polarity: 'neutral', isDetectable: null },
  };
}

/** A domain of the Domains tab: its registrable domain, its share and the units behind it. */
export function domainLines(row: SourceDomainRow, comparison: Comparison, words: LineWords): RowLines {
  return { identity: row.registrable_domain, ...shareLines(row, 'domainContext', comparison, words) };
}

/** A page of the Pages tab: its title or, with none, its address, as text. */
export function pageLines(row: SourcePageRow, comparison: Comparison, words: LineWords): RowLines {
  const identity = row.title !== null && row.title.trim() !== '' ? row.title : row.url;
  return { identity, ...shareLines(row, 'pageContext', comparison, words) };
}

/**
 * A row of the New and lost tab: counts only, since a source that has just started or stopped has no earlier or later
 * share to compare. New says its units in the window and when it was first cited; Lost the units it had before it went quiet.
 */
export function changeLines(
  kind: ChangeKind,
  row: SourceChangeRow,
  { t, roles, locale, timeZone }: ChangeWords,
): RowLines {
  const role = roles(ROLE_KEY[row.domain_role]);
  if (kind === 'lost') {
    return {
      identity: row.registrable_domain,
      valueLabel: t('unitsBeforeLabel'),
      value: formatInteger(row.previous_units, { locale }),
      context: t('lostContext', { role }),
      delta: null,
    };
  }
  return {
    identity: row.registrable_domain,
    valueLabel: t('unitsLabel'),
    value: formatInteger(row.current_units, { locale }),
    context: t('newContext', {
      role,
      date: row.first_seen_at === null ? EMPTY_VALUE : formatTableDateTime(row.first_seen_at, timeZone),
    }),
    delta: null,
  };
}
