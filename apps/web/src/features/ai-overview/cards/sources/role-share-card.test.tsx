import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { domainPage, sourcesMeta } from './model/source-fixtures';
import RoleShareCard from './role-share-card';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { SourceDomainPage } from '@/lib/citations/types';
import { axe } from '@/test/axe';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const DOMAINS = '*/api/v1/workspaces/:w/projects/:p/ai/sources/domains';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(page: SourceDomainPage): ReturnType<typeof renderWithProviders> {
  server.use(http.get(DOMAINS, () => HttpResponse.json(page)));
  const Card = (props: CardProps): ReactElement => (
    <CardInfoProvider>
      <RoleShareCard {...props} />
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.citation_share_by_domain_type', Card, width: 'half' }), {
    searchParams: 'cmp=off',
  });
}

describe('the citations by domain type card', () => {
  it('names the role shares in the label of the treemap, which add up to all the units of the scope', async () => {
    render(
      domainPage(
        [],
        sourcesMeta({ units: 1000, answers: 120, byRole: { own: 90, competitor: 210, third_party: 700 } }),
      ),
    );
    const treemap = await screen.findByRole('img', {
      name: /^Citation units by domain type: .*Your site 9%.*Competitor 21%.*Third party 70%$/,
    });
    expect(treemap).toBeInTheDocument();
    expect(screen.getByText('area is share of citation units')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Citations by domain type' })).toBeInTheDocument();
  });

  it('has the preview info button text, saying the types are roles until the API classifies domains', async () => {
    render(domainPage([], sourcesMeta()));
    await screen.findByRole('img', { name: /Citation units by domain type/ });
    expect(screen.getByRole('button', { name: /about citations by domain type/i })).toBeInTheDocument();
    expect(screen.getByText(/What kinds of domains AI answers cite\./)).toBeInTheDocument();
  });

  it('keeps its header and says the preview reason when no answer cited a page', async () => {
    render(
      domainPage([], sourcesMeta({ units: 0, answers: 120, byRole: { own: 0, competitor: 0, third_party: 0 } }), 0),
    );
    expect(await screen.findByText('No citations yet')).toBeInTheDocument();
    expect(screen.getByText('No answers cited a page in this scope.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Citations by domain type' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Citation units by domain type/ })).not.toBeInTheDocument();
  });

  it('passes axe', async () => {
    const { container } = render(domainPage([], sourcesMeta()));
    await screen.findByRole('img', { name: /Citation units by domain type/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});
