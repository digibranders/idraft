import { describe, expect, it } from 'vitest';

import {
  aiBudgetOf,
  editableLimit,
  forecastTotalOf,
  GROUP_KEYS,
  limitIssue,
  limitOf,
  quotaFigures,
  softLimitIssue,
  type BudgetGroup,
} from './budget-model';
import messages from '../../../../messages/en.json';
import type { BudgetStatus, Schemas } from '@/lib/api/types';

const status = (workload: BudgetGroup, projectId: string | null): BudgetStatus => ({
  budget: {
    budget_id: '0192d1a8-0000-7000-8000-000000000001',
    project_id: projectId,
    workload,
    period: 'month',
    limit_usd: '100.00',
    soft_limit_pct: 80,
    action_on_hard: 'pause',
    created_at: '2026-11-01T00:00:00Z',
  },
  spent_usd: '10.000000',
  committed_estimate_usd: '0.000000',
  pct_used: 10,
  state: 'ok',
  blocked_runs: 0,
});

describe('budget form model', () => {
  it('a budget form accepts a limit with two places and refuses three', () => {
    expect(limitIssue('250')).toBeNull();
    expect(limitIssue('250.5')).toBeNull();
    expect(limitIssue('250.55')).toBeNull();
    // A limit of 0 is allowed: it blocks every run of the group
    expect(limitIssue('0')).toBeNull();
    expect(limitIssue('250.555')).toBe('invalid');
    expect(limitIssue('')).toBe('required');
    expect(limitIssue('   ')).toBe('required');
    expect(limitIssue('-5')).toBe('invalid');
    expect(limitIssue('12abc')).toBe('invalid');
    expect(limitIssue('99999999999.99')).toBeNull();
    expect(limitIssue('100000000000')).toBe('too_large');
    // The API takes two places: the form sends them
    expect(limitOf(' 250.5 ')).toBe('250.50');
    expect(limitOf('250')).toBe('250.00');
    expect(limitOf('0')).toBe('0.00');
    // A stored limit shows with its two places
    expect(editableLimit('100.000000')).toBe('100.00');
    expect(editableLimit('0.5')).toBe('0.50');
    expect(editableLimit('250')).toBe('250.00');
  });

  it('soft limit 0 and 101 are refused', () => {
    expect(softLimitIssue('0')).toBe('range');
    expect(softLimitIssue('101')).toBe('range');
    expect(softLimitIssue('1')).toBeNull();
    expect(softLimitIssue('80')).toBeNull();
    expect(softLimitIssue('100')).toBeNull();
    expect(softLimitIssue('')).toBe('required');
    expect(softLimitIssue('80.5')).toBe('invalid');
    expect(softLimitIssue('eighty')).toBe('invalid');
  });

  it('the AI group is named as AI prompts, as on the Costs page', () => {
    expect(GROUP_KEYS.ai_prompt).toBe('aiPrompts');
    expect(messages.budgets.groups[GROUP_KEYS.ai_prompt]).toBe('AI prompts');
    expect(messages.budgets.groups[GROUP_KEYS.ai_prompt]).toBe(messages.workloads.aiPrompt);
    // Every group of the API has a name in the catalog
    for (const key of Object.values(GROUP_KEYS)) expect(messages.budgets.groups[key]).toBeTruthy();
  });

  it('usage text always carries used of limit', () => {
    expect(quotaFigures({ used: 72, limit: 150 })).toMatchObject({ used: '72', limit: '150', max: 150, warnFrom: 120 });
    expect(quotaFigures({ used: 412, limit: 2000 })).toMatchObject({ used: '412', limit: '2,000', warnFrom: 1600 });
    // Over the limit: the real figure is kept, the meter's track is not
    expect(quotaFigures({ used: 168, limit: 150 })).toMatchObject({ used: '168', limit: '150', value: 168, max: 150 });
    // A limit of 0 never gives the meter a zero-width track, and still says both figures
    expect(quotaFigures({ used: 3, limit: 0 })).toMatchObject({ used: '3', limit: '0', max: 1 });
  });

  it('adds the forecast of the projects, and says nothing when there is no price', () => {
    const row = (estimated: string): Schemas['ForecastRow'] => ({
      project_id: '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01',
      workload: 'ai_prompt',
      estimated_cost_usd: estimated,
      method: 'price_book_x_schedules',
      is_estimate: true,
    });
    expect(forecastTotalOf([row('1.500000'), row('0.750000')])).toBe(2.25);
    // Unknown is not $0.00: no row, or a figure that is not money, gives no total
    expect(forecastTotalOf([])).toBeNull();
    expect(forecastTotalOf([row('1.500000'), row('n/a')])).toBeNull();
  });

  it('finds the AI answers budget of the whole workspace, and no other', () => {
    const projectOne = status('ai_prompt', '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01');
    const everything = status('all', null);
    const workspaceAi = status('ai_prompt', null);
    expect(aiBudgetOf([projectOne, everything])).toBeNull();
    expect(aiBudgetOf([projectOne, everything, workspaceAi])).toBe(workspaceAi);
  });
});
