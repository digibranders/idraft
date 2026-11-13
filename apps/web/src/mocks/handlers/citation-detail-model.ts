import {
  aggregateDomains,
  aggregatePages,
  countedAnswers,
  registrableOf,
  unitsOf,
  type CitedAnswer,
  type SourceScope,
} from './citations-model';
import { mondayOf, summaryWeeks } from '../prompt-summary';
import type { Schemas } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * The arithmetic of `ai/sources/domains/{registrable_domain}` (contracts/sources-additions.md; backend
 * `SourceService.domain_detail`): one registrable domain with its rows, its units per engine and week, its most
 * cited pages, the prompts whose answers cite it most and the tracked entities named most in those answers. Pure,
 * like ./citations-model.ts, whose aggregates it reuses so every figure agrees with the lists.
 */

const MAX_ROWS = 10;
const MAX_PAGES = 10;
const MAX_PROMPTS = 20;
const MAX_ENTITIES = 5;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface WeekCell {
  /** Units of the domain on the engine that week. */
  units: number;
  /** Answers that cite the domain. */
  seen: number;
  /** Every unit of the engine that week: the share's denominator. */
  all: number;
  /** Every counted answer of the engine that week. */
  answers: number;
}

/**
 * The detail of `registrable` (already in lower case) over `scope`. The role filter narrows the lists of the
 * domains route, not a detail, so it is dropped. A domain with no unit in scope has every list empty, `engines`
 * included, as the API answers.
 */
export function domainDetailOf(
  answers: readonly CitedAnswer[],
  scope: SourceScope,
  registrable: string,
): Schemas['SourceDomainDetailData'] {
  const whole: SourceScope = { ...scope, roles: [] };
  const rows = aggregateDomains(answers, whole)
    .filter((row) => row.registrable_domain === registrable)
    .slice(0, MAX_ROWS);
  if (rows.length === 0) {
    return { registrable_domain: registrable, rows: [], engines: [], top_pages: [], prompts: [], cited_with: [] };
  }

  const cells = new Map<string, WeekCell>();
  const prompts = new Map<string, { units: number; seen: number }>();
  const named = new Map<string, number>();
  for (const answer of countedAnswers(answers, whole)) {
    const units = unitsOf(answer, whole.flags);
    const mine = units.filter((unit) => registrableOf(unit.host) === registrable).length;
    const key = `${answer.engine}|${mondayOf(formatIsoDate(new Date(answer.at).toISOString(), whole.window.timezone))}`;
    const cell = cells.get(key) ?? { units: 0, seen: 0, all: 0, answers: 0 };
    cell.all += units.length;
    cell.answers += 1;
    if (mine > 0) {
      cell.units += mine;
      cell.seen += 1;
      const asked = prompts.get(answer.promptId) ?? { units: 0, seen: 0 };
      asked.units += mine;
      asked.seen += 1;
      prompts.set(answer.promptId, asked);
      for (const entity of answer.named) named.set(entity, (named.get(entity) ?? 0) + 1);
    }
    cells.set(key, cell);
  }

  const weeks = summaryWeeks(whole.window.first, whole.window.last);
  return {
    registrable_domain: registrable,
    rows,
    engines: whole.engines.map((engine) => ({
      engine_code: engine,
      series: weeks.map((week) => {
        const cell = cells.get(`${engine}|${week}`);
        return {
          week_start: week,
          citation_units: cell?.units ?? 0,
          observations: cell?.seen ?? 0,
          all_citation_units: cell?.all ?? 0,
          answers: cell?.answers ?? 0,
        };
      }),
    })),
    top_pages: aggregatePages(answers, whole, { registrableDomain: registrable }).slice(0, MAX_PAGES),
    prompts: [...prompts]
      .sort(([a, x], [b, y]) => y.units - x.units || y.seen - x.seen || byText(a, b))
      .slice(0, MAX_PROMPTS)
      .map(([prompt_id, { units, seen }]) => ({ prompt_id, citation_units: units, observations: seen })),
    cited_with: [...named]
      .sort(([a, x], [b, y]) => y - x || byText(a, b))
      .slice(0, MAX_ENTITIES)
      .map(([entity_id, observations]) => ({ entity_id, observations })),
  };
}
