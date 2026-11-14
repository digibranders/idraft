import { screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { Activity } from 'lucide-react';

import { PageToolbar } from './page-toolbar';
import { StatChip } from './stat-chip';
import { StatusChip } from './status-chip';
import { renderWithProviders } from '@/test/render';

describe('PageToolbar', () => {
  it('renders a visually hidden h1 for accessibility', () => {
    renderWithProviders(<PageToolbar title="Overview" headingId="overview-heading" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Overview' });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass('sr-only');
    expect(heading).toHaveAttribute('id', 'overview-heading');
  });

  it('renders stats, tabs, filters, status, and actions in their slots', () => {
    renderWithProviders(
      <PageToolbar
        title="Citations"
        stats={<span data-testid="stats-slot">Stats content</span>}
        tabs={<span data-testid="tabs-slot">Tabs content</span>}
        filters={<span data-testid="filters-slot">Filters content</span>}
        status={<span data-testid="status-slot">Status content</span>}
        actions={<button type="button">Primary action</button>}
      />,
    );

    expect(screen.getByTestId('stats-slot')).toBeInTheDocument();
    expect(screen.getByTestId('tabs-slot')).toBeInTheDocument();
    expect(screen.getByTestId('filters-slot')).toBeInTheDocument();
    expect(screen.getByTestId('status-slot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Primary action' })).toBeInTheDocument();
  });

  it('passes axe accessibility checks', async () => {
    const { container } = renderWithProviders(
      <PageToolbar
        title="Overview"
        stats={
          <div className="flex items-center gap-4">
            <StatChip label="Keywords" value="55" tooltip="55 tracked keywords" />
            <StatChip label="Visibility" value="82%" delta="+3.1 pts" />
          </div>
        }
        status={<StatusChip label="Schedules paused" tone="warning" />}
        actions={<button type="button">Export</button>}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('StatChip', () => {
  it('renders label and value with tabular figures', () => {
    renderWithProviders(<StatChip label="Keywords" value="120" />);
    expect(screen.getByText('Keywords')).toBeInTheDocument();
    const val = screen.getByText('120');
    expect(val).toBeInTheDocument();
    expect(val).toHaveClass('num');
  });

  it('renders delta and secondary text when provided', () => {
    renderWithProviders(<StatChip label="Visibility" value="74%" delta="+2.4 pts" secondaryText="avg" />);
    expect(screen.getByText('+2.4 pts')).toBeInTheDocument();
    expect(screen.getByText('avg')).toBeInTheDocument();
  });

  it('renders unknown state muted and not as zero', () => {
    renderWithProviders(<StatChip label="Top 3" value="n/a" unknown />);
    const val = screen.getByText('n/a');
    expect(val).toHaveClass('text-foreground-tertiary');
  });

  it('adds tabIndex 0 and focus ring when tooltip is provided for keyboard users', () => {
    renderWithProviders(<StatChip label="Mentions" value="85%" tooltip="85 of 100 answers mentioned" />);
    const valContainer = screen.getByLabelText('Mentions: 85%');
    expect(valContainer).toHaveAttribute('tabindex', '0');
  });
});

describe('StatusChip', () => {
  it('renders label and icon with semantic tone', () => {
    renderWithProviders(<StatusChip label="Collecting answers" icon={Activity} tone="info" />);
    expect(screen.getByText('Collecting answers')).toBeInTheDocument();
  });

  it('renders as a link when href is provided', () => {
    renderWithProviders(<StatusChip label="Schedules paused" href="/settings/schedules" tone="warning" />);
    const link = screen.getByRole('link', { name: 'Schedules paused' });
    expect(link).toHaveAttribute('href', '/settings/schedules');
  });
});
