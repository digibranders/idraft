import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DomainPromptsTab, type DomainPromptsTabProps } from './domain-prompts-tab';
import type { DomainDetailRead } from './domain-reads';
import type { CitationRow, DomainPrompt, EngineCode, SourceDomainDetail, SourceScope } from '@/lib/citations/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PROMPTS = mswPath(`${P}/prompts`);
const CITATIONS = mswPath(`${P}/ai/citations`);
const SOURCE: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' };
const FILTERS = { from: '2026-10-16', to: '2026-11-12' };
const ENGINES: readonly { code: EngineCode; label: string }[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
];
const promptHrefOf = (id: string): Route => `/digibranders/fynix/ai/prompts?inspect=prompt%3A${id}` as Route;

const idOf = (index: number): string => `0c1f4e7b-0000-4000-8000-${String(index).padStart(12, '0')}`;
const textOf = (index: number): string => `Which CRM is best for team ${index}?`;

const promptOf = (index: number, citation_units: number, observations = 10): DomainPrompt => ({
  prompt_id: idOf(index),
  citation_units,
  observations,
});

const citationOf = (index: number, engine_code: EngineCode): CitationRow => ({
  citation_index: 1,
  citation_kind: 'inline',
  domain_role: 'third_party',
  engine_code,
  host: 'g2.com',
  observation_id: `obs-${index}-${engine_code}`,
  observed_at: '2026-11-10T08:00:00Z',
  occurrences: 1,
  prompt_id: idOf(index),
  raw_url: 'https://g2.com/a',
  registrable_domain: 'g2.com',
  role_entity_id: null,
  title: null,
  url: 'https://g2.com/a',
  url_id: 1,
});

const serveTexts = (indexes: readonly number[]): void => {
  server.use(
    http.get(PROMPTS, () =>
      HttpResponse.json({
        data: indexes.map((index) => ({ prompt_id: idOf(index), current_version: { text: textOf(index) } })),
      }),
    ),
  );
};
const serveCitations = (rows: readonly CitationRow[], hasMore = false): void => {
  server.use(
    http.get(CITATIONS, () =>
      HttpResponse.json({ data: rows, page: { has_more: hasMore, limit: 100, next_cursor: null } }),
    ),
  );
};

const dataOf = (prompts: DomainPrompt[]): SourceDomainDetail['data'] => ({
  registrable_domain: 'g2.com',
  rows: [],
  engines: [],
  top_pages: [],
  prompts,
  cited_with: [],
});
const readOf = (status: DomainDetailRead['status'], data: SourceDomainDetail['data'] | null): DomainDetailRead => ({
  status,
  data: data === null ? undefined : { data, meta: {} as SourceDomainDetail['meta'] },
  errorId: null,
  retry: vi.fn(),
  retrying: false,
  notFound: false,
});

function Tab(props: Partial<DomainPromptsTabProps> & { prompts?: DomainPrompt[] } = {}): ReactElement {
  const { prompts = [promptOf(1, 50), promptOf(2, 40)], ...rest } = props;
  const data = dataOf(prompts);
  return (
    <DomainPromptsTab
      source={SOURCE}
      filters={FILTERS}
      domain="g2.com"
      data={data}
      read={readOf('ready', data)}
      refetching={false}
      engines={ENGINES}
      promptHrefOf={promptHrefOf}
      {...rest}
    />
  );
}

const table = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Prompts whose answers cite g2.com' });
const rowOf = async (text: string): Promise<HTMLElement> => {
  const row = (await within(await table()).findByText(text)).closest('tr');
  if (row === null) throw new Error(`No row for ${text}`);
  return row;
};
const tooltip = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="tooltip"]');

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  serveTexts([1, 2]);
  serveCitations([citationOf(1, 'chatgpt_web'), citationOf(2, 'gemini_web')]);
});

