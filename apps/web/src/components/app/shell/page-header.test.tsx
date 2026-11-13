import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './page-header';
import { renderWithProviders } from '@/test/render';

describe('PageHeader with a title addon', () => {
  it('draws the addon after the title and keeps it out of the heading', () => {
    renderWithProviders(<PageHeader title="Overview" titleAddon={<span>Customizing</span>} meta="Updated 2h ago" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Overview' });
    const addon = screen.getByText('Customizing');
    expect(heading).not.toContainElement(addon);
    expect(heading.nextElementSibling).toBe(addon);
  });

  it('draws the addon beside the title when the header has a toolbar', () => {
    renderWithProviders(
      <PageHeader title="Overview" titleAddon={<span>Customizing</span>} toolbar={<div>filters</div>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' }).nextElementSibling).toBe(
      screen.getByText('Customizing'),
    );
  });

  it('keeps the markup of a header without one', () => {
    const { container } = renderWithProviders(<PageHeader title="Overview" meta="Updated 2h ago" />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Overview' });
    expect(heading.parentElement).toBe(container.querySelector('[data-slot="page-header"] > div > div'));
  });

  it('leaves the addon out when the title is hidden: there is no title for it to follow', () => {
    renderWithProviders(<PageHeader title="Keywords" titleHidden titleAddon={<span>Customizing</span>} />);
    expect(screen.queryByText('Customizing')).not.toBeInTheDocument();
  });
});

describe('PageHeader with the title hidden', () => {
  it('keeps the page’s heading for assistive technology but does not draw it', () => {
    renderWithProviders(
      <PageHeader
        title="Keywords"
        titleHidden
        meta="Updated 2h ago"
        toolbar={<div>toolbar</div>}
        actions={<button type="button">Add</button>}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Keywords' });
    expect(heading).toHaveClass('sr-only');
    expect(screen.getByText('toolbar')).toBeInTheDocument();
    expect(screen.getByText('Updated 2h ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('draws the title as before without it', () => {
    renderWithProviders(<PageHeader title="Keywords" meta="Updated 2h ago" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Keywords' })).not.toHaveClass('sr-only');
  });
});
