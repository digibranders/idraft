import { shareChange, unitShare, type ShareChange, type UnitShare } from '@/lib/citations/share-model';
import type { DomainRole, EngineUnits, SourceDomainPage, SourcesMeta } from '@/lib/citations/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * The rows of the top cited domains card, as figures (WP-37 plan T1). Pure: numbers in, numbers out, no text.
 * A share is the row's units over every citation unit in scope, as the API states it; one that cannot be told
 * is `unknown`, one over too few answers is `thin`, and neither is ever drawn as 0.
 */

/**
 * - `ok`: a share that can be shown with its units.
 * - `thin`: fewer than `MIN_OBSERVATIONS` valid answers stand behind it: the answers are shown, no percent.
 * - `unknown`: no unit in scope, so no share exists.
 */
export type ShareState = 'ok' | 'thin' | 'unknown';

export interface DomainFigures {
  /** One per row: a domain that matched two roles or two entities is two rows with two ids. */
  id: string;
  domain: string;
  role: DomainRole;
  /** The row is the project's own domain. */
  own: boolean;
  units: number;
  /** Answers that cite it. */
  answers: number;
  prompts: number;
  share: UnitShare;
  state: ShareState;
  /** Valid answers in scope (`n_observations` of the share), the count a thin share shows. */
  validAnswers: number;
  /** The change of the share against the window before; `null` where it cannot be told. */
  change: ShareChange | null;
  /** Its units in the window before; `null` when not compared or that window had no answers. */
  previousUnits: number | null;
  engines: readonly EngineUnits[];
}

function stateOf(share: UnitShare, validAnswers: number): ShareState {
  if (share.value === null) return 'unknown';
  return validAnswers < MIN_OBSERVATIONS ? 'thin' : 'ok';
}

/**
 * The rows of a page of domains in the order the route gave them (units, descending). `previousMeta` is the meta of
 * the same read over the window before (its total is the denominator of the share then), or `null` while it is not
 * read: the rows then have no change.
 */
export function domainRows(
  page: SourceDomainPage,
  previousMeta: Pick<SourcesMeta, 'citation_units'> | null,
): DomainFigures[] {
  const answered = (page.meta.previous_answers ?? 0) > 0;
  return page.data.map((row) => {
    const share = unitShare(row.source_share);
    const validAnswers = row.source_share.n_observations;
    const state = stateOf(share, validAnswers);
    const change = state === 'ok' ? shareChange(row, page.meta, previousMeta) : null;
    return {
      id: `${row.registrable_domain}|${row.domain_role}|${row.role_entity_id ?? ''}`,
      domain: row.registrable_domain,
      role: row.domain_role,
      own: row.domain_role === 'own',
      units: row.citation_units,
      answers: row.observations,
      prompts: row.prompts,
      share,
      state,
      validAnswers,
      change,
      previousUnits:
        answered && row.previous !== undefined && row.previous !== null ? row.previous.citation_units : null,
      engines: row.engines,
    };
  });
}
