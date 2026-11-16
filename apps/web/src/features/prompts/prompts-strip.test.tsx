import { screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ComparedWindowProvider } from './compare/compared-window';
import { DETECTABLE, WITHIN, cell, engineOf, promptsOf, projectEngine } from './compare/change-test-data';
import { PromptsStrip } from './prompts-strip';
import type { StripPrompt } from '@/lib/rates/strip-model';
import { axe } from '@/test/axe';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const ENGINES = [projectEngine('chatgpt_web')];
const WINDOW = { from: '2026-09-18', to: '2026-10-15' };
/** The page opens without a comparison: a change is drawn only when the address asks for it. */
const ON = '?cmp=previous';

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
  searchParams = ON,
  status?: 'loading' | 'ready' | 'refetching',
): ProvidedRender =>
  renderWithProviders(<Strip prompts={prompts} {...(status === undefined ? {} : { status })} />, { searchParams });

/** The chip of an engine: its value is the tab stop that holds the tooltip. */
const chipOf = (label: string): HTMLElement => {
  const term = within(screen.getByRole('group', { name: 'Summary of the prompts in view' }))
    .getAllByRole('term')
    .find((entry) => entry.textContent === label);
  const chip = term?.parentElement;
  if (chip === null || chip === undefined) throw new Error(`The ${label} chip is missing`);
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
    await waitFor(() => expect(tooltip()).toHaveTextContent('This change is not tested because'));
    expect(tooltip()?.textContent).not.toMatch(/weighted|pooled answers do not agree/);
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
    expect(tooltip()).toHaveTextContent('Previous period: Sep 18 to Oct 15');
    expect(tooltip()).toHaveTextContent('Detectable change');
    expect(tooltip()).toHaveTextContent('Interim test');
    // The same style as the cell tips: a colon before the window, and no full stop at the end
    expect(tooltip()?.textContent).not.toMatch(/\.$/);
    // What the chip said before the change is still there
    expect(tooltip()).toHaveTextContent('Mentioned: 30 of 60 answers');
  });

  it('shows no change without comparison, which is how the page opens: the same text and tooltip', async () => {
    const { user } = render(twice(DETECTABLE), '');
    const chip = chipOf('ChatGPT');
    expect(chip.textContent).not.toMatch(/pts/);
    await user.hover(chip);
    await waitFor(() => expect(tooltip()).toHaveTextContent('Mentioned: 30 of 60 answers'));
    expect(tooltip()).not.toHaveTextContent('Previous');
  });

  it('keeps its changes while refetching and says it is busy', () => {
    render(twice(DETECTABLE), ON, 'refetching');
    expect(screen.getByRole('group', { name: 'Summary of the prompts in view' })).toHaveAttribute('aria-busy', 'true');
    expect(within(chipOf('ChatGPT')).getByText('+30.0 pts')).toBeInTheDocument();
  });

  it('draws no change while loading', () => {
    render(twice(DETECTABLE), ON, 'loading');
    expect(screen.queryByText('+30.0 pts')).toBeNull();
  });

  it('has no accessibility violation with a change', async () => {
    const { container } = render(twice(DETECTABLE));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PromptsStrip slots', () => {
  const group = (): HTMLElement => screen.getByRole('group', { name: 'Summary of the prompts in view' });
  const termsOf = (): string[] =>
    within(group())
      .getAllByRole('term')
      .map((term) => term.textContent ?? '');

  it('always holds the prompts and the four platforms, in the order of the platforms', () => {
    render(twice(DETECTABLE));
    expect(termsOf()).toEqual(['Prompts', 'ChatGPT', 'Gemini', 'Google AI Mode', 'Google AI Overview']);
  });

  it('shows the AI visibility, named or cited, with the counts of every rate in the tooltip', async () => {
    const { user } = render(twice(DETECTABLE));
    const chip = chipOf('ChatGPT');
    expect(chip).toHaveTextContent('50%');
    await user.hover(chip);
    await waitFor(() => expect(tooltip()).toHaveTextContent('AI visibility (named or cited): 30 of 60 answers'));
    expect(tooltip()).toHaveTextContent('Mentioned: 30 of 60 answers');
  });

  it('counts a cited answer in the visibility but not in the mention rate', () => {
    const outcomes = {
      cited_only: cell(20, 60),
      mentioned_and_cited: cell(10, 60),
      mentioned_only: cell(10, 60),
      neither: cell(20, 60),
    };
    const prompts: StripPrompt[] = [
      { topic_term_ids: [], engines: [{ ...engineOf('chatgpt_web', cell(20, 60), null), outcomes }] },
    ];
    render(prompts);
    expect(chipOf('ChatGPT')).toHaveTextContent('67%');
  });

  it('puts the platforms outside the select on a quiet ground, with a note for a screen reader', () => {
    renderWithProviders(
      <PromptsStrip
        prompts={twice(DETECTABLE)}
        engines={[projectEngine('chatgpt_web'), projectEngine('gemini_web')]}
        inView={['chatgpt_web']}
        topics={1}
        status="ready"
        countsFailed={false}
      />,
    );
    const slot = (label: string): HTMLElement | null => chipOf(label).parentElement;
    expect(slot('ChatGPT')).not.toHaveClass('bg-surface-subtle');
    expect(slot('Gemini')).toHaveClass('bg-surface-subtle');
    expect(chipOf('Gemini')).toHaveTextContent('not in the Platform filter');
  });

  it('says a platform that is not on is not collected, never a number', async () => {
    const { user } = render(twice(DETECTABLE));
    const chip = chipOf('Google AI Overview');
    expect(chip).toHaveTextContent('n/a');
    await user.hover(chip);
    await waitFor(() =>
      expect(tooltip()).toHaveTextContent('Google AI Overview is not collected for this project yet'),
    );
  });

  it('has an info button that says what the percentages are and how they are counted', async () => {
    const { user } = render(twice(DETECTABLE));
    await user.click(screen.getByRole('button', { name: 'About AI visibility' }));
    const popover = await screen.findByRole('dialog', { name: 'About AI visibility' });
    expect(popover).toHaveTextContent("how often that platform’s answers mention or cite your brand");
    expect(popover).toHaveTextContent('Each prompt counts once');
  });
});
