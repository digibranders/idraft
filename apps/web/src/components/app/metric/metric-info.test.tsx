import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MetricInfo, type MetricInfoProps } from './metric-info';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const FULL: MetricInfoProps = {
  name: 'Mention rate',
  definition: 'The share of valid answers that name your brand.',
  formula: 'Answers that name the brand divided by valid answers.',
  denominatorText: '250 prompts, 1,800 valid answers',
  aggregation: 'prompt_weighted',
  methodVersion: 4,
  onOpenStatistics: () => undefined,
  methodologyHref: '/methodology/mention-rate',
};

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'About Mention rate' });

/** The text of the open popover's lines in document order. */
function lines(): string[] {
  const popup = screen.getByRole('dialog');
  return Array.from(popup.querySelectorAll('p, button, a')).map((node) => node.textContent ?? '');
}

describe('MetricInfo', () => {
  it('is a button named About {metric}', () => {
    renderWithProviders(<MetricInfo {...FULL} />);
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens with the content in the fixed order and Methodology last', async () => {
    const { user } = renderWithProviders(<MetricInfo {...FULL} />);
    await user.click(trigger());
    await screen.findByRole('dialog', { name: 'Mention rate' });
    expect(lines()).toEqual([
      'The share of valid answers that name your brand.',
      'Formula: Answers that name the brand divided by valid answers.',
      'Sample: 250 prompts, 1,800 valid answers',
      'Prompt-weighted: every prompt counts once.',
      'Method version 4',
      'Open statistics',
      'Methodology',
    ]);
    expect(screen.getByRole('link', { name: 'Methodology' })).toHaveAttribute('href', '/methodology/mention-rate');
  });

  it('leaves out lines it was not given', async () => {
    const { user } = renderWithProviders(
      <MetricInfo
        name="Mention rate"
        definition="The share of valid answers that name your brand."
        formula="Answers that name the brand divided by valid answers."
        methodologyHref="/methodology/mention-rate"
      />,
    );
    await user.click(trigger());
    await screen.findByRole('dialog');
    expect(lines()).toEqual([
      'The share of valid answers that name your brand.',
      'Formula: Answers that name the brand divided by valid answers.',
      'Methodology',
    ]);
  });

  it('offers Open statistics only for AI rates and calls back', async () => {
    const onOpenStatistics = vi.fn();
    const { user, unmount } = renderWithProviders(<MetricInfo {...FULL} onOpenStatistics={onOpenStatistics} />);
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: 'Open statistics' }));
    expect(onOpenStatistics).toHaveBeenCalledTimes(1);
    unmount();

    const second = renderWithProviders(<MetricInfo {...FULL} onOpenStatistics={undefined} />);
    await second.user.click(trigger());
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'Open statistics' })).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the button', async () => {
    const { user } = renderWithProviders(<MetricInfo {...FULL} />);
    await user.click(trigger());
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
  });

  it('is axe clean, closed and open', async () => {
    const { container, user } = renderWithProviders(<MetricInfo {...FULL} />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(trigger());
    await screen.findByRole('dialog');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
