import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SerpFeatureListView, AioStatusView, TargetMismatchMarker, CompetitorRankView } from './feature-cells';
import type { CompetitorRank } from '@/lib/api/types';
import type { AioDisplay } from '@/lib/format';
import { featureListDisplay } from '@/lib/keywords/serp-features';
import { renderWithProviders } from '@/test/render';

describe('SerpFeatureListView', () => {
  it('renders icons, highlights owned ones in primary text, and provides accessible speech text', () => {
    const display = featureListDisplay(['featured_snippet', 'video'], ['featured_snippet']);
    const { container } = renderWithProviders(<SerpFeatureListView display={display} state="ranked" />);

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
    const { container } = renderWithProviders(<SerpFeatureListView display={display} state="ranked" />);

    const icons = container.querySelectorAll('svg[data-slot="icon"]');
    expect(icons).toHaveLength(5);
    expect(screen.getByText('+2')).toHaveClass('type-table', 'num');
  });

  it('renders None in tertiary after a check with no features, and Pending when not checked', () => {
    const empty = featureListDisplay([], []);
    const { rerender } = renderWithProviders(<SerpFeatureListView display={empty} state="ranked" />);
    expect(screen.getByText('None')).toHaveClass('text-foreground-tertiary');

    rerender(<SerpFeatureListView display={empty} state="not_checked" />);
    expect(screen.getByText('Pending')).toHaveClass('text-foreground-tertiary');
  });

  it('renders the fallback icon for an unknown code and uses the code as its accessible name', () => {
    const display = featureListDisplay(['new_thing'], []);
    const { container } = renderWithProviders(<SerpFeatureListView display={display} state="ranked" />);

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

  it('shows the stale marker when stale is true', async () => {
    const display = featureListDisplay(['video'], []);
    const { user } = renderWithProviders(
      <SerpFeatureListView display={display} state="ranked" stale={true} lastSuccessfulCheck="Oct 29, 2026, 4:00 PM" />,
    );
    expect(screen.getByText('stale')).toHaveClass('sr-only');
    await user.hover(screen.getByText('stale'));
    await waitFor(() => expect(screen.getByText('Last successful check: Oct 29, 2026, 4:00 PM.')).toBeInTheDocument());
  });
});

describe('AioStatusView', () => {
  it('renders a cited status in a positive badge with position and accessible speech text', () => {
    const display: AioDisplay = { kind: 'cited', position: 2 };
    renderWithProviders(<AioStatusView display={display} />);

    const badge = screen.getByRole('img', { name: 'AI Overview present, cited at position 2' });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAccessibleName('AI Overview present, cited at position 2');
    expect(badge).toHaveClass('bg-positive-subtle', 'text-positive-text');
    expect(badge).toHaveTextContent('Cited #2');
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

  it('shows a warning icon with its accessible name when the check failed', () => {
    renderWithProviders(<AioStatusView display={{ kind: 'unknown' }} state="failed" />);
    expect(screen.getByRole('img', { name: 'Check failed' })).toHaveClass('text-warning-text');
    expect(screen.queryByText('n/a')).not.toBeInTheDocument();
  });

  it('renders a stale marker when stale is true', () => {
    renderWithProviders(<AioStatusView display={{ kind: 'cited', position: 1 }} stale={true} />);
    expect(screen.getByText('stale')).toHaveClass('sr-only');
  });
});

describe('TargetMismatchMarker', () => {
  it('renders a 14 px Crosshair icon in text-warning-text, aria-hidden, and nothing else', () => {
    const { container } = renderWithProviders(<TargetMismatchMarker />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('text-warning-text', 'size-icon-sm');
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('CompetitorRankView', () => {
  it('renders an 8 px square swatch with color_index and rank through RankCellView', () => {
    const entry: CompetitorRank = {
      entity: {
        entity_id: 'c1',
        canonical_name: 'Rankforge',
        entity_type: 'brand',
        role: 'competitor',
        color_index: 3,
      },
      current: {
        state: 'ranked',
        rank: 7,
        absolute_rank: 7,
        depth_requested: 20,
        url: null,
        observed_at: '2026-10-27T10:00:00Z',
        serp_snapshot_id: null,
      },
      change: {
        label: 'numeric',
        value: 2,
        previous_rank: 9,
        previous_observed_at: '2026-10-26T10:00:00Z',
      },
    };

    const { container } = renderWithProviders(<CompetitorRankView entry={entry} name="Rankforge" />);
    const swatch = container.querySelector('.rounded-2xs');
    expect(swatch).toBeInTheDocument();
    expect(swatch).toHaveAttribute('aria-hidden', 'true');
    expect(swatch).toHaveClass('size-2');
    expect(swatch).toHaveStyle({ backgroundColor: 'var(--chart-3)' });
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('renders beyond depth rank as >20 with swatch', () => {
    const entry: CompetitorRank = {
      entity: {
        entity_id: 'c2',
        canonical_name: 'Northlight',
        entity_type: 'brand',
        role: 'competitor',
        color_index: 4,
      },
      current: {
        state: 'beyond_depth',
        rank: null,
        absolute_rank: null,
        depth_requested: 20,
        url: null,
        observed_at: '2026-10-27T10:00:00Z',
        serp_snapshot_id: null,
      },
      change: {
        label: 'unchanged_beyond',
        value: null,
        previous_rank: null,
        previous_observed_at: null,
      },
    };

    const { container } = renderWithProviders(<CompetitorRankView entry={entry} name="Northlight" />);
    const swatch = container.querySelector('.rounded-2xs');
    expect(swatch).toHaveStyle({ backgroundColor: 'var(--chart-4)' });
    expect(screen.getByText('>20')).toBeInTheDocument();
  });

  it('renders n/a in tertiary when entry is missing or null', () => {
    renderWithProviders(<CompetitorRankView entry={null} name="Unknown" />);
    const na = screen.getByText('n/a');
    expect(na).toBeInTheDocument();
    expect(na).toHaveClass('text-foreground-tertiary');
    expect(na).not.toHaveAttribute('title');
  });

  it('falls back to 2 + position % 5 when color_index is null', () => {
    const entry: CompetitorRank = {
      entity: {
        entity_id: 'c3',
        canonical_name: 'NoColor',
        entity_type: 'brand',
        role: 'competitor',
        color_index: null,
      },
      current: {
        state: 'ranked',
        rank: 12,
        absolute_rank: 12,
        depth_requested: 20,
        url: null,
        observed_at: '2026-10-27T10:00:00Z',
        serp_snapshot_id: null,
      },
      change: {
        label: 'first_check',
        value: null,
        previous_rank: null,
        previous_observed_at: null,
      },
    };

    const { container } = renderWithProviders(<CompetitorRankView entry={entry} name="NoColor" position={1} />);
    const swatch = container.querySelector('.rounded-2xs');
    expect(swatch).toHaveStyle({ backgroundColor: 'var(--chart-3)' });
  });
});
