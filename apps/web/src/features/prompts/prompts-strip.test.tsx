import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ComparedWindowProvider } from './compare/compared-window';
import { DETECTABLE, WITHIN, cell, promptsOf, projectEngine } from './compare/change-test-data';
import { PromptsStrip } from './prompts-strip';
import type { StripPrompt } from '@/lib/rates/strip-model';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const ENGINES = [projectEngine('chatgpt_web')];
const WINDOW = { from: '2026-09-18', to: '2026-10-15' };

/** Two prompts that each answered as the pair says, so the chip is the pair as a rate over 60 answers. */
const twice = (pair: readonly [ReturnType<typeof cell>, ReturnType<typeof cell>]): StripPrompt[] => {
  const half = (value: ReturnType<typeof cell>): ReturnType<typeof cell> =>
    cell(Math.round(value.numerator / 2), Math.round(value.denominator / 2));
  return promptsOf([half(pair[0]), half(pair[1])], [half(pair[0]), half(pair[1])]);
};

function Strip({
  prompts,
  status = 'ready',
}: {
  prompts: readonly StripPrompt[];
  status?: 'loading' | 'ready' | 'refetching';
}): ReactElement {
  return (
    <ComparedWindowProvider value={WINDOW}>
      <PromptsStrip prompts={prompts} engines={ENGINES} topics={1} status={status} countsFailed={false} />
    </ComparedWindowProvider>
  );
}

const render = (
  prompts: readonly StripPrompt[],
  searchParams = '',
  status?: 'loading' | 'ready' | 'refetching',
): ProvidedRender =>
  renderWithProviders(<Strip prompts={prompts} {...(status === undefined ? {} : { status })} />, { searchParams });

/** The chip of an engine: its value is the tab stop that holds the tooltip. */
const chipOf = (label: string): HTMLElement => {
  const term = screen.getByText(label, { selector: 'dt' });
  const chip = term.parentElement;
  if (chip === null) throw new Error(`The ${label} chip is missing`);
  return within(chip).getByRole('definition');
};
const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

describe('PromptsStrip change', () => {
  it('shows the change coloured when it is detectable, with the real Delta classes', () => {
    render(twice(DETECTABLE));
    const chip = chipOf('ChatGPT');
    expect(within(chip).getByText('+30.0 pts')).toHaveClass('text-positive-text');
    expect(chip).toHaveTextContent('up 30.0 pts, detectable, interim test');
  });

  it('keeps a change within normal variation neutral', () => {
    render(twice(WITHIN));
    const chip = chipOf('ChatGPT');
    const delta = within(chip).getByText(/pts$/);
    expect(delta).toHaveClass('text-foreground-secondary');
    expect(delta).not.toHaveClass('text-positive-text');
    expect(chip).toHaveTextContent('within normal variation, interim test');
  });

  it('makes no claim when the weighted points and the pooled answers move apart, says why, and stays neutral', async () => {
    // The prompt weighted rate rose from 30% to 63% while the answers pooled fell from 57% to 36%
    const { user } = render(promptsOf([cell(2, 2), cell(0, 1)], [cell(3, 12), cell(12, 20)]));
    const chip = chipOf('ChatGPT');
    expect(within(chip).getByText('+32.5 pts')).toHaveClass('text-foreground-secondary');
    expect(chip).toHaveTextContent('up 32.5 pts');
    expect(chip.textContent).not.toMatch(/detectable|within normal variation|interim test/);
    await user.hover(chip);
    await waitFor(() => expect(tooltip()).toHaveTextContent('No test is told for this change'));
    expect(tooltip()?.textContent).not.toMatch(/Detectable change|Within normal variation|Interim test/);
  });

  it('shows no change for a chip under 4 answers in either period', () => {
    render(promptsOf([cell(1, 3), cell(12, 60)]));
    expect(chipOf('ChatGPT').textContent).not.toMatch(/pts/);
    expect(chipOf('ChatGPT')).toHaveTextContent('3 answers');
  });

  it('shows no change for a chip whose prompts have no previous period', () => {
    render(promptsOf([cell(30, 60), null]));
    expect(chipOf('ChatGPT').textContent).not.toMatch(/pts/);
  });

  it('holds the previous figure with its answers and prompts, and the window, in the tooltip', async () => {
    const { user } = render(twice(DETECTABLE));
    await user.hover(chipOf('ChatGPT'));
    await waitFor(() => expect(tooltip()).toHaveTextContent('Previous 20%, 12 of 60 answers, over 2 prompts'));
    expect(tooltip()).toHaveTextContent('Previous period, Sep 18 to Oct 15');
    expect(tooltip()).toHaveTextContent('Detectable change');
    expect(tooltip()).toHaveTextContent('Interim test');
    // What the chip said before the change is still there
    expect(tooltip()).toHaveTextContent('Mentioned: 30 of 60 answers');
  });

  it('is as before without comparison: no change, the same text and tooltip', async () => {
    const { user } = render(twice(DETECTABLE), '?cmp=off');
    const chip = chipOf('ChatGPT');
    expect(chip.textContent).not.toMatch(/pts/);
    await user.hover(chip);
    await waitFor(() => expect(tooltip()).toHaveTextContent('Mentioned: 30 of 60 answers'));
    expect(tooltip()).not.toHaveTextContent('Previous');
  });

  it('keeps its changes while refetching and says it is busy', () => {
    render(twice(DETECTABLE), '', 'refetching');
    expect(screen.getByRole('group', { name: 'Summary of the prompts in view' })).toHaveAttribute('aria-busy', 'true');
    expect(within(chipOf('ChatGPT')).getByText('+30.0 pts')).toBeInTheDocument();
  });

  it('draws no change while loading', () => {
    render(twice(DETECTABLE), '', 'loading');
    expect(screen.queryByText('+30.0 pts')).toBeNull();
  });

  it('has no accessibility violation with a change', async () => {
    const { container } = render(twice(DETECTABLE));
    expect(await axe(container)).toHaveNoViolations();
  });
});
