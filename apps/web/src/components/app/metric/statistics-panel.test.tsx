import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatisticsPanel, type StatisticsContent, type StatisticsState } from './statistics-panel';
import { Button } from '@/components/ui/button';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const DATA: StatisticsContent = {
  metricName: 'Mention rate',
  engine: { code: 'chatgpt_web', name: 'ChatGPT' },
  scopeText: 'core panel, 28 days',
  definition: 'The share of valid answers that name your brand.',
  estimate: {
    value: 0.34,
    numerator: 612,
    denominator: 1800,
    noun: 'observations',
    prompts: 250,
    observationWeighted: 0.352,
    insufficient: null,
  },
  interval: { low: 0.312, high: 0.369, methodText: 'Normal interval over prompts, fixed panel' },
  comparison: {
    delta: { value: 0.018, unit: 'points', polarity: 'higher_is_better', isDetectable: false },
    test: 'paired',
    periodText: 'Aug 4 to Aug 31',
    designText: 'Paired: the same 243 prompts in both periods',
    intervalText: '95% interval -1.1 to +4.6 pts',
    gained: 41,
    lost: 19,
  },
  boundaries: [{ id: 'extractor-v4', text: 'Extractor v3 to v4 on Sep 14' }],
};

const ERROR_ID = { id: 'req_01ABC', label: 'Error ID req_01ABC', copyLabel: 'Copy error ID', copiedLabel: 'Copied' };

function ready(overrides: Partial<StatisticsContent> = {}): StatisticsState {
  return { kind: 'ready', data: { ...DATA, ...overrides } };
}

function render(state: StatisticsState, extra: Partial<Parameters<typeof StatisticsPanel>[0]> = {}) {
  return renderWithProviders(<StatisticsPanel state={state} placement="inspector-region" {...extra} />);
}

