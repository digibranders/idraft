import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptsScreen } from './prompts-screen';
import type { Prompt, Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERM_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { NO_COUNTS, promptCells, topicCells, type Counts } from '@/mocks/prompt-summary';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
}));

/** Thursday 12 November 2026, noon UTC: the 02:00 run has answered. */
const NOW = new Date('2026-11-12T12:00:00Z');
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const SUMMARY_PATH = mswPath(`${P}/ai/prompts-summary`);
const LIST_PATH = mswPath(`${P}/prompts`);

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const FYNIX_ID = fynix.project_id;

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubWideScreen();
});
afterEach(() => {
  vi.useRealTimers();
  restoreWideScreen();
});

function promptsAs(role: Role): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Suspense fallback={null}>
        <PromptsScreen
          workspaceId={MOCK_WORKSPACE.workspace_id}
          workspaceSlug={MOCK_WORKSPACE.slug}
          project={{
            id: FYNIX_ID,
            slug: 'fynix',
            name: 'Fynix',
            timeZone: 'Europe/Berlin',
            defaultLanguage: 'en',
            defaultCountryIso: 'DE',
          }}
        />
      </Suspense>
    </PermissionProvider>
  );
}

const renderOn = (role: Role, searchParams: string): ProvidedRender =>
  renderWithProviders(promptsAs(role), { searchParams });
const treegrid = (): Promise<HTMLElement> => screen.findByRole('treegrid', { name: 'Topics' });
const drawer = (name: string): Promise<HTMLElement> => screen.findByRole('complementary', { name });
const inspect = (target: string, tab?: string): string =>
  `?inspect=${encodeURIComponent(target)}${tab === undefined ? '' : `&itab=${tab}`}`;

