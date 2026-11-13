import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportSource } from './citations-export';
import { ExportButton } from './export-button';
import type { EngineInScope } from './engine-share';
import type { MetricCell, SourceDomainRow, SourcePageRow, SourcesMeta } from '@/lib/citations/types';
import * as csv from '@/lib/csv/csv-write';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

// The file is not written: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csv>()),
  downloadBlob: vi.fn(),
}));

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SOURCE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RANGE = { from: '2026-10-16', to: '2026-11-12' };
const ENGINES: readonly EngineInScope[] = [{ code: 'chatgpt_web', label: 'ChatGPT' }];

const share = (units: number): MetricCell => ({
  value: units / 18420,
  numerator: units,
  denominator: 18420,
  n_observations: 4812,
});
const META: SourcesMeta = {
  window: { ...RANGE, timezone: 'UTC' },
  include_branded: false,
  engine_codes: ['chatgpt_web'],
  answers: 4812,
  answers_citing: 4000,
  citation_units: 18420,
  by_role: [],
  previous_answers: 4500,
};
const domain = (name: string, units: number): SourceDomainRow => ({
  registrable_domain: name,
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: units,
  observations: 10,
  prompts: 2,
  engines: [{ engine_code: 'chatgpt_web', citation_units: units }],
  source_share: share(units),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
  cited_with: { entity_id: 'ent-hubspot', observations: 4 },
});
const pageRow = (id: number): SourcePageRow => ({
  url_id: id,
  url: `https://g2.com/p${String(id)}`,
  title: 'A page',
  host: 'g2.com',
  registrable_domain: 'g2.com',
  domain_role: 'third_party',
  role_entity_id: null,
  citation_units: 5,
  observations: 3,
  prompts: 1,
  engines: [],
  source_share: share(5),
  first_seen_at: '2026-10-20T08:00:00Z',
  last_seen_at: '2026-11-10T08:00:00Z',
});

const domains = (rows: readonly SourceDomainRow[], total = rows.length): ExportSource => ({
  rows: { tab: 'domains', rows },
  total,
  meta: META,
});

function renderButton(source: ExportSource | null): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <ExportButton source={source} scope={SOURCE} previousMeta={undefined} engines={ENGINES} range={RANGE} />,
  );
}

const button = (): HTMLElement => screen.getByRole('button', { name: 'Export CSV' });
/** A toast is also written for assistive technology, so its text is found more than once. */
const said = async (text: string): Promise<void> => {
  expect(await screen.findAllByText(text)).not.toHaveLength(0);
};

beforeEach(() => {
  vi.mocked(csv.downloadBlob).mockClear();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  server.use(
    http.get(mswPath(`${P}/entities`), () =>
      HttpResponse.json({ data: [{ entity: { entity_id: 'ent-hubspot', canonical_name: 'HubSpot' } }] }),
    ),
  );
});
afterEach(() => {
  server.events.removeAllListeners();
});

describe('ExportButton', () => {
  it('downloads a CSV with a byte order mark under the name of the tab and the window', async () => {
    const { user, queryClient } = renderButton(domains([domain('g2.com', 1912), domain('hubspot.com', 1402)]));
    // The names of Cited with come from the entities read: the file is written once it has answered
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await user.click(button());
    expect(csv.downloadBlob).toHaveBeenCalledOnce();
    const [blob, name] = vi.mocked(csv.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('citations-domains-2026-10-16-to-2026-11-12.csv');
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) return;
    // `Blob.text()` drops the mark when it decodes, so the bytes are read
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = (await blob.text()).trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('g2.com,Third party,1912,10.38,18420,10,2,1912,HubSpot');
    expect(lines[2]).toContain('hubspot.com,Third party,1402,7.61,18420');
    await said('2 of 2 domains exported');
  });

  it('writes the pages of the Pages tab and says pages', async () => {
    const { user } = renderButton({ rows: { tab: 'pages', rows: [pageRow(1)] }, total: 1, meta: META });
    await user.click(button());
    const [, name] = vi.mocked(csv.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('citations-pages-2026-10-16-to-2026-11-12.csv');
    await said('1 of 1 page exported');
  });

  it('reports the truncation: the file holds the rows that are loaded, of all the scope has', async () => {
    const { user } = renderButton(domains([domain('g2.com', 1912), domain('hubspot.com', 1402)], 1204));
    await user.click(button());
    await said('2 of 1,204 domains exported');
  });

  it('is disabled with its reason while the rows are not loaded', async () => {
    const { user } = renderButton(null);
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    expect(button()).toHaveAccessibleDescription('The rows are not loaded.');
    await user.click(button());
    expect(csv.downloadBlob).not.toHaveBeenCalled();
  });

  it('is disabled with its reason when there is no row', () => {
    renderButton(domains([]));
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    expect(button()).toHaveAccessibleDescription('Nothing to export');
  });

  it('says so when the file cannot be made, and writes nothing', async () => {
    vi.mocked(csv.downloadBlob).mockImplementationOnce(() => {
      throw new Error('the browser refused');
    });
    const { user } = renderButton(domains([domain('g2.com', 1912)]));
    await user.click(button());
    await said('The file could not be made');
  });

  it('is axe clean, disabled and enabled', async () => {
    const off = renderButton(null);
    expect(await axe(off.container)).toHaveNoViolations();
    off.unmount();
    const on = renderButton(domains([domain('g2.com', 1912)]));
    expect(await axe(on.container)).toHaveNoViolations();
  });
});
