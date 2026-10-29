import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SerpFeatureListView, AioStatusView } from './feature-cells';
import type { AioDisplay } from '@/lib/format';
import { featureListDisplay } from '@/lib/keywords/serp-features';
import { renderWithProviders } from '@/test/render';

describe('SerpFeatureListView', () => {
  it('renders icons, highlights owned ones in primary text, and provides accessible speech text', () => {
    const display = featureListDisplay(['featured_snippet', 'video'], ['featured_snippet']);
    const { container } = renderWithProviders(<SerpFeatureListView display={display} checked={true} />);

    const icons = container.querySelectorAll('svg[data-slot="icon"]');
    expect(icons).toHaveLength(2);
    expect(icons[0]).toHaveClass('text-primary-text');
    expect(icons[1]).toHaveClass('text-foreground-muted');

    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toHaveTextContent('SERP features: Featured snippet, yours. Video');
  });

  it('renders five icons and a visible +2 when seven features are present', () => {
    const present = ['ads', 'sitelinks', 'video', 'images', 'local_pack', 'shopping', 'top_stories'];
    const display = featureListDisplay(present, []);
    const { container } = renderWithProviders(<SerpFeatureListView display={display} checked={true} />);

    const icons = container.querySelectorAll('svg[data-slot="icon"]');
    expect(icons).toHaveLength(5);
    expect(screen.getByText('+2')).toHaveClass('type-meta', 'num');
  });

  it('renders None in tertiary after a check with no features, and Pending when not checked', () => {
    const empty = featureListDisplay([], []);
    const { rerender } = renderWithProviders(<SerpFeatureListView display={empty} checked={true} />);
    expect(screen.getByText('None')).toHaveClass('text-foreground-tertiary');

    rerender(<SerpFeatureListView display={empty} checked={false} />);
    expect(screen.getByText('Pending')).toHaveClass('text-foreground-tertiary');
  });

  it('renders the fallback icon for an unknown code and uses the code as its accessible name', () => {
    const display = featureListDisplay(['new_thing'], []);
    const { container } = renderWithProviders(<SerpFeatureListView display={display} checked={true} />);

    const icons = container.querySelectorAll('svg[data-slot="icon"]');
    expect(icons).toHaveLength(1);
    expect(icons[0]).toHaveClass('text-foreground-muted');

    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).toHaveTextContent('SERP features: new_thing');
  });

  it('shows a warning icon with its accessible name when the check failed', () => {
    const empty = featureListDisplay([], []);
    renderWithProviders(<SerpFeatureListView display={empty} state="failed" />);
    expect(screen.getByRole('img', { name: 'Check failed' })).toHaveClass('text-warning-text');
    expect(screen.queryByText('None')).not.toBeInTheDocument();
  });
});

describe('AioStatusView', () => {
  it('renders a cited status in a positive badge with position', () => {
    const display: AioDisplay = { kind: 'cited', position: 2 };
    renderWithProviders(<AioStatusView display={display} />);

    const badge = screen.getByText('Cited #2');
    expect(badge).toBeInTheDocument();
    expect(badge.closest('[data-slot="badge"]')).toHaveClass('bg-positive-subtle', 'text-positive-text');
  });

  it('renders notCited as a 16 px check icon in primary text with an accessible name and no visible word', () => {
    const display: AioDisplay = { kind: 'notCited' };
    const { container } = renderWithProviders(<AioStatusView display={display} />);

    const img = screen.getByRole('img', { name: 'AI Overview present, not cited' });
    expect(img).toHaveClass('text-primary-text', 'size-icon');
    expect(container.textContent).toBe('');
  });

  it('renders absent as No AIO in tertiary with an accessible spoken sentence', () => {
    const display: AioDisplay = { kind: 'absent' };
    renderWithProviders(<AioStatusView display={display} />);

    expect(screen.getByText('No AIO')).toHaveClass('text-foreground-tertiary');
    expect(screen.getByText('Not applicable, no AI Overview')).toHaveClass('sr-only');
  });

  it('renders notLoaded, unknown, and pending in tertiary text', () => {
    const { rerender } = renderWithProviders(<AioStatusView display={{ kind: 'notLoaded' }} />);
    expect(screen.getByText('Not loaded')).toHaveClass('text-foreground-tertiary');

    rerender(<AioStatusView display={{ kind: 'unknown' }} />);
    expect(screen.getByText('n/a')).toHaveClass('text-foreground-tertiary');

    rerender(<AioStatusView display={{ kind: 'pending' }} />);
    expect(screen.getByText('Pending')).toHaveClass('text-foreground-tertiary');
  });
});
