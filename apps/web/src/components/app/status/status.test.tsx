import { screen } from '@testing-library/react';
import { Tag } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { Banner } from './banner';
import { EmptyState } from './empty-state';
import { ErrorPage } from './error-page';
import { InlineError } from './inline-error';
import { Button } from '@/components/ui/button';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const ERROR_ID = {
  id: 'req_01ABC',
  label: 'Error ID req_01ABC',
  copyLabel: 'Copy error ID',
  copiedLabel: 'Error ID copied',
};

describe('EmptyState', () => {
  it('says what is missing and why, at the heading level of its region, with its action', async () => {
    const { container } = renderWithProviders(
      <EmptyState
        icon={Tag}
        headingLevel={2}
        title="No keywords tracked yet"
        reason="Add keywords to start daily rank checks for this project."
        primaryAction={<Button variant="primary">Add keywords</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No keywords tracked yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add keywords' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no icon and aligns left inline', () => {
    const { container } = renderWithProviders(
      <EmptyState variant="inline" icon={Tag} headingLevel={3} title="No citations" reason="None in this window." />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.firstElementChild).toHaveClass('text-left');
  });
});

describe('InlineError', () => {
  it('keeps the region with its reason, Retry and the error id', async () => {
    const onRetry = vi.fn();
    const { user, container } = renderWithProviders(
      <InlineError
        title="Could not load rank history"
        reason="The server returned an error. Your filters are unchanged."
        errorId={ERROR_ID}
        onRetry={onRetry}
        retrying={false}
        retryLabel="Try again"
      />,
    );
    // The providers' live regions have the alert role too, so the region itself is checked
    expect(container.querySelector('[data-slot="inline-error"]')).not.toHaveAttribute('role');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Error ID req_01ABC')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is announced when it appears while the person works in the region', () => {
    const { container } = renderWithProviders(
      <InlineError
        title="Could not load"
        reason="Try again."
        errorId={null}
        onRetry={vi.fn()}
        retrying={false}
        retryLabel="Try again"
        live
      />,
    );
    expect(container.querySelector('[data-slot="inline-error"]')).toHaveAttribute('role', 'alert');
  });
});

describe('ErrorPage', () => {
  it('names the failure in the page heading, offers Try again, and copies the error id', async () => {
    const reset = vi.fn();
    const { user, container } = renderWithProviders(
      <ErrorPage
        title="This page could not be loaded"
        reason="An unexpected error occurred. Your data is not affected."
        retry={{ label: 'Try again', onRetry: reset }}
        errorId={ERROR_ID}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'This page could not be loaded' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Copy error ID' }));
    // user-event gives the page a clipboard of its own
    expect(await navigator.clipboard.readText()).toBe('req_01ABC');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Banner', () => {
  it('states a condition with its lead, and has no live role when it is there from the start', async () => {
    const { container } = renderWithProviders(
      <Banner tone="info" placement="region" lead="Read only:" message="Owners and admins can change this." />,
    );
    expect(screen.getByText('Read only:')).toBeInTheDocument();
    expect(screen.getByText(/Owners and admins can change this/)).toBeInTheDocument();
    expect(container.querySelector('[data-slot="banner"]')).not.toHaveAttribute('role');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('announces itself when it appears during the session, as an alert when negative', () => {
    const { container, rerender } = renderWithProviders(
      <Banner tone="warning" placement="page" message="Partial data." live />,
    );
    const banner = (): Element | null => container.querySelector('[data-slot="banner"]');
    expect(banner()).toHaveAttribute('role', 'status');
    rerender(<Banner tone="negative" placement="page" message="Collection failed." live />);
    expect(banner()).toHaveAttribute('role', 'alert');
  });
});
