import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FanoutStrip, type FanoutStripProps } from './fanout-strip';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const props = (over: Partial<FanoutStripProps> = {}): FanoutStripProps => ({
  meta: { answers: 12, answers_with_fanout: 9 },
  listed: 14,
  engine: 'ChatGPT',
  minSupport: 2,
  status: 'ready',
  ...over,
});

const strip = (): HTMLElement => screen.getByRole('group', { name: 'Fan-out summary' });

/** The definition (value and context) that belongs to a label. */
function cell(label: string): HTMLElement {
  const term = within(strip()).getByText(label).closest('dt');
  const definition = term?.nextElementSibling;
  if (!(definition instanceof HTMLElement)) throw new Error(`No value for ${label}`);
  return definition;
}

describe('FanoutStrip', () => {
  it('shows F1 as a percent with its count in the context', () => {
    renderWithProviders(<FanoutStrip {...props()} />);
    expect(cell('Answers with fan-out')).toHaveTextContent('75.0%');
    expect(cell('Answers with fan-out')).toHaveTextContent('9 of 12 ChatGPT answers');
  });

  it('puts the same counts in the tip a keyboard reaches', async () => {
    const { user } = renderWithProviders(<FanoutStrip {...props()} />);
    await user.tab();
    expect(cell('Answers with fan-out')).toHaveFocus();
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
        '9 of 12 valid ChatGPT answers issued at least one query (docs/16 F1).',
      ),
    );
  });

  it('shows a real zero as 0.0% with its count when answers exist', () => {
    renderWithProviders(<FanoutStrip {...props({ meta: { answers: 12, answers_with_fanout: 0 } })} />);
    expect(cell('Answers with fan-out')).toHaveTextContent('0.0%');
    expect(cell('Answers with fan-out')).toHaveTextContent('0 of 12 ChatGPT answers');
  });

  it('reads n/a with the reason, and no percent, when there is no answer', async () => {
    const { user } = renderWithProviders(<FanoutStrip {...props({ meta: { answers: 0, answers_with_fanout: 0 } })} />);
    const value = cell('Answers with fan-out');
    expect(value).toHaveTextContent('n/a');
    expect(value).not.toHaveTextContent('%');
    expect(strip()).not.toHaveTextContent(/0 of 0/);
    await user.tab();
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(
        'No valid ChatGPT answer in this window.',
      ),
    );
  });

  it('names the minimum under Queries listed', () => {
    renderWithProviders(<FanoutStrip {...props({ listed: 1204, minSupport: 5 })} />);
    expect(cell('Queries listed')).toHaveTextContent('1,204');
    expect(cell('Queries listed')).toHaveTextContent('issued by at least 5 answers');
  });

  it('names the minimum in the singular', () => {
    renderWithProviders(<FanoutStrip {...props({ minSupport: 1 })} />);
    expect(cell('Queries listed')).toHaveTextContent('issued by at least 1 answer');
  });

  it('keeps the labels and draws bars while loading, and shows no value', () => {
    const { container } = renderWithProviders(
      <FanoutStrip {...props({ meta: undefined, listed: undefined, status: 'loading' })} />,
    );
    expect(strip()).toHaveAttribute('aria-busy', 'true');
    expect(within(strip()).getByText('Answers with fan-out')).toBeInTheDocument();
    expect(within(strip()).getByText('Queries listed')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(strip()).not.toHaveTextContent('%');
  });

  it('keeps the values while refetching', () => {
    renderWithProviders(<FanoutStrip {...props({ status: 'refetching' })} />);
    expect(strip()).toHaveAttribute('aria-busy', 'true');
    expect(strip()).toHaveTextContent('75.0%');
    expect(strip()).toHaveTextContent('14');
  });

  it('colours no value', () => {
    renderWithProviders(<FanoutStrip {...props()} />);
    for (const value of strip().querySelectorAll('dd span')) {
      expect(value.className).not.toMatch(/text-(positive|negative|warning|info|primary)/);
    }
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<FanoutStrip {...props()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
