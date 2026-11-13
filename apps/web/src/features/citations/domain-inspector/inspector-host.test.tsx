import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CitationInspectorHost } from './inspector-host';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import type { SourceDomainDetail, SourcePageRow } from '@/lib/citations/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// The address the page is at: a window, an engine, the open domain and its tab
vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      'from=2026-10-16&to=2026-11-12&engine=chatgpt_web&tab=domains&inspect=domain%3Ag2.com&itab=pages',
    ),
}));

// jsdom has no canvas: the trend's chart is drawn as a stand-in
vi.mock('@/components/app/chart/echart', () => ({
  EChart: () => <div data-testid="echart-canvas" />,
}));

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PROMPT_ID = '0c1f4e7b-0000-4000-8000-000000000001';

const pageOf = (index: number): SourcePageRow => ({
  url: `https://g2.com/page-${index}`,
  url_id: 100 + index,
  title: null,
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 100 - index,
  observations: 10,
  prompts: 2,
  engines: [],
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  source_share: { value: 0.01, numerator: 1, denominator: 100, n_observations: 100 },
});

const DETAIL: SourceDomainDetail = {
  data: {
    registrable_domain: 'g2.com',
    rows: [
      {
        registrable_domain: 'g2.com',
        domain_role: 'third_party',
        role_entity_id: null,
        citation_units: 10,
        observations: 5,
        prompts: 2,
        engines: [{ engine_code: 'chatgpt_web', citation_units: 10 }],
        source_share: { value: 0.1, numerator: 10, denominator: 100, n_observations: 50 },
        first_seen_at: '2026-10-20T08:00:00Z',
        last_seen_at: '2026-11-10T08:00:00Z',
      },
    ],
    engines: [],
    top_pages: Array.from({ length: 10 }, (_, index) => pageOf(index + 1)),
    prompts: [{ prompt_id: PROMPT_ID, citation_units: 9, observations: 3 }],
    cited_with: [],
  },
  meta: {
    window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
    include_branded: false,
    engine_codes: ['chatgpt_web'],
    answers: 50,
    answers_citing: 5,
    citation_units: 100,
    by_role: [],
  },
};

function Host({ tab }: { tab: string }): ReactElement {
  return (
    <InspectorLayout
      inspector={
        <CitationInspectorHost
          target={{ type: 'domain', id: 'G2.com' }}
          source={{ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' }}
          filters={{ from: '2026-10-16', to: '2026-11-12', engines: ['chatgpt_web'] }}
          timeZone="UTC"
          workspaceSlug="digibranders"
          projectSlug="fynix"
          engines={[{ code: 'chatgpt_web', label: 'ChatGPT' }]}
          position={null}
          onStep={vi.fn()}
          tab={tab}
          onTabChange={vi.fn()}
          onClose={vi.fn()}
        />
      }
    >
      <p>The list</p>
    </InspectorLayout>
  );
}

beforeEach(() => {
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  server.use(
    http.get(mswPath(`${P}/ai/sources/domains/:registrable_domain`), () => HttpResponse.json(DETAIL)),
    http.get(mswPath(`${P}/prompts`), () =>
      HttpResponse.json({ data: [{ prompt_id: PROMPT_ID, current_version: { text: 'Which CRM?' } }] }),
    ),
    http.get(mswPath(`${P}/ai/citations`), () =>
      HttpResponse.json({ data: [], page: { has_more: false, limit: 100, next_cursor: null } }),
    ),
  );
  return restoreWideScreen;
});

describe('the links of the domain inspector tabs', () => {
  it('a page opens its source inspector beside the list as it is, on a tab of its own', async () => {
    renderWithProviders(<Host tab="pages" />);
    const inspector = await screen.findByRole('complementary', { name: 'g2.com' });
    const link = await within(inspector).findByRole('link', { name: 'g2.com/page-3' });
    const href = new URL(String(link.getAttribute('href')), 'https://example.test');
    expect(href.pathname).toBe('/digibranders/fynix/ai/citations');
    expect(href.searchParams.get('inspect')).toBe('source:103');
    expect(href.searchParams.get('itab')).toBeNull();
    expect(href.searchParams.get('from')).toBe('2026-10-16');
    expect(href.searchParams.get('engine')).toBe('chatgpt_web');
    expect(href.searchParams.get('tab')).toBe('domains');
  });

  it('View all pages keeps the window and the engines and leaves the inspector behind', async () => {
    renderWithProviders(<Host tab="pages" />);
    const inspector = await screen.findByRole('complementary', { name: 'g2.com' });
    const link = await within(inspector).findByRole('link', { name: 'View all pages' });
    const href = new URL(String(link.getAttribute('href')), 'https://example.test');
    expect(href.pathname).toBe('/digibranders/fynix/ai/citations');
    expect(href.searchParams.get('tab')).toBe('pages');
    expect(href.searchParams.get('domain')).toBe('equals:g2.com');
    expect(href.searchParams.get('from')).toBe('2026-10-16');
    expect(href.searchParams.get('engine')).toBe('chatgpt_web');
    expect(href.searchParams.has('inspect')).toBe(false);
    expect(href.searchParams.has('itab')).toBe(false);
  });

  it('a prompt opens on the prompts page and names only the record', async () => {
    renderWithProviders(<Host tab="prompts" />);
    const inspector = await screen.findByRole('complementary', { name: 'g2.com' });
    const link = await within(inspector).findByRole('link', { name: 'Which CRM?' });
    expect(link).toHaveAttribute('href', `/digibranders/fynix/ai/prompts?inspect=prompt%3A${PROMPT_ID}`);
  });
});
