import { screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { askNowState, engineSkips, planNumbers, quotaState } from './add-model';
import { PlanBlock, PlanSummary, type PlanBlockProps } from './plan-block';
import type { EngineCode, Schemas } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const NAMES: ReadonlyMap<EngineCode, string> = new Map([
  ['chatgpt_web', 'ChatGPT'],
  ['gemini_web', 'Gemini'],
  ['google_ai_mode', 'AI Mode'],
]);

const engine = (
  code: EngineCode,
  fit: number,
  cost: string | null,
  runNowCost: string | null = cost === null ? null : '0.010800',
): Schemas['EngineEstimate'] => ({
  engine_code: code,
  prompts_fit: fit,
  answers_per_month: Math.floor((fit * 2 * 52) / 12),
  monthly_cost_usd: cost,
  run_now_answers: fit,
  run_now_cost_usd: runNowCost,
});

const estimateOf = (engines: Schemas['EngineEstimate'][], total: string | null): Schemas['LintEstimate'] => ({
  engines,
  total_monthly_cost_usd: total,
});

/** The block as the dialog gives it after a lint answered for nine prompts on three engines, all of which fit. */
function props(over: Partial<PlanBlockProps> = {}): PlanBlockProps {
  const plan = planNumbers(
    estimateOf(
      [engine('chatgpt_web', 9, '0.03'), engine('gemini_web', 9, '0.03'), engine('google_ai_mode', 9, '0.03')],
      '0.09',
    ),
    9,
  );
  return {
    id: 'plan',
    hasLines: true,
    checking: false,
    failed: false,
    needsCountry: false,
    prompts: 9,
    restore: 0,
    plan,
    engineNames: NAMES,
    skips: [],
    quota: quotaState({ limit: 150, used: 131 }, 9, 0),
    ask: null,
    nextRun: null,
    blocked: null,
    ...over,
  };
}

const show = (given: PlanBlockProps): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(<PlanBlock {...given} />);

describe('the plan block', () => {
  it('says the answers a month from the engines, the cost of each, and the quota after the add', () => {
    show(props());
    expect(screen.getByText('About 234 answers a month: 9 prompts x 3 engines x 2 runs a week.')).toBeInTheDocument();
    expect(
      screen.getByText('About $0.09 a month: ChatGPT $0.03, Gemini $0.03, and AI Mode $0.03 (standard queue).'),
    ).toBeInTheDocument();
    expect(screen.getByText('Workspace prompts: 131 of 150 used, 140 after this add.')).toBeInTheDocument();
  });

  it('names the answers of each engine when they take different numbers of the prompts, and who skips some', () => {
    const plan = planNumbers(
      estimateOf([engine('chatgpt_web', 9, '0.03'), engine('google_ai_mode', 7, '0.02')], '0.05'),
      9,
    );
    show(props({ plan, skips: engineSkips(plan, 9).map((skip) => ({ ...skip, maxChars: 700 })) }));
    expect(screen.getByText('About 138 answers a month: ChatGPT 78 and AI Mode 60.')).toBeInTheDocument();
    expect(screen.getByText('AI Mode skips 2 of these (over 700 characters).')).toBeInTheDocument();
  });

  it('writes under one cent as under $0.01, and an engine without a price as no price, never $0.00', () => {
    const plan = planNumbers(
      estimateOf([engine('chatgpt_web', 1, '0.00'), engine('google_ai_mode', 1, null)], '0.00'),
      1,
    );
    show(props({ plan, prompts: 1, quota: null }));
    expect(screen.getByText('Under $0.01 a month: ChatGPT under $0.01 (standard queue).')).toBeInTheDocument();
    expect(screen.getByText('AI Mode: no price in the price book.')).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it('gives no cost sentence and no sum when no engine has a price', () => {
    const plan = planNumbers(estimateOf([engine('google_ai_mode', 2, null)], null), 2);
    show(props({ plan, prompts: 2, quota: null }));
    expect(screen.getByText('AI Mode: no price in the price book.')).toBeInTheDocument();
    expect(screen.queryByText(/a month: AI Mode/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('turns negative and says what to remove when the add needs more places than the workspace has', () => {
    show(props({ quota: quotaState({ limit: 150, used: 141 }, 12, 0), prompts: 12, blocked: 'overQuota' }));
    const over = screen.getByText(
      'This add needs 12 places and the workspace has 9. Remove 3 lines, or archive prompts you no longer need.',
    );
    expect(over).toHaveClass('text-negative-text');
    expect(screen.getByText('Workspace prompts: 141 of 150 used, 153 after this add.')).toBeInTheDocument();
  });

  it('counts the archived prompts it brings back in the quota and says the estimate leaves them out', () => {
    show(props({ quota: quotaState({ limit: 150, used: 131 }, 9, 2), restore: 2 }));
    expect(screen.getByText('Workspace prompts: 131 of 150 used, 142 after this add.')).toBeInTheDocument();
    expect(
      screen.getByText('2 archived prompts are brought back as well, which the estimate leaves out.'),
    ).toBeInTheDocument();
  });

  it('keeps the last numbers at full strength while it checks, and says so on the block', () => {
    show(props({ checking: true }));
    expect(screen.getByText('Checking...')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'What this add takes' })).toHaveAttribute('aria-busy', 'true');
    const answers = screen.getByText('About 234 answers a month: 9 prompts x 3 engines x 2 runs a week.');
    expect(answers).toBeInTheDocument();
    // No dimming: rule 17 keeps a refetch at full opacity
    expect(screen.getByRole('group', { name: 'What this add takes' }).querySelector('[class*="opacity"]')).toBeNull();
  });

  it('is not busy once the check has settled', () => {
    show(props());
    expect(screen.getByRole('group', { name: 'What this add takes' })).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByText('Checking...')).toBeNull();
  });

  it('asks for a country and shows no estimate and no zero before one is chosen', () => {
    show(props({ needsCountry: true, plan: null, quota: null, prompts: 3 }));
    expect(screen.getByText('Choose a country to check what is tracked.')).toBeInTheDocument();
    expect(screen.queryByText(/answers a month/)).toBeNull();
    expect(screen.queryByText(/Workspace prompts/)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('says the list could not be checked, still adds it, and shows no numbers', () => {
    show(props({ failed: true, plan: null, quota: null }));
    expect(
      screen.getByText('The list could not be checked. You can still add it; the server checks it.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/answers a month/)).toBeNull();
  });

  it('says what asking the new prompts now adds, costs and uses of the day, with the run values', () => {
    const plan = props().plan;
    show(props({ ask: askNowState(plan, 9, { used: 4, limit: 20 }, 150) }));
    expect(
      screen.getByText("Asking them now adds 27 answers, about $0.03, and uses 1 of today's 20 manual runs (4 used)."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/manual runs: /)).toBeNull();
  });

  it('says how many runs a large add is, and with what sizes', () => {
    const plan = planNumbers(estimateOf([engine('chatgpt_web', 180, '0.30', '0.216000')], '0.30'), 180);
    show(props({ plan, prompts: 180, quota: null, ask: askNowState(plan, 180, { used: 4, limit: 20 }, 150) }));
    expect(
      screen.getByText("Asking them now adds 180 answers, about $0.22, and uses 2 of today's 20 manual runs (4 used)."),
    ).toBeInTheDocument();
    expect(screen.getByText('This is 2 manual runs: 150 and 30 prompts.')).toBeInTheDocument();
  });

  it('writes the cost of asking now as under a cent or as no price, and leaves out the day when it is not known', () => {
    const cheap = planNumbers(estimateOf([engine('chatgpt_web', 1, '0.00', '0.001200')], '0.00'), 1);
    const { unmount } = show(props({ plan: cheap, prompts: 1, quota: null, ask: askNowState(cheap, 1, null, 150) }));
    expect(screen.getByText('Asking them now adds 1 answer, under $0.01.')).toBeInTheDocument();
    unmount();
    const none = planNumbers(estimateOf([engine('google_ai_mode', 2, null)], null), 2);
    show(props({ plan: none, prompts: 2, quota: null, ask: askNowState(none, 2, { used: 0, limit: 20 }, 150) }));
    expect(
      screen.getByText(
        "Asking them now adds 2 answers, no price in the price book, and uses 1 of today's 20 manual runs (0 used).",
      ),
    ).toBeInTheDocument();
  });

  it('says why asking now is off when the day has no manual runs left for it, beside the cost, and not when it fits exactly', () => {
    const plan = props().plan;
    const { unmount } = show(props({ ask: askNowState(plan, 9, { used: 20, limit: 20 }, 150) }));
    expect(screen.getByText("Today's 20 manual runs are used. They reset at 00:00 UTC.")).toBeInTheDocument();
    // The cost of asking stays, so the person sees what is off
    expect(screen.getByText(/Asking them now adds 27 answers/)).toBeInTheDocument();
    unmount();
    const large = planNumbers(estimateOf([engine('chatgpt_web', 180, '0.30', '0.216000')], '0.30'), 180);
    const second = show(
      props({ plan: large, prompts: 180, quota: null, ask: askNowState(large, 180, { used: 19, limit: 20 }, 150) }),
    );
    expect(
      screen.getByText('This ask needs 2 manual runs and 1 is left today. They reset at 00:00 UTC.'),
    ).toBeInTheDocument();
    second.unmount();
    // Two runs of the two left: it fits
    show(props({ plan: large, prompts: 180, quota: null, ask: askNowState(large, 180, { used: 18, limit: 20 }, 150) }));
    expect(screen.queryByText(/reset at 00:00 UTC/)).toBeNull();
  });

  it('gives a slot below the ask line to the control that asks', () => {
    show(
      props({
        ask: askNowState(props().plan, 9, { used: 4, limit: 20 }, 150),
        askSlot: <button type="button">Ask them now</button>,
      }),
    );
    expect(screen.getByRole('button', { name: 'Ask them now' })).toBeInTheDocument();
  });

  it('says scheduled answers are paused rather than inventing a date, and names the date when a schedule runs', () => {
    const { unmount } = show(props({ nextRun: { kind: 'paused' } }));
    expect(
      screen.getByText('Scheduled answers are paused, so these are asked only when someone asks them now.'),
    ).toBeInTheDocument();
    unmount();
    show(props({ nextRun: { kind: 'at', at: '2026-11-19T00:00:00Z', timeZone: 'UTC' } }));
    expect(screen.getByText('First scheduled answers: Nov 19, 2026 · 00:00 UTC.')).toBeInTheDocument();
  });

  it('gives the reason the add is off in the block, for a line that cannot be added and for tracked lines', () => {
    const { unmount } = show(props({ blocked: 'cannotAdd' }));
    expect(screen.getByText('Some lines cannot be added. Fix or remove them first.')).toBeInTheDocument();
    unmount();
    show(props({ blocked: 'allTracked', prompts: 0, plan: null, quota: quotaState({ limit: 150, used: 24 }, 0, 0) }));
    expect(screen.getByText('Every line is already tracked.')).toBeInTheDocument();
    // Nothing is created, so there is no estimate and no ask of nothing
    expect(screen.queryByText(/answers a month/)).toBeNull();
  });

  it('asks for prompts before there is a line, and has the id the button points at', () => {
    show(props({ hasLines: false, plan: null, quota: null, prompts: 0 }));
    expect(screen.getByText('Type or paste prompts to see what the add takes and costs.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'What this add takes' })).toHaveAttribute('id', 'plan');
  });

  it('has no accessibility violations with every line shown', async () => {
    const plan = props().plan;
    const { container } = show(
      props({
        checking: true,
        ask: askNowState(plan, 9, { used: 4, limit: 20 }, 150),
        nextRun: { kind: 'paused' },
        quota: quotaState({ limit: 150, used: 141 }, 12, 0),
        blocked: 'overQuota',
      }),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the plan summary of the phone footer', () => {
  const render = (text: string | null): ReactElement => <PlanSummary text={text} />;

  it('shows one line, and nothing without one', () => {
    const { rerender } = renderWithProviders(render('9 prompts, about $0.09 a month, 140 of 150'));
    expect(screen.getByText('9 prompts, about $0.09 a month, 140 of 150')).toBeInTheDocument();
    expect(screen.getByText('9 prompts, about $0.09 a month, 140 of 150')).toHaveClass('sm:hidden');
    rerender(render(null));
    expect(screen.queryByText(/prompts/)).toBeNull();
  });
});
