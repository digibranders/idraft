import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { InspectorLatest } from './inspector-latest';
import type { CitationOut, ObservationDetail, ObservationSummary, ProjectEngine } from '@/lib/api/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const LIST = mswPath(`${P}/ai/observations`);
const DETAIL = mswPath(`${P}/ai/observations/{observation_id}`);

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');

const ENGINE: ProjectEngine = {
  active_prompts: 1,
  engine: ENGINE_FACTS.chatgpt_web,
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
};

const ROW: ObservationSummary = {
  answer_char_count: 40,
  citation_count: 0,
  device: null,
  engine_code: 'chatgpt_web',
  facts: {
    competitor_cited: [],
    competitor_mentions: [],
    derivation_id: 1,
    had_structured_list: false,
    is_valid: true,
    outcome: 'mentioned_and_cited',
    own_citation_count: 0,
    own_domain_cited: false,
    own_mention_order: null,
    own_mentioned: false,
    own_prominence: null,
    total_citation_count: 0,
    tracked_entities_mentioned: 0,
  },
  fanout_count: 0,
  language_code: 'en',
  location_id: 2276,
  model_reported: 'gpt-5',
  observation_class: 'consumer_ui',
  observation_id: '3000002',
  observed_at: '2026-11-12T02:00:00Z',
  observed_date: '2026-11-12',
  query_text: 'best seo tools',
  replicate_index: 1,
  run_id: null,
  served_from_cache: false,
  status: 'complete',
  subject: { type: 'prompt', prompt_id: '2000001', prompt_version_id: '2100001', version_no: 1 },
};

const cite = (
  citation_index: number,
  host: string,
  domain_role: CitationOut['domain_role'] = 'third_party',
): CitationOut => ({
  answer_block_index: 0,
  citation_index,
  citation_kind: 'inline',
  domain_role,
  first_char_offset: citation_index,
  flags: [],
  host,
  occurrences: 1,
  raw_url: `https://${host}/a`,
  referral_tag: null,
  role_entity_id: null,
  source_name: null,
  title: host,
  url: `https://${host}/a`,
});

function serveCitations(citations: CitationOut[]): void {
  const detail: ObservationDetail = {
    ...ROW,
    answer_text: 'Some answer about audit tools.',
    check_url: null,
    citations,
    error_code: null,
    mentions: [],
    offsets_unit: 'utf16',
  };
  server.use(
    http.get(LIST, () => HttpResponse.json({ data: [ROW], page: { has_more: false, next_cursor: null, limit: 1 } })),
    http.get(DETAIL, () => HttpResponse.json({ data: detail })),
  );
}

function renderLatest(): ProvidedRender {
  // The mock API answers a session cookie only
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  const ui: ReactElement = (
    <InspectorLatest
      scope={{ workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix?.project_id ?? '' }}
      promptId="2000001"
      exists
      range={{ from: '2026-11-06', to: '2026-11-12' }}
      timeZone="UTC"
      engines={[ENGINE]}
      onOpenAnswer={undefined}
    />
  );
  return renderWithProviders(ui);
}

const sourcesList = (): Promise<HTMLElement> => screen.findByRole('list', { name: 'Top sources of this answer' });
const chipTexts = (list: HTMLElement): (string | null)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('the cited sources of a Latest card', () => {
  it('names the first three cited domains in citation order and the rest behind +N', async () => {
    // Out of citation order, with one host twice (the second reading is dropped) and one with a www prefix
    serveCitations([
      cite(6, 'sixth.example'),
      cite(3, 'www.third.example'),
      cite(1, 'first.example', 'own'),
      cite(2, 'second.example'),
      cite(4, 'third.example'),
      cite(5, 'fifth.example'),
    ]);
    const { user } = renderLatest();
    const list = await sourcesList();
    // third.example is cited twice (once as www.third.example): five distinct hosts, three shown, two behind +2
    expect(
      within(list)
        .getAllByRole('listitem')
        .slice(0, 3)
        .map((item) => item.textContent),
    ).toEqual(['first.example', 'second.example', 'third.example']);
    const more = within(list).getByRole('button', { name: '2 more cited domains' });
    expect(more).toHaveTextContent('+2');
    await user.click(more);
    const popup = await screen.findByRole('dialog');
    expect(
      within(popup)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['fifth.example', 'sixth.example']);
  });

  it('shows no overflow chip for three domains or fewer, and no list for none', async () => {
    serveCitations([cite(1, 'one.example'), cite(2, 'two.example'), cite(3, 'three.example')]);
    const first = renderLatest();
    const list = await sourcesList();
    expect(chipTexts(list)).toEqual(['one.example', 'two.example', 'three.example']);
    expect(within(list).queryByRole('button')).toBeNull();
    first.unmount();
    serveCitations([]);
    renderLatest();
    expect(await screen.findByText('gpt-5')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Top sources of this answer' })).toBeNull();
  });

  it('draws the chips in the neutral chip style, with no role colour', async () => {
    serveCitations([cite(1, 'fynix.example', 'own'), cite(2, 'reviews.example', 'third_party')]);
    renderLatest();
    const list = await sourcesList();
    // The role is not said in the chip: the Cited fact badge says whether the own domain is cited
    expect(chipTexts(list)).toEqual(['fynix.example', 'reviews.example']);
    const chips = list.querySelectorAll('[data-slot="domain-chip"]');
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      expect(chip.className).toContain('bg-neutral-subtle');
      expect(chip.className).not.toMatch(/info/);
    }
  });
});
