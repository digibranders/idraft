import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceAnswersTab, type SourceAnswersTabProps } from './source-answers-tab';
import type { SourceCitationsRead } from './source-reads';
import type { CitationPage, CitationRow, EngineCode, SourceScope } from '@/lib/citations/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PROMPTS = mswPath(`${P}/prompts`);
const SOURCE: SourceScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: 'p-fynix' };
const ENGINES: readonly { code: EngineCode; label: string }[] = [
  { code: 'chatgpt_web', label: 'ChatGPT' },
  { code: 'gemini_web', label: 'Gemini' },
  { code: 'google_ai_mode', label: 'AI Mode' },
];
const PROMPTS_HREF = '/digibranders/fynix/ai/prompts' as Route;

const idOf = (index: number): string => `0c1f4e7b-0000-4000-8000-${String(index).padStart(12, '0')}`;
const textOf = (index: number): string => `Which CRM is best for team ${index}?`;

const rowOf = (observation: number, overrides: Partial<CitationRow> = {}): CitationRow => ({
  citation_index: 3,
  citation_kind: 'link',
  domain_role: 'third_party',
  engine_code: 'chatgpt_web',
  host: 'g2.com',
  observation_id: String(observation),
  observed_at: '2026-11-10T08:00:00Z',
  occurrences: 1,
  prompt_id: idOf(1),
  raw_url: 'https://g2.com/a',
  registrable_domain: 'g2.com',
  role_entity_id: null,
  title: null,
  url: 'https://g2.com/a',
  url_id: 7,
  ...overrides,
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

const pageOf = (rows: readonly CitationRow[], hasMore = false): CitationPage => ({
  data: [...rows],
  page: { has_more: hasMore, limit: 100, next_cursor: null },
});
const readOf = (
  status: SourceCitationsRead['status'],
  data: CitationPage | undefined,
  overrides: Partial<SourceCitationsRead> = {},
): SourceCitationsRead => ({
  status,
  data,
  errorId: null,
  retry: vi.fn(),
  retrying: false,
  notFound: false,
  ...overrides,
});

function Tab(props: Partial<SourceAnswersTabProps> = {}): ReactElement {
  return (
    <SourceAnswersTab
      source={SOURCE}
      citations={readOf('ready', pageOf([rowOf(1001), rowOf(1002, { engine_code: 'gemini_web', prompt_id: idOf(2) })]))}
      refetching={false}
      engines={ENGINES}
      timeZone="UTC"
      promptsHref={PROMPTS_HREF}
      {...props}
    />
  );
}

const table = (): Promise<HTMLElement> =>
  screen.findByRole('table', { name: 'The latest answers that cite this page' });
const bodyRows = async (): Promise<HTMLElement[]> =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

/** Every request to the citations route: the tab is handed the rows, so it must make none. */
function watchCitations(): URL[] {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/ai/citations')) seen.push(url);
  });
  return seen;
}

beforeEach(() => {
  // Thursday 12 November 2026: a time without a year reads the same on any day the suite runs
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  server.events.removeAllListeners();
  serveTexts([1, 2]);
});
afterEach(() => {
  vi.useRealTimers();
  server.events.removeAllListeners();
});

