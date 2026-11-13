import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChangeEmpty, ChangeFailed, CountFailed } from './new-lost-states';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('ChangeEmpty', () => {
  it('New names the minimum and the days before it', () => {
    renderWithProviders(<ChangeEmpty kind="new" minSupport={5} days={28} noPrevious={false} />);
    expect(screen.getByRole('heading', { name: 'No new source' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'No source reached 5 units in this window without being cited in the 28 days before it. Lower the minimum or choose another window.',
      ),
    ).toBeInTheDocument();
  });

  it('Lost names the days of answers it needs behind the window', () => {
    renderWithProviders(<ChangeEmpty kind="lost" minSupport={2} days={276} noPrevious={false} />);
    expect(screen.getByRole('heading', { name: 'No lost source' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'A source is lost after it was cited in one window and not at all in the 2 windows after it, so a lost source needs 276 days of answers behind this window.',
      ),
    ).toBeInTheDocument();
  });

  it('says that the previous period has no answers, and not that a minimum was too high', () => {
    const { unmount } = renderWithProviders(<ChangeEmpty kind="new" minSupport={2} days={28} noPrevious />);
    expect(screen.getByText('The previous period has no answers, so nothing is new.')).toBeInTheDocument();
    expect(screen.queryByText(/Lower the minimum/)).toBeNull();
    unmount();
    renderWithProviders(<ChangeEmpty kind="lost" minSupport={2} days={84} noPrevious />);
    expect(screen.getByText('The earlier periods have no answers, so nothing can be lost.')).toBeInTheDocument();
  });

  it('is axe clean', async () => {
    const { container } = renderWithProviders(<ChangeEmpty kind="new" minSupport={2} days={28} noPrevious={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ChangeFailed', () => {
  it('names the kind that failed, offers Try again and quotes the error id', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(
      <ChangeFailed
        kind="lost"
        errorId={{ id: 'err-7', label: 'Error ID err-7', copyLabel: 'Copy error ID', copiedLabel: 'Copied' }}
        onRetry={onRetry}
        retrying={false}
      />,
    );
    expect(screen.getByText('The lost sources could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('The server did not answer. Try again in a moment.')).toBeInTheDocument();
    expect(screen.getByText('Error ID err-7')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says the new sources for New', () => {
    renderWithProviders(<ChangeFailed kind="new" errorId={null} onRetry={() => undefined} retrying={false} />);
    expect(screen.getByText('The new sources could not be loaded.')).toBeInTheDocument();
  });
});

describe('CountFailed', () => {
  it('says which count could not be loaded and offers Try again', async () => {
    const onRetry = vi.fn();
    const { user } = renderWithProviders(<CountFailed kind="lost" onRetry={onRetry} retrying={false} />);
    expect(screen.getByText('The count of lost sources could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('says new for New', () => {
    renderWithProviders(<CountFailed kind="new" onRetry={() => undefined} retrying={false} />);
    expect(screen.getByText('The count of new sources could not be loaded.')).toBeInTheDocument();
  });
});
