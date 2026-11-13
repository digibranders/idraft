import { screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { DomainSeoShare } from './domain-seo-share';
import { useDomainSeoShare } from './use-domain-seo-share';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const RANKINGS = '/digibranders/fynix/seo/keywords' as Route;

describe('the search share of voice section', () => {
  it('says it is not available and why', () => {
    renderWithProviders(<DomainSeoShare rankingsHref={RANKINGS} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Search share of voice' })).toBeInTheDocument();
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        "No read of a domain's share of voice on your tracked keywords exists yet, so no figure is shown.",
      ),
    ).toBeInTheDocument();
  });

  it('draws no number: no percent and no zero', () => {
    renderWithProviders(<DomainSeoShare rankingsHref={RANKINGS} />);
    const section = screen.getByRole('heading', { level: 3, name: 'Search share of voice' }).closest('section');
    expect(section).not.toBeNull();
    expect(section?.textContent).not.toMatch(/%/);
    expect(section?.textContent).not.toMatch(/\d/);
  });

  it('links to the Rankings of the project', () => {
    renderWithProviders(<DomainSeoShare rankingsHref={RANKINGS} />);
    expect(screen.getByRole('link', { name: 'Open Rankings' })).toHaveAttribute('href', RANKINGS);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<DomainSeoShare rankingsHref={RANKINGS} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('useDomainSeoShare', () => {
  it('answers unavailable until a read of the figure exists', () => {
    expect(useDomainSeoShare()).toEqual({ status: 'unavailable' });
  });
});