describe('the Answers tab of the source inspector', () => {
  it('lists at most 10 answers, the newest first, each with its date, engine and prompt', async () => {
    const rows = Array.from({ length: 13 }, (_, index) =>
      rowOf(2000 + index, { observed_at: `2026-11-${String(index + 1).padStart(2, '0')}T08:00:00Z` }),
    );
    renderWithProviders(<Tab citations={readOf('ready', pageOf([...rows].reverse()))} />);
    await waitFor(async () => expect(await bodyRows()).toHaveLength(10));
    const lines = await bodyRows();
    expect(lines[0]).toHaveTextContent('Nov 13, 08:00');
    expect(lines[9]).toHaveTextContent('Nov 4, 08:00');
    expect(within(lines[0] as HTMLElement).getByText('ChatGPT')).toBeInTheDocument();
    expect(await within(lines[0] as HTMLElement).findByText(textOf(1))).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Last answers' })).toBeInTheDocument();
  });

  it('puts the date in a time element', async () => {
    renderWithProviders(<Tab />);
    const [first] = await bodyRows();
    const time = within(first as HTMLElement).getByText('Nov 10, 08:00');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-10T08:00:00Z');
  });

  it('says the place the page has in the answer list, and never claims a rank or a total', async () => {
    renderWithProviders(<Tab citations={readOf('ready', pageOf([rowOf(1001, { citation_index: 3 })]))} />);
    const [first] = await bodyRows();
    expect(within(first as HTMLElement).getByText('Listed as source 3 in the answer')).toBeInTheDocument();
    const text = (await table()).textContent ?? '';
    expect(text).not.toMatch(/rank/i);
    expect(text).not.toContain('#');
    expect(text).not.toMatch(/source 3 of/i);
  });

  it('counts a page an answer lists twice as one answer, at its first place', async () => {
    renderWithProviders(
      <Tab
        citations={readOf(
          'ready',
          pageOf([
            rowOf(1001, { citation_index: 6 }),
            rowOf(1001, { citation_index: 2 }),
            rowOf(1002, { citation_index: 4, observed_at: '2026-11-09T08:00:00Z' }),
          ]),
        )}
      />,
    );
    await waitFor(async () => expect(await bodyRows()).toHaveLength(2));
    const lines = await bodyRows();
    expect(lines[0]).toHaveTextContent('Listed as source 2 in the answer');
  });

  it('links Open evidence to the answer on the prompts page, with the marker to show', async () => {
    renderWithProviders(<Tab citations={readOf('ready', pageOf([rowOf(1001, { citation_index: 3 })]))} />);
    const link = await screen.findByRole('link', {
      name: 'Open the evidence of the answer of Nov 10, 08:00, source 3',
    });
    expect(link).toHaveAttribute('href', '/digibranders/fynix/ai/prompts?inspect=answer%3A1001&cite=3');
    expect(link).toHaveTextContent('Open evidence');
  });

  it('names each evidence link by its own answer and source', async () => {
    renderWithProviders(
      <Tab
        citations={readOf(
          'ready',
          pageOf([
            rowOf(1001, { citation_index: 3, observed_at: '2026-11-10T08:00:00Z' }),
            rowOf(1002, { citation_index: 8, observed_at: '2026-11-09T15:45:00Z' }),
          ]),
        )}
      />,
    );
    const links = await screen.findAllByRole('link');
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Open the evidence of the answer of Nov 10, 08:00, source 3',
      'Open the evidence of the answer of Nov 9, 15:45, source 8',
    ]);
    expect(links[1]).toHaveAttribute('href', '/digibranders/fynix/ai/prompts?inspect=answer%3A1002&cite=8');
  });

  it('shows the id of a prompt whose text is not read and says text n/a', async () => {
    serveTexts([2]);
    renderWithProviders(<Tab citations={readOf('ready', pageOf([rowOf(1001)]))} />);
    expect(await screen.findByText(`Prompt ${idOf(1)}, text n/a`)).toBeInTheDocument();
  });

  it('shows the text of a prompt as text, never as markup', async () => {
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json({
          data: [{ prompt_id: idOf(1), current_version: { text: '<b onmouseover=alert(1)>bold</b> CRM?' } }],
        }),
      ),
    );
    renderWithProviders(<Tab citations={readOf('ready', pageOf([rowOf(1001)]))} />);
    expect(await screen.findByText('<b onmouseover=alert(1)>bold</b> CRM?')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('reads nothing of its own from the citations route: the rows are the inspector read', async () => {
    const asked = watchCitations();
    renderWithProviders(<Tab />);
    await bodyRows();
    expect(asked).toHaveLength(0);
  });

  it('says so, with the reason, when no answer cites the page', async () => {
    renderWithProviders(<Tab citations={readOf('ready', pageOf([]))} />);
    expect(await screen.findByText('No answer cites this page')).toBeInTheDocument();
    expect(
      screen.getByText('No answer read in this window cites it. Choose a longer window or another engine.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows skeleton rows while the citations are read', () => {
    renderWithProviders(<Tab citations={readOf('loading', undefined)} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Last answers' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText('No answer cites this page')).toBeNull();
  });

  it('shows an error with Retry that asks again when the citations read failed', async () => {
    const citations = readOf('error', undefined);
    const { user } = renderWithProviders(<Tab citations={citations} />);
    expect(screen.getByText('The answers could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(citations.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps its rows and says it is busy while a new window is read', async () => {
    renderWithProviders(<Tab refetching />);
    await bodyRows();
    expect((await table()).closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<Tab />);
    await waitFor(async () => expect(await screen.findByText(textOf(1))).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