describe('the Prompts tab of the domain inspector', () => {
  it('shows the prompt text from the prompts read, with its units and answers', async () => {
    renderWithProviders(<Tab prompts={[promptOf(1, 1234, 321)]} />);
    const row = await rowOf(textOf(1));
    expect(within(row).getByText('1,234')).toBeInTheDocument();
    expect(within(row).getByText('321')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Top prompts' })).toBeInTheDocument();
  });

  it('lists at most 10 prompts, the most cited first', async () => {
    const many = Array.from({ length: 13 }, (_, index) => promptOf(index + 1, index + 1));
    serveTexts(many.map((_, index) => index + 1));
    renderWithProviders(<Tab prompts={many} />);
    await rowOf(textOf(13));
    const rows = within(await table()).getAllByRole('row');
    expect(rows).toHaveLength(11);
    expect(rows[1]).toHaveTextContent(textOf(13));
    expect(rows[10]).toHaveTextContent(textOf(4));
    expect(within(await table()).queryByText(textOf(3))).toBeNull();
  });

  it('shows the id of a prompt whose text is not read and says text n/a, never a blank', async () => {
    serveTexts([1]);
    renderWithProviders(<Tab prompts={[promptOf(1, 50), promptOf(2, 40)]} />);
    const row = await rowOf(`Prompt ${idOf(2)}, text n/a`);
    expect(row).toHaveTextContent(idOf(2));
    expect(await rowOf(textOf(1))).toBeInTheDocument();
  });

  it('shows the id for every prompt when the prompts read fails, and still lists the prompts', async () => {
    server.use(http.get(PROMPTS, () => HttpResponse.json({ title: 'down' }, { status: 500 })));
    renderWithProviders(<Tab />);
    expect(await screen.findByText(`Prompt ${idOf(1)}, text n/a`)).toBeInTheDocument();
    expect(screen.getByText(`Prompt ${idOf(2)}, text n/a`)).toBeInTheDocument();
  });

  it('takes the engines from one read of the citations of the domain, limit 100, not one read per prompt', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(CITATIONS, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json({
          data: [
            citationOf(1, 'google_ai_mode'),
            citationOf(1, 'chatgpt_web'),
            citationOf(1, 'chatgpt_web'),
            citationOf(2, 'gemini_web'),
          ],
          page: { has_more: false, limit: 100, next_cursor: null },
        });
      }),
    );
    renderWithProviders(<Tab prompts={[promptOf(1, 50), promptOf(2, 40)]} />);
    const first = await rowOf(textOf(1));
    await waitFor(() => expect(within(first).getByText('ChatGPT')).toBeInTheDocument());
    // Once each, in the engine order of the project, whatever order the rows came in
    expect(
      within(first)
        .getAllByText(/^(ChatGPT|Gemini|AI Mode)$/)
        .map((node) => node.textContent),
    ).toEqual(['ChatGPT', 'AI Mode']);
    expect(within(await rowOf(textOf(2))).getByText('Gemini')).toBeInTheDocument();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('limit')).toBe('100');
    expect(asked[0]?.searchParams.get('filter[registrable_domain]')).toBe('g2.com');
    expect(asked[0]?.searchParams.get('from')).toBe('2026-10-16');
    expect(asked[0]?.searchParams.has('include_unresolved_redirects')).toBe(false);
    expect(asked[0]?.searchParams.has('include_engine_internal')).toBe(false);
  });

  it('reads the citations of the whole domain, whatever role the page filters to', async () => {
    const asked: URL[] = [];
    server.use(
      http.get(CITATIONS, ({ request }) => {
        asked.push(new URL(request.url));
        return HttpResponse.json({ data: [], page: { has_more: false, limit: 100, next_cursor: null } });
      }),
    );
    renderWithProviders(<Tab filters={{ ...FILTERS, roles: ['own'] }} />);
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]?.searchParams.has('filter[domain_role_in]')).toBe(false);
  });

  it('says n/a with the reason for a prompt that has no engine in those rows, never blank', async () => {
    serveCitations([citationOf(1, 'chatgpt_web'), citationOf(1, 'gemini_web')], true);
    const { user } = renderWithProviders(<Tab prompts={[promptOf(1, 50), promptOf(2, 40)]} />);
    const missing = await rowOf(textOf(2));
    const na = await within(missing).findByText('n/a');
    expect(na).toBeInTheDocument();
    await user.hover(na);
    await waitFor(() =>
      expect(tooltip()).toHaveTextContent(
        'Only the latest 2 citations of this domain were read, and none of them is for this prompt.',
      ),
    );
    // The cell of the prompt that has an engine says it and nothing else
    expect(within(await rowOf(textOf(1))).queryByText('n/a')).toBeNull();
  });

  it('keeps the prompts and says the engines read n/a when the citations read fails', async () => {
    server.use(http.get(CITATIONS, () => HttpResponse.json({ title: 'down' }, { status: 500 })));
    renderWithProviders(<Tab />);
    expect(
      await screen.findByText('The engines of the prompts could not be loaded, so they read n/a.'),
    ).toBeInTheDocument();
    expect(await rowOf(textOf(1))).toBeInTheDocument();
    expect(within(await rowOf(textOf(1))).getByText('n/a')).toBeInTheDocument();
    expect(within(await rowOf(textOf(2))).getByText('n/a')).toBeInTheDocument();
    expect(screen.queryByText('The prompts could not be loaded.')).toBeNull();
  });

  it('opens the prompt inspector on the prompts page from a row (a real link to inspect=prompt:id)', async () => {
    renderWithProviders(<Tab />);
    const link = await within(await table()).findByRole('link', { name: textOf(1) });
    expect(link).toHaveAttribute('href', `/digibranders/fynix/ai/prompts?inspect=prompt%3A${idOf(1)}`);
  });

  it('shows the text of a prompt as text, never as markup', async () => {
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json({
          data: [{ prompt_id: idOf(1), current_version: { text: '<b onmouseover=alert(1)>bold</b> CRM?' } }],
        }),
      ),
    );
    renderWithProviders(<Tab prompts={[promptOf(1, 50)]} />);
    expect(await screen.findByText('<b onmouseover=alert(1)>bold</b> CRM?')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('says so, with the reason, when no prompt cites the domain', async () => {
    renderWithProviders(<Tab prompts={[]} />);
    expect(await screen.findByText('No prompt cites this domain')).toBeInTheDocument();
    expect(screen.getByText('No answer read in this window cites it.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows skeleton rows while the domain is read', () => {
    renderWithProviders(<Tab data={null} read={readOf('loading', null)} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Top prompts' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText('No prompt cites this domain')).toBeNull();
  });

  it('shows an error with Retry that asks again when the domain read failed', async () => {
    const read = readOf('error', null);
    const { user } = renderWithProviders(<Tab data={null} read={read} />);
    expect(screen.getByText('The prompts could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(read.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps its rows and says it is busy while a new window is read', async () => {
    renderWithProviders(<Tab refetching />);
    await rowOf(textOf(1));
    expect((await table()).closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<Tab />);
    const first = await rowOf(textOf(1));
    await waitFor(() => expect(within(first).getByText('ChatGPT')).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