describe('StatisticsPanel', () => {
  it('shows the four sections of a ready panel', () => {
    render(ready());
    for (const name of ['Estimate', 'Uncertainty', 'Period comparison', 'Version boundaries']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
    expect(screen.getByText('The share of valid answers that name your brand.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '95% interval 31.2% to 36.9%' })).toBeInTheDocument();
    expect(screen.getByText('Normal interval over prompts, fixed panel')).toBeInTheDocument();
  });

  it('every percent shows its count', () => {
    const { container } = render(ready());
    const percents = Array.from(container.querySelectorAll('span')).filter((node) =>
      /^\d+(\.\d+)?%$/.test(node.textContent),
    );
    // The prompt-weighted and the observation-weighted estimate
    expect(percents).toHaveLength(2);
    for (const percent of percents) {
      expect(percent.parentElement?.querySelector('[data-slot="sample-count"]')).not.toBeNull();
    }
    expect(screen.getByText('250 prompts')).toBeInTheDocument();
  });

  it('shows the count beside the one percent of the single estimate layout', () => {
    const { container } = render(ready({ estimate: { ...DATA.estimate, observationWeighted: null } }));
    const percents = Array.from(container.querySelectorAll('span')).filter((node) =>
      /^\d+(\.\d+)?%$/.test(node.textContent),
    );
    expect(percents).toHaveLength(1);
    expect(percents[0]).toHaveTextContent('34.0%');
    // The count sits in the same line as the percent, not further down with the prompt count
    expect(percents[0]?.parentElement?.querySelector('[data-slot="sample-count"]')).toHaveTextContent('612 of 1,800');
  });

  it('unknown is never zero', () => {
    const insufficient = render(
      ready({
        estimate: { ...DATA.estimate, value: null, observationWeighted: null, insufficient: { valid: 3, required: 7 } },
        interval: null,
        comparison: null,
      }),
    );
    expect(screen.getByText('Insufficient data')).toBeInTheDocument();
    expect(screen.getByText('3 valid answers; 7 needed')).toBeInTheDocument();
    expect(insufficient.container).not.toHaveTextContent('%');
    insufficient.unmount();

    // A hostile payload: a value next to an insufficient flag is still not drawn
    const hostile = render(
      ready({
        estimate: { ...DATA.estimate, insufficient: { valid: 3, required: 7 } },
        interval: null,
        comparison: null,
      }),
    );
    expect(screen.getByText('Insufficient data')).toBeInTheDocument();
    expect(hostile.container).not.toHaveTextContent('%');
    hostile.unmount();

    const unknown = render(
      ready({
        estimate: { ...DATA.estimate, value: null, numerator: null, denominator: null, observationWeighted: null },
        interval: null,
        comparison: null,
      }),
    );
    expect(unknown.container).not.toHaveTextContent('%');
    expect(unknown.container).not.toHaveTextContent(/(^|\D)0(\D|$)/);
    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);
  });

  it('colours a change only when it is detectable', () => {
    const quiet = render(ready());
    expect(screen.getByText('+1.8 pts')).toHaveClass('text-foreground-secondary');
    expect(screen.getByText('+1.8 pts')).not.toHaveClass('text-positive-text');
    expect(screen.getByText('Result: within normal variation')).toBeInTheDocument();
    quiet.unmount();

    const detectable = DATA.comparison;
    if (detectable === null) throw new Error('The fixture has a comparison');
    render(ready({ comparison: { ...detectable, delta: { ...detectable.delta, isDetectable: true } } }));
    expect(screen.getByText('+1.8 pts')).toHaveClass('text-positive-text');
    expect(screen.getByText('Result: detectable change')).toBeInTheDocument();
  });

  it('says what the comparison is made of', () => {
    render(ready());
    expect(screen.getByText('Compared with Aug 4 to Aug 31')).toBeInTheDocument();
    expect(screen.getByText('Paired: the same 243 prompts in both periods')).toBeInTheDocument();
    expect(screen.getByText('95% interval -1.1 to +4.6 pts')).toBeInTheDocument();
    expect(screen.getByText('Gained in 41 prompts, lost in 19')).toBeInTheDocument();
  });

  it('claims nothing about a change that has no detectability test', () => {
    const base = DATA.comparison;
    if (base === null) throw new Error('The fixture has a comparison');
    render(ready({ comparison: { ...base, delta: { ...base.delta, isDetectable: null } } }));
    expect(screen.queryByText(/^Result:/)).not.toBeInTheDocument();
  });

  it('says there is no comparison, and no version change, in words', () => {
    render(ready({ comparison: null, boundaries: [] }));
    expect(screen.getByText('No earlier period to compare with in this view')).toBeInTheDocument();
    expect(screen.getByText('No version change in this window')).toBeInTheDocument();
  });

  it('says why there is no interval', () => {
    render(ready({ interval: null }));
    expect(screen.getByText('No interval: the estimate has no spread to report for this view')).toBeInTheDocument();
  });

  it('names the one engine it describes', () => {
    render(ready());
    expect(screen.getByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getAllByText('ChatGPT')).toHaveLength(1);
    expect(screen.getByRole('presentation')).toHaveAttribute('alt', '');
    expect(screen.getByText('core panel, 28 days')).toBeInTheDocument();
  });

  it('labels the interim test', () => {
    const base = DATA.comparison;
    if (base === null) throw new Error('The fixture has a comparison');
    const paired = render(ready());
    expect(screen.queryByText(/Interim test/)).not.toBeInTheDocument();
    paired.unmount();
    render(ready({ comparison: { ...base, test: 'interim' } }));
    expect(screen.getByText('Interim test: unpaired, may understate uncertainty')).toBeInTheDocument();
  });

  it('draws skeletons while loading and keeps data while refetching', () => {
    const loading = render({ kind: 'loading' });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
    expect(loading.container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(loading.container.querySelector('[data-slot="statistics-panel"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading')).toBeInTheDocument();
    loading.unmount();

    const refetching = render({ kind: 'refetching', data: DATA });
    const panel = refetching.container.querySelector('[data-slot="statistics-panel"]');
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(panel).not.toHaveClass('opacity-50');
    expect(screen.getByText('34.0%')).toBeInTheDocument();
    expect(refetching.container.querySelector('[data-slot="skeleton"]')).toBeNull();
    refetching.unmount();

    const settled = render(ready());
    expect(settled.container.querySelector('[data-slot="statistics-panel"]')).not.toHaveAttribute('aria-busy');
  });

  it('offers Retry on error', async () => {
    const onRetry = vi.fn();
    const { user } = render({
      kind: 'error',
      title: 'Could not load statistics',
      reason: 'The server returned an error. Your filters are unchanged.',
      onRetry,
      retrying: false,
      errorId: ERROR_ID,
    });
    expect(screen.getByText('Could not load statistics')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('explains an empty panel, with its action', () => {
    render({
      kind: 'empty',
      reason: 'No answers were collected for this engine in the last 28 days.',
      action: <Button variant="secondary">Change dates</Button>,
    });
    expect(screen.getByText('No statistics to show')).toBeInTheDocument();
    expect(screen.getByText('No answers were collected for this engine in the last 28 days.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change dates' })).toBeInTheDocument();
  });

  it('shows partial and stale banners above the sections', () => {
    render({
      kind: 'ready',
      data: DATA,
      partial: 'Two of the 250 prompts have no answers yet.',
      stale: 'Last updated 3 hours ago.',
    });
    expect(screen.getByText('Partial data:')).toBeInTheDocument();
    expect(screen.getByText('Two of the 250 prompts have no answers yet.')).toBeInTheDocument();
    expect(screen.getByText('Last updated 3 hours ago.')).toBeInTheDocument();
    const banners = document.querySelectorAll('[data-slot="banner"]');
    expect(banners).toHaveLength(2);
    const firstSection = screen.getByRole('heading', { level: 3, name: 'Estimate' });
    expect(banners[1]?.compareDocumentPosition(firstSection)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('is not a dialog and traps no focus', async () => {
    const onBack = vi.fn();
    const { user } = renderWithProviders(
      <>
        <button type="button">Before</button>
        <StatisticsPanel state={ready()} placement="inspector-region" backTo={{ label: 'prompt best crm', onBack }} />
        <button type="button">After</button>
      </>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Before' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Back to prompt best crm' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  it('goes back to the record, in every state', async () => {
    const onBack = vi.fn();
    const { user } = render({ kind: 'loading' }, { backTo: { label: 'prompt best crm', onBack } });
    await user.click(screen.getByRole('button', { name: 'Back to prompt best crm' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('is a heading only in the region, where it replaces the record', () => {
    const region = render(ready());
    expect(screen.getByRole('heading', { level: 2, name: 'Mention rate' })).toBeInTheDocument();
    region.unmount();
    renderWithProviders(<StatisticsPanel state={ready()} placement="inspector-tab" />);
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.getByText('Mention rate')).toBeInTheDocument();
  });

  it('is axe clean in every state', async () => {
    const states: readonly StatisticsState[] = [
      { kind: 'loading' },
      ready(),
      { kind: 'refetching', data: DATA },
      { kind: 'ready', data: DATA, partial: 'Two prompts have no answers yet.', stale: 'Last updated 3 hours ago.' },
      ready({
        estimate: { ...DATA.estimate, value: null, observationWeighted: null, insufficient: { valid: 3, required: 7 } },
        interval: null,
        comparison: null,
        boundaries: [],
      }),
      { kind: 'empty', reason: 'No answers were collected in the last 28 days.' },
      {
        kind: 'error',
        title: 'Could not load statistics',
        reason: 'The server returned an error.',
        onRetry: () => undefined,
        retrying: false,
        errorId: ERROR_ID,
      },
    ];
    for (const state of states) {
      const { container, unmount } = render(state, { backTo: { label: 'prompt best crm', onBack: () => undefined } });
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
    const tab = renderWithProviders(<StatisticsPanel state={ready()} placement="inspector-tab" />);
    expect(await axe(tab.container)).toHaveNoViolations();
  });

  it('keeps its sections inside their own cards', () => {
    render(ready());
    const estimate = screen.getByRole('heading', { level: 3, name: 'Estimate' }).closest('section');
    expect(estimate).not.toBeNull();
    if (estimate !== null) expect(within(estimate).getByText('34.0%')).toBeInTheDocument();
  });
});
