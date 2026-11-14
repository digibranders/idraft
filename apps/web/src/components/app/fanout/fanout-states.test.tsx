import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FanoutEmpty, FanoutFailed, NotExposedState } from './fanout-states';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const noop = (): void => undefined;

describe('NotExposedState', () => {
  it('names the engines with formatList and says nothing is read', () => {
    const { container } = renderWithProviders(
      <NotExposedState engines={['Gemini', 'Google AI Mode']} onShowAll={noop} />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Fan-out is not exposed by Gemini and Google AI Mode' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'These engines do not show the queries they issue, so there is nothing to list. Choose an engine that does.',
      ),
    ).toBeInTheDocument();
    // Neither a zero nor an empty list: the engines say nothing, which is not none
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.textContent).not.toMatch(/\b0\b/);
  });

  it('says this engine for one', () => {
    renderWithProviders(<NotExposedState engines={['Gemini']} onShowAll={noop} />);
    expect(screen.getByRole('heading', { name: 'Fan-out is not exposed by Gemini' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'This engine does not show the queries it issues, so there is nothing to list. Choose an engine that does.',
      ),
    ).toBeInTheDocument();
  });

  it('shows all engines from its action', async () => {
    const onShowAll = vi.fn();
    const { user } = renderWithProviders(<NotExposedState engines={['Gemini']} onShowAll={onShowAll} />);
    await user.click(screen.getByRole('button', { name: 'Show all engines' }));
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it('offers no action when there is no wider choice to go back to', () => {
    renderWithProviders(<NotExposedState engines={['Gemini']} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<NotExposedState engines={['Gemini']} onShowAll={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('FanoutEmpty', () => {
  it('says no answer was read in the window, with the engine named', () => {
    renderWithProviders(<FanoutEmpty kind="noAnswers" engine="ChatGPT" />);
    expect(screen.getByRole('heading', { level: 2, name: 'No ChatGPT answer in this window' })).toBeInTheDocument();
    expect(screen.getByText('Choose a longer window or wait for the next run.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says answers were read and none issued a query, with how many', () => {
    const { unmount } = renderWithProviders(<FanoutEmpty kind="none" engine="ChatGPT" answers={12} />);
    expect(screen.getByRole('heading', { name: 'No answer issued a query' })).toBeInTheDocument();
    expect(
      screen.getByText('12 ChatGPT answers were collected in this window, and none issued a query.'),
    ).toBeInTheDocument();
    unmount();
    renderWithProviders(<FanoutEmpty kind="none" engine="ChatGPT" answers={1} />);
    expect(
      screen.getByText('1 ChatGPT answer was collected in this window, and none issued a query.'),
    ).toBeInTheDocument();
  });

  it('says the minimum left no query and offers Show every query', async () => {
    const onShowEvery = vi.fn();
    const { user } = renderWithProviders(<FanoutEmpty kind="underMin" minSupport={3} onShowEvery={onShowEvery} />);
    expect(screen.getByRole('heading', { name: 'No query was issued by 3 or more answers' })).toBeInTheDocument();
    expect(
      screen.getByText('Queries issued by fewer answers are left out. Lower the minimum or choose a longer window.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show every query' }));
    expect(onShowEvery).toHaveBeenCalledOnce();
  });

  it('gives each of the three states its own reason', () => {
    const reasons = (element: ReactElement): string => {
      const { container, unmount } = renderWithProviders(element);
      const text = within(container).getByRole('heading').nextElementSibling?.textContent ?? '';
      unmount();
      return text;
    };
    const all = [
      reasons(<FanoutEmpty kind="noAnswers" engine="ChatGPT" />),
      reasons(<FanoutEmpty kind="none" engine="ChatGPT" answers={4} />),
      reasons(<FanoutEmpty kind="underMin" minSupport={2} onShowEvery={noop} />),
    ];
    expect(new Set(all).size).toBe(3);
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<FanoutEmpty kind="underMin" minSupport={2} onShowEvery={noop} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('FanoutFailed', () => {
  const errorId = { id: 'err-7', label: 'Error ID err-7', copyLabel: 'Copy error ID', copiedLabel: 'Copied' };

  it('says the queries could not be loaded, quotes the error id and retries', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(<FanoutFailed errorId={errorId} onRetry={onRetry} retrying={false} />);
    expect(screen.getByText('The queries could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('The server did not answer. Try again in a moment.')).toBeInTheDocument();
    expect(screen.getByText('Error ID err-7')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('has no error id line when the failure had none', () => {
    renderWithProviders(<FanoutFailed errorId={null} onRetry={noop} retrying={false} />);
    expect(screen.queryByText(/Error ID/)).toBeNull();
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<FanoutFailed errorId={errorId} onRetry={noop} retrying={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
