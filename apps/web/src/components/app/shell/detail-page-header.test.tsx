import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DetailPageHeader } from './detail-page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { rankingsPath } from '@/lib/routes/paths';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const BACK = { label: 'Keywords', href: rankingsPath('digibranders', 'fynix') };

describe('DetailPageHeader', () => {
  it('names the page by its object, with a back link above it', async () => {
    const { container } = renderWithProviders(
      <DetailPageHeader back={BACK} objectName="seo audit tool" lang="de" facts="Berlin, Desktop" />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'seo audit tool' });
    expect(heading).toHaveAttribute('lang', 'de');
    const back = screen.getByRole('link', { name: 'Keywords' });
    expect(back).toHaveAttribute('href', '/digibranders/fynix/seo/keywords');
    // The back link comes first in the reading order
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('leaves out the language when the object has none to declare', () => {
    renderWithProviders(<DetailPageHeader back={BACK} objectName="seo audit" facts="Berlin" />);
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('lang');
  });

  it('shows the facts and the second line in the meta, and the badges after them', () => {
    renderWithProviders(
      <DetailPageHeader
        back={BACK}
        objectName="seo audit"
        facts="Berlin, Desktop, Google"
        secondary="Target /audits"
        badges={<Badge tone="warning">Stale</Badge>}
      />,
    );
    expect(screen.getByText('Berlin, Desktop, Google')).toBeInTheDocument();
    expect(screen.getByText('Target /audits')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
  });

  it('puts the actions beside the title and the tabs under it', () => {
    renderWithProviders(
      <DetailPageHeader
        back={BACK}
        objectName="seo audit"
        facts="Berlin"
        actions={<Button variant="primary">Check now</Button>}
        tabs={<div role="tablist" aria-label="Sections" />}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'seo audit' });
    const action = screen.getByRole('button', { name: 'Check now' });
    const tabs = screen.getByRole('tablist', { name: 'Sections' });
    const after = (first: Element, second: Element): boolean =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(after(heading, action)).toBe(true);
    expect(after(action, tabs)).toBe(true);
  });

  it('shows no actions area when it was given no actions', () => {
    renderWithProviders(<DetailPageHeader back={BACK} objectName="seo audit" facts="Berlin" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a neutral Archived badge in the meta line for an archived object, and none otherwise', () => {
    const { rerender } = renderWithProviders(
      <DetailPageHeader back={BACK} objectName="seo audit" facts="Berlin" archived archivedLabel="Archived" />,
    );
    expect(screen.getByText('Archived')).toBeInTheDocument();
    rerender(<DetailPageHeader back={BACK} objectName="seo audit" facts="Berlin" />);
    expect(screen.queryByText('Archived')).toBeNull();
  });
});
