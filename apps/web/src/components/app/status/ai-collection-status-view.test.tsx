import { screen, within } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { AiCollectionStatusView, type AiCollectionStatusViewProps } from './ai-collection-status-view';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const HREF = '/digibranders/fynix/ops/runs?inspect=run%3Aabc' as Route;

/** The view's own box: the app's live regions sit beside it in the container, so the container is not the view. */
const statusRoot = (container: HTMLElement): Element | null =>
  container.querySelector('[data-slot="ai-collection-status"]');

const idle: AiCollectionStatusViewProps = { progress: null, notice: null, failure: null };

const gemini = { engine: 'gemini_web', name: 'Gemini', planned: 150, valid: 132, rate: 132 / 150 };
const chatgpt = { engine: 'chatgpt_web', name: 'ChatGPT', planned: 100, valid: 80, rate: 0.8 };

describe('AiCollectionStatusView progress', () => {
  it('progress shows the counts of an open AI run in a compact line', () => {
    renderWithProviders(
      <AiCollectionStatusView
        {...idle}
        progress={{ counts: { processed: 412, failed: 3, total: 1000 }, href: HREF }}
      />,
    );
    expect(screen.getByText('Collecting answers: 412 of 1,000 tasks, 3 failed')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View run' })).toHaveAttribute('href', HREF);
  });

  it('leaves the failed count out while none failed, and says one task in the singular', () => {
    const { rerender } = renderWithProviders(
      <AiCollectionStatusView {...idle} progress={{ counts: { processed: 4, failed: 0, total: 10 }, href: HREF }} />,
    );
    expect(screen.getByText('Collecting answers: 4 of 10 tasks')).toBeVisible();
    rerender(
      <AiCollectionStatusView {...idle} progress={{ counts: { processed: 0, failed: 0, total: 1 }, href: HREF }} />,
    );
    expect(screen.getByText('Collecting answers: 0 of 1 task')).toBeVisible();
  });

  it('says the tasks are being prepared, not 0 of 0, while the run has planned none', () => {
    renderWithProviders(<AiCollectionStatusView {...idle} progress={{ counts: null, href: HREF }} />);
    expect(screen.getByText('Collecting answers: preparing the tasks')).toBeVisible();
    expect(screen.queryByText(/0 of 0/)).toBeNull();
  });

  it('progress is absent when there is nothing to show', () => {
    const { container } = renderWithProviders(<AiCollectionStatusView {...idle} />);
    expect(statusRoot(container)).toBeNull();
  });
});

describe('AiCollectionStatusView notice', () => {
  it('the notice names each degraded engine with its counts and links to the run', () => {
    renderWithProviders(<AiCollectionStatusView {...idle} notice={{ engines: [gemini, chatgpt], href: HREF }} />);
    expect(
      screen.getByText(
        'Gemini: 132 of 150 answers valid, 88%. Below 90%, so this engine is degraded in the latest run.',
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        'ChatGPT: 80 of 100 answers valid, 80%. Below 90%, so this engine is degraded in the latest run.',
      ),
    ).toBeVisible();
    // One link per engine, each named for its engine and pointing at the run
    const geminiLink = screen.getByRole('link', { name: 'View run for Gemini' });
    expect(geminiLink).toHaveTextContent('View run');
    expect(geminiLink).toHaveAttribute('href', HREF);
    expect(screen.getByRole('link', { name: 'View run for ChatGPT' })).toHaveAttribute('href', HREF);
  });

  it('the notice is a warning banner that is read with the page, not a live alert', () => {
    const { container } = renderWithProviders(
      <AiCollectionStatusView {...idle} notice={{ engines: [gemini], href: HREF }} />,
    );
    const banner = container.querySelector('[data-slot="banner"]');
    expect(banner).not.toBeNull();
    // Warning family, and no live role: it is read where it sits, in the page's order
    expect(banner).toHaveClass('border-warning-border', 'bg-warning-subtle');
    expect(banner).not.toHaveAttribute('role');
    expect(statusRoot(container)?.querySelector('[role="alert"], [role="status"]')).toBeNull();
  });

  it('never shows a rate that rounds up to the line it is below', () => {
    // 896 of 1,000 is 89.6 percent: "90%" next to "Below 90%" would contradict itself
    renderWithProviders(
      <AiCollectionStatusView
        {...idle}
        notice={{ engines: [{ ...gemini, planned: 1000, valid: 896, rate: 0.896 }], href: HREF }}
      />,
    );
    expect(screen.getByText(/^Gemini: 896 of 1,000 answers valid, 89\.6%\./)).toBeVisible();
  });
});

describe('AiCollectionStatusView failure', () => {
  it('a failed read shows nothing alarming and a Retry in the meta', async () => {
    const onRetry = vi.fn();
    const { container, user } = renderWithProviders(
      <AiCollectionStatusView {...idle} failure={{ onRetry, retrying: false }} />,
    );
    expect(screen.getByText('Answer coverage of the latest run did not load.')).toBeVisible();
    // Not a banner, not an alert, and no warning or error colour
    expect(container.querySelector('[data-slot="banner"]')).toBeNull();
    expect(statusRoot(container)?.querySelector('[role="alert"], [role="status"]')).toBeNull();
    expect(statusRoot(container)?.innerHTML).not.toMatch(/negative|warning/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('stands beside a notice and a progress line without hiding them', () => {
    renderWithProviders(
      <AiCollectionStatusView
        progress={{ counts: { processed: 1, failed: 0, total: 2 }, href: HREF }}
        notice={{ engines: [gemini], href: HREF }}
        failure={{ onRetry: vi.fn(), retrying: true }}
      />,
    );
    const region = screen.getByText('Collecting answers: 1 of 2 tasks').closest('[data-slot="ai-collection-status"]');
    expect(region).not.toBeNull();
    if (region instanceof HTMLElement) {
      expect(within(region).getByText(/^Gemini: 132 of 150/)).toBeVisible();
      expect(within(region).getByRole('button', { name: 'Try again' })).toBeVisible();
    }
  });
});

describe('AiCollectionStatusView accessibility', () => {
  it('has no axe violations with every part shown', async () => {
    const { container } = renderWithProviders(
      <AiCollectionStatusView
        progress={{ counts: { processed: 412, failed: 3, total: 1000 }, href: HREF }}
        notice={{ engines: [gemini, chatgpt], href: HREF }}
        failure={{ onRetry: vi.fn(), retrying: false }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
