import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DrawerSearchTab } from './drawer-search-tab';
import type { PageDrawerContext } from './page-drawer-context';
import { renderWithProviders } from '@/test/render';

const panel = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock('@/features/page-search', () => ({
  PageSearchPanel: (props: unknown) => {
    panel.props.push(props);
    return <p>Search panel</p>;
  },
}));
vi.mock('@/lib/pages/search-daily', () => ({ usePageSearchDaily: () => ({ state: 'unavailable' }) }));
vi.mock('@/lib/permissions', () => ({ canManageIntegrations: () => false, useMembership: () => null }));

const CONTEXT = {
  scope: { workspaceId: 'w1', projectId: 'p1' },
  workspaceSlug: 'acme',
  projectSlug: 'site',
  timeZone: 'UTC',
  crawl: { run: null },
  hrefs: { integrations: '/acme/site/integrations/google' },
} as unknown as PageDrawerContext;

describe('the Search tab of the page drawer', () => {
  it('draws the page search panel of the page, then the keywords', () => {
    renderWithProviders(
      <DrawerSearchTab
        context={CONTEXT}
        urlId="108"
        url="https://example.com/pricing"
        statusCode={404}
        keywords={<p>Keywords card</p>}
      />,
    );
    expect(screen.getByText('Search panel')).toBeInTheDocument();
    expect(screen.getByText('Keywords card')).toBeInTheDocument();
    expect(panel.props.at(-1)).toEqual({
      workspaceId: 'w1',
      projectId: 'p1',
      workspaceSlug: 'acme',
      projectSlug: 'site',
      urlId: '108',
      statusCode: 404,
      timeZone: 'UTC',
    });
  });

  it('draws no panel while the page read is pending', () => {
    renderWithProviders(<DrawerSearchTab context={CONTEXT} urlId="108" url={null} statusCode={null} keywords={null} />);
    expect(screen.queryByText('Search panel')).toBeNull();
  });
});
