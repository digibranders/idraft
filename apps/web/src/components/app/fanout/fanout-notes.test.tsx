import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EngineNote, ListCutNote, NewUnknownNote, StaleNote, TruncatedNote } from './fanout-notes';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const noop = (): void => undefined;

describe('EngineNote', () => {
  it('says do not for two engines', () => {
    renderWithProviders(<EngineNote engines={['Gemini', 'Google AI Mode']} />);
    expect(screen.getByText('Gemini and Google AI Mode do not expose fan-out.')).toBeInTheDocument();
  });

  it('says does not for one', () => {
    renderWithProviders(<EngineNote engines={['Gemini']} />);
    expect(screen.getByText('Gemini does not expose fan-out.')).toBeInTheDocument();
  });

  it('says nothing for none', () => {
    const { container } = renderWithProviders(<EngineNote engines={[]} />);
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says in a tip that not exposed is not the same as no query', async () => {
    const { user } = renderWithProviders(<EngineNote engines={['Gemini']} />);
    const tip = 'Their queries are not exposed. That is not the same as no query being issued.';
    await user.tab();
    expect(screen.getByRole('button', { name: tip })).toHaveFocus();
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent(tip));
  });
});

describe('TruncatedNote', () => {
  it('says how many answers were cut of the answers read, and that queries are missing', () => {
    renderWithProviders(<TruncatedNote cut={3} answers={12} engine="ChatGPT" />);
    expect(
      screen.getByText(
        '3 of 12 ChatGPT answers kept fewer queries than they issued. Some queries are missing, so the counts may be low.',
      ),
    ).toBeInTheDocument();
  });

  it('says it for one answer in the singular, and never counts the missing queries', () => {
    const { container } = renderWithProviders(<TruncatedNote cut={1} answers={1200} engine="ChatGPT" />);
    expect(
      screen.getByText(
        '1 of 1,200 ChatGPT answers kept fewer queries than it issued. Some queries are missing, so the counts may be low.',
      ),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-slot="banner"]')).toHaveClass('border-warning-border');
  });
});

describe('ListCutNote', () => {
  it('says how many queries are listed of how many', () => {
    renderWithProviders(<ListCutNote shown={200} total={1204} />);
    expect(
      screen.getByText(
        'The 200 queries issued by the most answers are listed of 1,204. Raise the minimum or narrow the scope.',
      ),
    ).toBeInTheDocument();
  });
});

describe('NewUnknownNote', () => {
  it('says there was no valid answer in the period before, with no action', () => {
    renderWithProviders(<NewUnknownNote reason="noPrevious" limit={200} onRetry={noop} retrying={false} />);
    expect(
      screen.getByText('No valid answer in the period before this window, so no query can be called new.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the period before has more queries than can be compared, with no action', () => {
    renderWithProviders(<NewUnknownNote reason="tooMany" limit={200} onRetry={noop} retrying={false} />);
    expect(
      screen.getByText('The period before this window has more than 200 queries, so new queries cannot be told apart.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says the period before could not be read, and offers Try again only then', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <NewUnknownNote reason="failed" limit={200} onRetry={onRetry} retrying={false} />,
    );
    expect(
      screen.getByText('New queries could not be told, because the period before this window could not be read.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says nothing while the period before is still being read', () => {
    const { container } = renderWithProviders(
      <NewUnknownNote reason="loading" limit={200} onRetry={noop} retrying={false} />,
    );
    expect(container.querySelector('[data-slot="banner"]')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('StaleNote', () => {
  it('is a plain line with the date of the newest query', () => {
    const { container } = renderWithProviders(<StaleNote date="Nov 2" />);
    expect(screen.getByText('No answer issued a query since Nov 2. The list may be out of date.')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="banner"]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the notes together', () => {
  it('none renders a bare zero', () => {
    const { container } = renderWithProviders(
      <>
        <EngineNote engines={['Gemini']} />
        <TruncatedNote cut={3} answers={12} engine="ChatGPT" />
        <ListCutNote shown={20} total={57} />
        <NewUnknownNote reason="noPrevious" limit={200} onRetry={noop} retrying={false} />
        <StaleNote date="Nov 2" />
      </>,
    );
    expect(container.textContent).not.toMatch(/(^|\s)0(\s|$|\.)/);
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(
      <>
        <EngineNote engines={['Gemini', 'Google AI Mode']} />
        <TruncatedNote cut={3} answers={12} engine="ChatGPT" />
        <ListCutNote shown={20} total={57} />
        <NewUnknownNote reason="failed" limit={200} onRetry={noop} retrying={false} />
        <StaleNote date="Nov 2" />
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