describe('the topic drawer: opening', () => {
  it('opens on Overview from the name of a topic, and the chevron only opens the row', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(promptsAs('viewer'), {
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    await user.click(within(tree).getByRole('button', { name: 'Open the topic Paid Search' }));
    const panel = await drawer('Paid Search');
    expect(new URLSearchParams(writes.at(-1)).get('inspect')).toBe(`topic:${MOCK_TERM_IDS.paidSearch}`);
    expect(within(panel).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(within(panel).getByText('2 prompts')).toBeInTheDocument();
    expect(await within(panel).findByRole('heading', { name: 'Top prompts' })).toBeInTheDocument();
    // A drawer to read: nothing in it changes a prompt, for any member
    expect(within(panel).queryByRole('button', { name: /Run now|Archive/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add prompts' })).toBeNull();
  });

  it('offers the prompts of an open parent in Show all, which opens the drawer on its Prompts tab with every one', async () => {
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand SEO, 2 topics' }));
    // The two topics under SEO and the row that offers its prompts, all at level 2
    await waitFor(() => expect(tree.querySelectorAll('[role="row"][aria-level="2"]')).toHaveLength(3));
    // A topic of eight or fewer has nothing to show more of
    await user.click(within(tree).getByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    expect(within(tree).queryByRole('button', { name: /^Show all \d+ prompts of Paid Search$/ })).toBeNull();
    await user.click(within(tree).getByRole('button', { name: 'Show all 12 prompts of SEO' }));
    const panel = await drawer('SEO');
    expect(within(panel).getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(panel).findAllByRole('listitem')).toHaveLength(12);
  });

  it('closes with Escape', async () => {
    // Opened by the link, which Close undoes by replacing the address: jsdom cannot go back in its history
    const { user } = renderOn('viewer', inspect(`topic:${MOCK_TERM_IDS.paidSearch}`));
    const panel = await drawer('Paid Search');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Paid Search' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Paid Search' })).toBeNull());
  });

  it('says a topic the summary has no row for does not exist', async () => {
    renderOn('viewer', inspect('topic:99999999-0000-4000-8000-000000000001'));
    const panel = await screen.findByRole('complementary');
    expect(
      await within(panel).findByText('This topic does not exist or you do not have access to it.'),
    ).toBeInTheDocument();
  });
});

describe('the topic drawer: the numbers', () => {
  const ids = { seo: '33333333-0000-4000-8000-000000000001', technical: '33333333-0000-4000-8000-000000000002' };
  const idOf = (index: number): string => `11111111-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const counted = (valid: number, mentioned: number, observations = valid): Counts => ({
    ...NO_COUNTS,
    n_valid: valid,
    n_observations: observations,
    mentioned,
  });
  const promptOf = (index: number): Prompt => ({
    prompt_id: idOf(index),
    country_iso: 'DE',
    created_at: NOW.toISOString(),
    created_by: null,
    creation_method: 'human',
    current_version: {
      change_kind: 'initial',
      created_at: NOW.toISOString(),
      prompt_version_id: idOf(index + 100),
      text: `Question number ${String(index)}?`,
      text_hash: 'a'.repeat(64),
      version_no: 1,
    },
    funnel_stage: 'unknown',
    importance: 3,
    intent: 'unknown',
    is_active: true,
    is_branded: false,
    language_code: 'en',
    prompt_type: 'question',
    source: 'manual',
    terms: [{ term_id: ids.technical, name: 'Technical SEO', path: 'seo/technical-seo', vocabulary_kind: 'topic' }],
    updated_at: NOW.toISOString(),
  });
  const promptRow = (index: number, chatgpt: Counts, gemini: Counts): object => ({
    prompt_id: idOf(index),
    text: `Question number ${String(index)}?`,
    is_branded: false,
    topic_term_ids: [ids.technical],
    engines: [promptCells('chatgpt_web', chatgpt), promptCells('gemini_web', gemini)],
  });

  it('reads the answers behind a topic rate, per engine, and labels the average with its engines', async () => {
    // ChatGPT: 1 of 4 and 2 of 4 answers, so the topic's rate is the mean of 25% and 50%, 3 of 8 answers
    // Gemini: every answer mentions the brand
    const chatgpt = [counted(4, 1), counted(4, 2)];
    const gemini = [counted(4, 4), counted(4, 4)];
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ data: [promptOf(1), promptOf(2)], page: { has_more: false, next_cursor: null } }),
      ),
      http.get(SUMMARY_PATH, () =>
        HttpResponse.json({
          data: {
            window: { from: '2026-10-16', to: '2026-11-12', timezone: 'Europe/Berlin' },
            include_branded: false,
            engine_codes: ['chatgpt_web', 'gemini_web'],
            entities: [],
            entity_config_versions: [],
            prompts: [promptRow(1, counted(4, 1), counted(4, 4)), promptRow(2, counted(4, 2), counted(4, 4))],
            topics: [
              {
                term_id: ids.technical,
                name: 'Technical SEO',
                prompt_count: 2,
                engines: [topicCells('chatgpt_web', chatgpt), topicCells('gemini_web', gemini)],
              },
            ],
          },
        }),
      ),
    );
    renderOn('viewer', inspect(`topic:${ids.technical}`));
    const panel = await drawer('Technical SEO');
    const rates = (await within(panel).findByRole('heading', { name: 'Rates' })).closest('section');
    if (rates === null) throw new Error('The Rates card is missing');
    // The mean of 37.5% and 100%, over the two engines that have a rate
    expect(within(rates).getByText('69%')).toBeInTheDocument();
    expect(within(rates).getAllByText('avg of 2').length).toBeGreaterThan(0);
    // No answer names a tracked brand, so there is no share of voice to average
    expect(within(rates).getByText('No valid answers')).toBeInTheDocument();
    const byEngine = within(panel).getByRole('heading', { name: 'By engine' }).closest('section');
    if (byEngine === null) throw new Error('The By engine card is missing');
    expect(within(byEngine).getByText('38%')).toBeInTheDocument();
    // The answers behind the rate, not the sum of the prompts' rates over the prompts (0.75 of 2)
    expect(within(byEngine).getByText('3 of 8')).toBeInTheDocument();
    expect(within(byEngine).getByText('8 of 8')).toBeInTheDocument();
    expect(within(byEngine).queryByText(/^0\.75/)).toBeNull();
    expect(
      within(byEngine).getByText('Each prompt counts once, whatever the number of its answers.'),
    ).toBeInTheDocument();
  });
});

describe('the topic drawer: a prompt opened from a topic', () => {
  const seo = MOCK_TERM_IDS.seo;

  it('keeps the topic as its list, and the topic badge leads back to the topic drawer on the tab it left', async () => {
    const { user } = renderOn('viewer', inspect(`topic:${seo}`, 'prompts'));
    const panel = await drawer('SEO');
    const items = await within(panel).findAllByRole('listitem');
    expect(items).toHaveLength(12);
    const third = within(items[2] ?? panel).getByRole('button');
    const title = third.textContent ?? '';
    await user.click(third);
    const prompt = await screen.findByRole('complementary', { name: title });
    // Its place is among the topic's 12 prompts, though no topic is open in the table
    expect(within(prompt).getByText('3 of 12')).toBeInTheDocument();
    // J steps to the next prompt of the topic
    await user.keyboard('j');
    await waitFor(() => expect(within(screen.getByRole('complementary')).getByText('4 of 12')).toBeInTheDocument());
    await user.click(within(screen.getByRole('complementary')).getByRole('button', { name: 'Open the topic SEO' }));
    const back = await drawer('SEO');
    expect(within(back).getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
  });

  it('gives no topic badge to a prompt opened from the Prompts tab', async () => {
    const { user } = renderOn('viewer', '?tab=prompts');
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    await user.click(await within(table).findByText('Which SEO agency is best for a SaaS startup in Germany?'));
    const prompt = await screen.findByRole('complementary', {
      name: 'Which SEO agency is best for a SaaS startup in Germany?',
    });
    expect(within(prompt).queryByRole('button', { name: /^Open the topic/ })).toBeNull();
  });

  it('keeps the topic for a prompt opened from an expanded topic row: the whole topic is its list, and the badge leads back', async () => {
    const { user } = renderOn('viewer', '');
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    await waitFor(() => expect(tree.querySelectorAll('[role="row"][aria-level="2"]')).toHaveLength(2));
    const row = tree.querySelector('[role="row"][aria-level="2"]');
    const title = row?.querySelector('[role="rowheader"]')?.textContent ?? '';
    await user.click(within(tree).getByText(title));
    const prompt = await screen.findByRole('complementary', { name: title });
    expect(within(prompt).getByText(/^\d+ of 2$/)).toBeInTheDocument();
    await user.click(within(prompt).getByRole('button', { name: 'Open the topic Paid Search' }));
    const back = await drawer('Paid Search');
    expect(within(back).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('gives no topic badge to a prompt that arrives another way after one opened from a topic', async () => {
    const { user } = renderOn('viewer', inspect(`topic:${seo}`, 'prompts'));
    const panel = await drawer('SEO');
    const [item] = await within(panel).findAllByRole('listitem');
    await user.click(within(item ?? panel).getByRole('button'));
    const opened = await screen.findByRole('complementary');
    expect(within(opened).getByRole('button', { name: 'Open the topic SEO' })).toBeInTheDocument();
    // A row of the Prompts tab is a flat list: no topic, and the prompts of all the project step
    await user.click(screen.getByRole('tab', { name: 'Prompts' }));
    const table = await screen.findByRole('grid', { name: 'Prompts' });
    const outside = 'What is the best way to manage paid search on a small budget?';
    await user.click(await within(table).findByText(outside));
    const next = await screen.findByRole('complementary', { name: outside });
    expect(within(next).queryByRole('button', { name: /^Open the topic/ })).toBeNull();
    expect(within(next).queryByText(/ of 12$/)).toBeNull();
  });

  it('leaves the topic drawer tab out of the address of a prompt opened from a table row', async () => {
    const writes: string[] = [];
    const { user } = renderWithProviders(promptsAs('viewer'), {
      searchParams: inspect(`topic:${seo}`, 'prompts'),
      onUrlUpdate: ({ queryString }) => writes.push(queryString),
    });
    const tree = await treegrid();
    await user.click(await within(tree).findByRole('button', { name: 'Expand Paid Search, 2 prompts' }));
    await user.click(await within(tree).findByText('What is the best way to manage paid search on a small budget?'));
    await screen.findByRole('complementary', { name: 'What is the best way to manage paid search on a small budget?' });
    const last = new URLSearchParams(writes.at(-1));
    expect(last.get('inspect')).toMatch(/^prompt:/);
    expect(last.has('itab')).toBe(false);
  });
});

describe('the topic drawer: a modified click', () => {
  it('opens the topic in a new tab, as a prompt row does, and a plain click opens the drawer here', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user } = renderWithProviders(promptsAs('viewer'));
    const tree = await treegrid();
    await user.keyboard('{Control>}');
    await user.click(await within(tree).findByRole('button', { name: 'Open the topic Paid Search' }));
    await user.keyboard('{/Control}');
    expect(open).toHaveBeenCalledTimes(1);
    const [url] = open.mock.calls[0] ?? [];
    expect(new URL(String(url)).searchParams.get('inspect')).toBe(`topic:${MOCK_TERM_IDS.paidSearch}`);
    expect(screen.queryByRole('complementary')).toBeNull();
    open.mockRestore();
  });
});
