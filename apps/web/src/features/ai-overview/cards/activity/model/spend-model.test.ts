import { describe, expect, it } from 'vitest';

import { budgetStatus, FIXTURE_PROJECT_ID } from './activity-fixtures';
import { chooseSpend } from './spend-model';

const OTHER_PROJECT = '99999999-0000-4000-8000-000000000001';

describe('chooseSpend', () => {
  it('prefers the project ai_prompt budget, then the workspace ai_prompt one, then an all budget', () => {
    const projectAi = budgetStatus({ n: 1, projectId: FIXTURE_PROJECT_ID, workload: 'ai_prompt' });
    const workspaceAi = budgetStatus({ n: 2, projectId: null, workload: 'ai_prompt' });
    const projectAll = budgetStatus({ n: 3, projectId: FIXTURE_PROJECT_ID, workload: 'all' });
    const workspaceAll = budgetStatus({ n: 4, projectId: null, workload: 'all' });

    expect(chooseSpend([workspaceAll, projectAll, workspaceAi, projectAi], FIXTURE_PROJECT_ID)).toMatchObject({
      scope: 'project',
      workload: 'ai_prompt',
    });
    expect(chooseSpend([workspaceAll, projectAll, workspaceAi], FIXTURE_PROJECT_ID)).toMatchObject({
      scope: 'workspace',
      workload: 'ai_prompt',
    });
    expect(chooseSpend([workspaceAll, projectAll], FIXTURE_PROJECT_ID)).toMatchObject({
      scope: 'project',
      workload: 'all',
    });
    expect(chooseSpend([workspaceAll], FIXTURE_PROJECT_ID)).toMatchObject({ scope: 'workspace', workload: 'all' });
  });

  it('never adds budgets up: it reads exactly one', () => {
    const facts = chooseSpend(
      [
        budgetStatus({ n: 1, projectId: FIXTURE_PROJECT_ID, spent: '10.000000', limit: '40.000000', pct: 25 }),
        budgetStatus({ n: 2, projectId: null, spent: '20.000000', limit: '100.000000', pct: 20 }),
      ],
      FIXTURE_PROJECT_ID,
    );
    expect(facts).toMatchObject({ spentUsd: 10, limitUsd: 40, pct: 25 });
  });

  it('ignores the budget of another project and budgets of other workloads', () => {
    expect(
      chooseSpend(
        [
          budgetStatus({ n: 1, projectId: OTHER_PROJECT, workload: 'ai_prompt' }),
          budgetStatus({ n: 2, projectId: FIXTURE_PROJECT_ID, workload: 'seo_rank' }),
          budgetStatus({ n: 3, projectId: null, workload: 'keyword_research' }),
        ],
        FIXTURE_PROJECT_ID,
      ),
    ).toBeNull();
  });

  it('is null for no budget', () => {
    expect(chooseSpend([], FIXTURE_PROJECT_ID)).toBeNull();
  });

  it('takes the share from the API and does not work it out again', () => {
    // 12.40 of 50.00 is 24.8%: the API says 31.5, and the API is the one that counts the month
    const facts = chooseSpend(
      [budgetStatus({ spent: '12.400000', limit: '50.000000', pct: 31.5 })],
      FIXTURE_PROJECT_ID,
    );
    expect(facts?.pct).toBe(31.5);
  });

  it('carries the money as numbers, and an amount that is not a number as null, never 0', () => {
    const facts = chooseSpend(
      [budgetStatus({ spent: 'not a number', committed: '1.200000', limit: '50.000000', blocked: 2 })],
      FIXTURE_PROJECT_ID,
    );
    expect(facts).toMatchObject({ spentUsd: null, committedUsd: 1.2, limitUsd: 50, blockedRuns: 2 });
  });

  it('carries the state, the soft limit and what a hard limit does', () => {
    const facts = chooseSpend(
      [budgetStatus({ state: 'hard_exceeded', soft: 70, action: 'alert_only' })],
      FIXTURE_PROJECT_ID,
    );
    expect(facts).toMatchObject({ state: 'hard_exceeded', softLimitPct: 70, actionOnHard: 'alert_only' });
  });
});
