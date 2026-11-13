import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { DETECTABLE, cell, engineOf, projectEngine } from './compare/change-test-data';
import { ComparedWindowProvider } from './compare/compared-window';
import type { PromptCounts } from './inspector-reads';
import { InspectorStrip } from './inspector-strip';
import { promptRow } from './topics-by-engine/cells-fixtures';
import type { EngineSummary, MetricCell } from '@/lib/api/types';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const ENGINES = [projectEngine('chatgpt_web'), projectEngine('gemini_web')];
const WINDOW = { from: '2026-09-18', to: '2026-10-15' };

const countsOf = (engines: readonly EngineSummary[], status: PromptCounts['status'] = 'ready'): PromptCounts => ({
  status,
  row: promptRow('p1', 'What is the best CRM?', [], engines),
  entities: [],
  brandedIncluded: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

function Strip({ counts }: { counts: PromptCounts }): ReactElement {
  return (
    <ComparedWindowProvider value={WINDOW}>
      <InspectorStrip engines={ENGINES} counts={counts} noCountsReason="No counts" />
    </ComparedWindowProvider>
  );
}

const render = (counts: PromptCounts, searchParams = ''): ProvidedRender =>
  renderWithProviders(<Strip counts={counts} />, { searchParams });

/** The value cell of an item: with a tooltip it is the tab stop that holds it. */
const itemOf = (label: string): HTMLElement => {
  const item = screen.getByText(label).closest('dt')?.parentElement?.querySelector('dd');
  if (item === null || item === undefined) throw new Error(`The ${label} item is missing`);
  return item;
};
const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

const [NOW_UP, BEFORE_UP]: readonly [MetricCell, MetricCell] = DETECTABLE;
const detectable = (): EngineSummary[] => [
  engineOf('chatgpt_web', NOW_UP, BEFORE_UP),
  engineOf('gemini_web', cell(31, 60), cell(27, 60)),
];

describe('the prompt inspector strip: change per engine', () => {
  it('shows the change of an engine item, coloured only for the detectable one, with the real Delta classes', () => {
    render(countsOf(detectable()));
    const chatgpt = itemOf('ChatGPT mention');
    expect(within(chatgpt).getByText('+30.0 pts')).toHaveClass('text-positive-text');
    expect(chatgpt).toHaveTextContent('up 30.0 pts, detectable, interim test');
    const gemini = itemOf('Gemini mention');
    const delta = within(gemini).getByText('+6.7 pts');
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(delta).not.toHaveClass('text-positive-text');
    expect(gemini).toHaveTextContent('within normal variation, interim test');
  });

  it('holds the previous value with its answers, the window and the verdict in the tooltip, a tab stop', async () => {
    const { user } = render(countsOf(detectable()));
    const chatgpt = itemOf('ChatGPT mention');
    expect(chatgpt).toHaveAttribute('tabindex', '0');
    await user.hover(chatgpt);
    await waitFor(() => expect(tooltip()).toHaveTextContent('Previous 20%, 12 of 60 answers'));
    expect(tooltip()).toHaveTextContent('Previous period: Sep 18 to Oct 15');
    expect(tooltip()).toHaveTextContent('Detectable change');
    expect(tooltip()).toHaveTextContent('Interim test');
    // The same style as the other tips: a colon before the window, and no full stop at the end
    expect(tooltip()?.textContent).not.toMatch(/\.$/);
  });

  it('says within normal variation in the tooltip of an undetectable change', async () => {
    const { user } = render(countsOf(detectable()));
    await user.hover(itemOf('Gemini mention'));
    await waitFor(() => expect(tooltip()).toHaveTextContent('Previous 45%, 27 of 60 answers'));
    expect(tooltip()).toHaveTextContent('Within normal variation');
  });

  it('names a change that was not tested instead of leaving the reason out', async () => {
    // The rate rose from 30% to 63% over prompt weighted cells while the pooled answers fell: no claim is made
    const weighted = engineOf(
      'chatgpt_web',
      { value: 0.625, numerator: 2.5, denominator: 4, n_observations: 12, pooled: { successes: 3, trials: 12 } },
      { value: 0.3, numerator: 1.2, denominator: 4, n_observations: 20, pooled: { successes: 12, trials: 20 } },
    );
    const { user } = render(countsOf([weighted]));
    const item = itemOf('ChatGPT mention');
    expect(item.textContent).not.toMatch(/detectable|within normal variation|interim test/);
    await user.hover(item);
    await waitFor(() => expect(tooltip()).toHaveTextContent('This change is not tested because'));
  });

  it('leaves out the change of a rate over fewer than 4 answers, and its tip', () => {
    render(countsOf([engineOf('chatgpt_web', cell(1, 3), cell(12, 60))]));
    const item = itemOf('ChatGPT mention');
    expect(item.textContent).not.toMatch(/pts/);
    expect(item).not.toHaveAttribute('tabindex');
  });

  it('leaves out the change from a previous period of fewer than 4 answers: unknown is not 0', () => {
    render(countsOf([engineOf('chatgpt_web', cell(30, 60), cell(1, 3))]));
    const item = itemOf('ChatGPT mention');
    expect(item.textContent).not.toMatch(/pts/);
    expect(item).not.toHaveAttribute('tabindex');
  });

  it('leaves out the change of an engine with no previous period', () => {
    render(countsOf([engineOf('chatgpt_web', cell(30, 60), null)]));
    expect(itemOf('ChatGPT mention').textContent).not.toMatch(/pts/);
  });

  it('keeps the Citation rate item as it was, with no change', () => {
    render(countsOf(detectable()));
    const citation = itemOf('Citation rate');
    expect(citation.textContent).not.toMatch(/pts/);
    expect(citation).not.toHaveAttribute('tabindex');
  });

  it('draws no change while loading', () => {
    render(countsOf(detectable(), 'loading'));
    expect(screen.queryByText('+30.0 pts')).toBeNull();
  });

  it('is as before without comparison: no change, no tooltip', () => {
    render(countsOf(detectable()), '?cmp=off');
    const chatgpt = itemOf('ChatGPT mention');
    expect(chatgpt.textContent).not.toMatch(/pts/);
    expect(chatgpt).not.toHaveAttribute('tabindex');
  });

  it('has no accessibility violation with a change', async () => {
    const { container } = render(countsOf(detectable()));
    expect(await axe(container)).toHaveNoViolations();
  });
});
