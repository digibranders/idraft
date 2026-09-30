import { render, screen } from '@testing-library/react';
import { Check } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Badge, type BadgeProps } from './badge';
import { axe } from '@/test/axe';

describe('Badge', () => {
  it('is a neutral tinted 22 px label by default, never a pill', () => {
    render(<Badge>Commercial</Badge>);
    const badge = screen.getByText('Commercial');
    expect(badge).toHaveClass(
      'h-badge',
      'px-2',
      'rounded-sm',
      'type-micro',
      'bg-neutral-subtle',
      'text-neutral-text',
      'whitespace-nowrap',
    );
    expect(badge).toHaveAttribute('data-slot', 'badge');
    expect(badge).not.toHaveClass('rounded-full');
  });

  it('keeps a border on every tinted badge, so the box survives a forced-colors mode', () => {
    render(<Badge tone="positive">Cited</Badge>);
    expect(screen.getByText('Cited')).toHaveClass('border', 'border-transparent');
  });

  it('always draws the edge of a neutral badge, and takes the surface fill inside a selected row', () => {
    render(<Badge>Startups</Badge>);
    const badge = screen.getByText('Startups');
    expect(badge).toHaveClass('border', 'border-neutral-border', 'group-aria-selected:bg-surface');
    expect(badge).not.toHaveClass('border-transparent');
  });

  it('passes other attributes on to its root', () => {
    render(
      <Badge id="intent" title="Search intent" className="ml-auto">
        Commercial
      </Badge>,
    );
    const badge = screen.getByText('Commercial');
    expect(badge).toHaveAttribute('id', 'intent');
    expect(badge).toHaveAttribute('title', 'Search intent');
    expect(badge).toHaveClass('ml-auto', 'h-badge');
  });

  it.each([
    ['positive', 'bg-positive-subtle', 'text-positive-text'],
    ['negative', 'bg-negative-subtle', 'text-negative-text'],
    ['warning', 'bg-warning-subtle', 'text-warning-text'],
    ['info', 'bg-info-subtle', 'text-info-text'],
  ] as const)('tints %s', (tone, fill, text) => {
    render(<Badge tone={tone}>Label</Badge>);
    expect(screen.getByText('Label')).toHaveClass(fill, text);
  });

  it.each([
    ['neutral', 'border-border', 'text-foreground-secondary'],
    ['positive', 'border-positive-border', 'text-positive-text'],
    ['negative', 'border-negative-border', 'text-negative-text'],
  ] as const)('outlines %s on the surface', (tone, border, text) => {
    render(
      <Badge tone={tone} variant="outline">
        Label
      </Badge>,
    );
    expect(screen.getByText('Label')).toHaveClass('bg-surface', border, text);
  });

  it('is plain colored text in the text variant', () => {
    render(
      <Badge tone="warning" variant="text">
        Stale
      </Badge>,
    );
    const badge = screen.getByText('Stale');
    expect(badge).toHaveClass('text-warning-text');
    expect(badge).not.toHaveClass('h-badge', 'px-2', 'border');
  });

  it('shows a 12 px leading icon hidden from assistive technology', () => {
    render(
      <Badge tone="positive" icon={Check}>
        Cited
      </Badge>,
    );
    const icon = screen.getByText('Cited').querySelector('svg');
    expect(icon).toHaveClass('size-icon-xs');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('refuses combinations the design system does not have', () => {
    // @ts-expect-error a warning badge has no outline form (14-badges-status.md section 1)
    const warningOutline: BadgeProps = { tone: 'warning', variant: 'outline', children: 'Stale' };
    // @ts-expect-error an info badge has no outline form
    const infoOutline: BadgeProps = { tone: 'info', variant: 'outline', children: 'Estimate' };
    const warningText: BadgeProps = { tone: 'warning', variant: 'text', children: 'Stale' };
    expect([warningOutline, infoOutline, warningText]).toHaveLength(3);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <p>
        <Badge>Question</Badge> <Badge tone="negative">Lost</Badge>
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
