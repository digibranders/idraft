import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SourcePromptsTab, type SourcePromptsTabProps } from './source-prompts-tab';
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

const rowOf = (index: number, overrides: Partial<CitationRow> = {}): CitationRow => ({
  citation_index: 1,
  citation_kind: 'link',
  domain_role: 'third_party',
  engine_code: 'chatgpt_web',
  host: 'g2.com',
  observation_id: `obs-${index}`,
  observed_at: '2026-11-10T08:00:00Z',
  occurrences: 1,
  prompt_id: idOf(index),
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

function Tab(props: Partial<SourcePromptsTabProps> = {}): ReactElement {
  return (
    <SourcePromptsTab
      source={SOURCE}
      citations={readOf('ready', pageOf([rowOf(1), rowOf(2, { engine_code: 'gemini_web' })]))}
      refetching={false}
      engines={ENGINES}
      timeZone="UTC"
      promptsHref={PROMPTS_HREF}
      {...props}
    />
  );
}

const table = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'Prompts whose answers cite this page' });
const rowOfText = async (text: string): Promise<HTMLElement> => {
  const row = (await within(await table()).findByText(text)).closest('tr');
  if (row === null) throw new Error(`No row for ${text}`);
  return row;
};

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

describe('the Prompts tab of the source inspector', () => {
  it('shows the prompt text from the prompts read, with its engines, answers and last cited time', async () => {
    renderWithProviders(
      <Tab
        citations={readOf(
          'ready',
          pageOf([
            rowOf(1, { observation_id: 'a', engine_code: 'google_ai_mode', observed_at: '2026-11-02T09:00:00Z' }),
            rowOf(1, { observation_id: 'b', engine_code: 'chatgpt_web', observed_at: '2026-11-09T09:30:00Z' }),
            // The same answer lists the page a second time
            rowOf(1, {
              observation_id: 'b',
              engine_code: 'chatgpt_web',
              citation_index: 4,
              observed_at: '2026-11-09T09:30:00Z',
            }),
          ]),
        )}
      />,
    );
    const row = await rowOfText(textOf(1));
    // Engines once each, in the engine order; a page listed twice in one answer is one answer
    expect(
      within(row)
        .getAllByText(/^(ChatGPT|Gemini|AI Mode)$/)
        .map((node) => node.textContent),
    ).toEqual(['ChatGPT', 'AI Mode']);
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('Nov 9, 09:30')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Prompts citing this page' })).toBeInTheDocument();
  });

  it('shows the id of a prompt whose text is not read and says text n/a, never a blank', async () => {
    serveTexts([1]);
    renderWithProviders(<Tab />);
    const row = await rowOfText(`Prompt ${idOf(2)}, text n/a`);
    expect(row).toHaveTextContent(idOf(2));
    expect(await rowOfText(textOf(1))).toBeInTheDocument();
  });

  it('shows the id for every prompt when the prompts read fails, and still lists the prompts', async () => {
    server.use(http.get(PROMPTS, () => HttpResponse.json({ title: 'down' }, { status: 500 })));
    renderWithProviders(<Tab />);
    expect(await screen.findByText(`Prompt ${idOf(1)}, text n/a`)).toBeInTheDocument();
    expect(screen.getByText(`Prompt ${idOf(2)}, text n/a`)).toBeInTheDocument();
  });

  it('reads nothing of its own from the citations route: the rows are the inspector read', async () => {
    const asked = watchCitations();
    renderWithProviders(<Tab />);
    await rowOfText(textOf(1));
    expect(asked).toHaveLength(0);
  });

  it('opens the prompt inspector on the prompts page from a row (a real link to inspect=prompt:id)', async () => {
    renderWithProviders(<Tab />);
    const link = await within(await table()).findByRole('link', { name: textOf(1) });
    expect(link).toHaveAttribute('href', `/digibranders/fynix/ai/prompts?inspect=prompt%3A${idOf(1)}`);
  });

  it('says it is based on the latest N citations when the page has more than the read took', async () => {
    renderWithProviders(<Tab citations={readOf('ready', pageOf([rowOf(1), rowOf(2)], true))} />);
    expect(await screen.findByText('Based on the latest 2 citations of this page.')).toBeInTheDocument();
  });

  it('says nothing of a cut when the read took every citation', async () => {
    renderWithProviders(<Tab />);
    await rowOfText(textOf(1));
    expect(screen.queryByText(/Based on the latest/)).toBeNull();
  });

  it('lists at most 10 prompts, the most answers first', async () => {
    const rows: CitationRow[] = [];
    for (let prompt = 1; prompt <= 12; prompt += 1) {
      for (let answer = 0; answer < prompt; answer += 1) {
        rows.push(rowOf(prompt, { observation_id: `o-${prompt}-${answer}` }));
      }
    }
    serveTexts(Array.from({ length: 12 }, (_, index) => index + 1));
    renderWithProviders(<Tab citations={readOf('ready', pageOf(rows))} />);
    await rowOfText(textOf(12));
    const lines = within(await table()).getAllByRole('row');
    expect(lines).toHaveLength(11);
    expect(lines[1]).toHaveTextContent(textOf(12));
    expect(within(await table()).queryByText(textOf(2))).toBeNull();
  });

  it('shows the text of a prompt as text, never as markup', async () => {
    server.use(
      http.get(PROMPTS, () =>
        HttpResponse.json({
          data: [{ prompt_id: idOf(1), current_version: { text: '<b onmouseover=alert(1)>bold</b> CRM?' } }],
        }),
      ),
    );
    renderWithProviders(<Tab citations={readOf('ready', pageOf([rowOf(1)]))} />);
    expect(await screen.findByText('<b onmouseover=alert(1)>bold</b> CRM?')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('says so, with the reason, when no prompt cites the page', async () => {
    renderWithProviders(<Tab citations={readOf('ready', pageOf([]))} />);
    expect(await screen.findByText('No prompt cites this page')).toBeInTheDocument();
    expect(screen.getByText('No answer read in this window cites it.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows skeleton rows while the citations are read', () => {
    renderWithProviders(<Tab citations={readOf('loading', undefined)} />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Prompts citing this page' }).closest('section'),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No prompt cites this page')).toBeNull();
  });

  it('shows an error with Retry that asks again when the citations read failed', async () => {
    const citations = readOf('error', undefined);
    const { user } = renderWithProviders(<Tab citations={citations} />);
    expect(screen.getByText('This source could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(citations.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps its rows and says it is busy while a new window is read', async () => {
    renderWithProviders(<Tab refetching />);
    await rowOfText(textOf(1));
    expect((await table()).closest('[aria-busy="true"]')).not.toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<Tab />);
    await waitFor(async () => expect(await rowOfText(textOf(1))).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
