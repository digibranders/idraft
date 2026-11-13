import { budgetCreateWorkloadValues } from '@/lib/api/schema';
import type { Budget, BudgetStatus, Schemas } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';
import { money } from '@/lib/format/money';

/** A budget group, as the API names it: a workload, or `all` for every workload together. */
export type BudgetGroup = Budget['workload'];

/** The groups the Group select offers, in the API's order. */
export const BUDGET_GROUPS: readonly BudgetGroup[] = budgetCreateWorkloadValues;

/** The catalog key of a group under `budgets.groups`: the AI group is named for what it counts, AI answers. */
export const GROUP_KEYS = {
  seo_rank: 'seoRank',
  ai_prompt: 'aiAnswers',
  keyword_research: 'keywordResearch',
  ai_benchmark: 'aiBenchmark',
  extraction_llm: 'extractionLlm',
  first_party: 'firstParty',
  all: 'all',
} as const satisfies Record<BudgetGroup, string>;

/** What the Scope select holds for the whole workspace; a project is its id. */
export const WORKSPACE_SCOPE = 'workspace';

/** A project a budget can be scoped to, as the page's route lists it. */
export interface BudgetsProject {
  id: string;
  slug: string;
  name: string;
}

export const isBudgetGroup = (value: unknown): value is BudgetGroup =>
  typeof value === 'string' && BUDGET_GROUPS.some((group) => group === value);

/** The soft limit a budget starts with, and its bounds (19 section 3.11.2). */
export const DEFAULT_SOFT_LIMIT = 80;
const SOFT_MIN = 1;
const SOFT_MAX = 100;
/** The largest limit the column holds. */
const LIMIT_MAX = 99_999_999_999.99;
const LIMIT_SHAPE = /^\d+(\.\d{1,2})?$/;

export type LimitIssue = 'required' | 'invalid' | 'too_large';
export type SoftLimitIssue = 'required' | 'invalid' | 'range';

/**
 * Why a limit in dollars cannot be sent, or `null`: whole dollars and at most two places, up to the column's
 * largest. 0 is allowed, since a limit of 0 blocks every run of the group.
 */
export function limitIssue(text: string): LimitIssue | null {
  const value = text.trim();
  if (value === '') return 'required';
  if (!LIMIT_SHAPE.test(value)) return 'invalid';
  return Number(value) > LIMIT_MAX ? 'too_large' : null;
}

/** The limit as the API takes it, with its two places ("250.5" is "250.50"). The text must pass `limitIssue`. */
export function limitOf(text: string): string {
  const [whole = '0', fraction = ''] = text.trim().split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

/** A stored limit as the form shows it: two places, whatever the API's precision ("100.000000" is "100.00"). */
export function editableLimit(stored: string): string {
  const [whole = '0', fraction = ''] = stored.split('.');
  return `${whole}.${fraction.slice(0, 2).padEnd(2, '0')}`;
}

/** Why a soft limit in percent cannot be sent, or `null`: a whole number from 1 to 100. */
export function softLimitIssue(text: string): SoftLimitIssue | null {
  const value = text.trim();
  if (value === '') return 'required';
  if (!/^\d+$/.test(value)) return 'invalid';
  const percent = Number(value);
  return percent < SOFT_MIN || percent > SOFT_MAX ? 'range' : null;
}

/** The AI answers budget of the whole workspace: the one the page's AI card is about. */
export function aiBudgetOf(rows: readonly BudgetStatus[]): BudgetStatus | null {
  return rows.find((row) => row.budget.project_id === null && row.budget.workload === 'ai_prompt') ?? null;
}

/**
 * The month's AI spend the projects are forecast to reach, or `null` when there is nothing to add up: a project
 * without a price is left out by the API, so no row means no forecast, never $0.00.
 */
export function forecastTotalOf(rows: readonly Pick<Schemas['ForecastRow'], 'estimated_cost_usd'>[]): number | null {
  if (rows.length === 0) return null;
  const amounts = rows.map((row) => money(row.estimated_cost_usd));
  return amounts.some((amount) => amount === null)
    ? null
    : amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}

/** A quota as the API reports it. */
export interface Quota {
  limit: number;
  used: number;
}

export interface QuotaFigures {
  /** Both figures as text, so a line always reads "used of limit". */
  used: string;
  limit: string;
  /** The meter's reading: the real use, which may pass `max`. */
  value: number;
  /** The meter's track. A limit of 0 has no track of its own, so the meter gets 1 and the text says 0. */
  max: number;
  /** The fill turns warning from here: the soft share of the limit. */
  warnFrom: number;
}

/** The share of a quota from which its meter turns warning, as the budgets' soft limit. */
const QUOTA_WARN_SHARE = DEFAULT_SOFT_LIMIT / 100;

export function quotaFigures({ used, limit }: Quota): QuotaFigures {
  const max = limit > 0 ? limit : 1;
  return {
    used: formatInteger(used),
    limit: formatInteger(limit),
    value: used,
    max,
    warnFrom: max * QUOTA_WARN_SHARE,
  };
}
