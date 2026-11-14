import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TopicPicker } from './topic-picker';
import type { TopicSelection } from './topic-picker-model';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERM_IDS, MOCK_VOCABULARY_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const W = '/api/v1/workspaces/{workspace_id}';
const VOCABULARIES = `${W}/vocabularies`;
const TERMS = `${W}/vocabularies/{vocabulary_id}/terms`;
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const OWN_TOPICS_ID = '0192d1a8-0000-7000-8000-0000000000aa';
const LIST_BODY = z.object({ data: z.array(z.record(z.string(), z.unknown())) }).loose();
const SERVER_ERROR = (): Response =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r' },
    { status: 500 },
  );

afterEach(() => {
  server.events.removeAllListeners();
});

/** The member of the role who adds prompts, with the permissions and project access the test gives. */
function membership(
  role: Role = 'editor',
  { without, projectIds = null }: { without?: string; projectIds?: readonly string[] | null } = {},
): ReturnType<typeof membershipFactory> {
  const base = membershipFactory(role, { projectIds });
  return { ...base, permissions: base.permissions.filter((permission) => permission !== without) };
}

function Harness({
  initial = [],
  member,
}: {
  initial?: readonly TopicSelection[];
  member: ReturnType<typeof membership>;
}): ReactElement {
  const [value, setValue] = useState<readonly TopicSelection[]>(initial);
  return (
    <PermissionProvider membership={member}>
      <label htmlFor="topics">Topics</label>
      <TopicPicker id="topics" scope={SCOPE} value={value} onValueChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </PermissionProvider>
  );
}

function render(
  props: { initial?: readonly TopicSelection[]; member?: ReturnType<typeof membership> } = {},
): ReturnType<typeof renderWithProviders> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return renderWithProviders(
    <Harness
      {...(props.initial === undefined ? {} : { initial: props.initial })}
      member={props.member ?? membership()}
    />,
  );
}

const field = (): HTMLElement => screen.getByRole('combobox', { name: 'Topics' });
const chosen = (): TopicSelection[] =>
  z.array(z.custom<TopicSelection>()).parse(JSON.parse(screen.getByTestId('value').textContent));

/** The text on the page, which the announcer repeats in its live region: the one that is a paragraph is the visible one. */
const visibleText = async (text: string | RegExp): Promise<HTMLElement | undefined> =>
  (await screen.findAllByText(text)).find((element) => element.tagName === 'P');

/** Opens the list once the topics have loaded. */
async function open(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await waitFor(() => expect(field()).toBeEnabled());
  await user.click(field());
}

/** Counts the writes to the terms of a vocabulary. */
function termPosts(): string[] {
  const posts: string[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/terms')) posts.push(request.url);
  });
  return posts;
}

/** The vocabularies with one more: a topic vocabulary of the project itself, with no terms. */
function withProjectTopics(): void {
  server.use(
    http.get(mswPath(VOCABULARIES), async ({ request }) => {
      const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      const body = LIST_BODY.parse(await real?.json());
      const own = {
        vocabulary_id: OWN_TOPICS_ID,
        kind: 'topic',
        name: 'Fynix topics',
        project_id: SCOPE.projectId,
        is_hierarchical: true,
        is_single_valued: false,
        term_count: 0,
      };
      return HttpResponse.json({ ...body, data: [...body.data, own] });
    }),
    http.get(mswPath(TERMS), ({ params }) =>
      params.vocabulary_id === OWN_TOPICS_ID ? HttpResponse.json({ data: [] }) : undefined,
    ),
  );
}

describe('Topic picker', () => {
  it('lists the topics with the topics above them, the tags by vocabulary, and says what a nested topic counts under', async () => {
    const { user, container } = render();
    expect(screen.getByText('A prompt counts under its topic and the topics above it.')).toBeInTheDocument();
    await open(user);
    const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(names).toEqual(
      expect.arrayContaining([
        'SEO',
        'SEO / Technical SEO',
        'Content Marketing / Blog Strategy',
        'Services: SEO Audit',
      ]),
    );
    // Topics before tags
    expect(names.indexOf('Paid Search')).toBeLessThan(names.indexOf('Services: SEO Audit'));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('does not add the parent when a child is chosen', async () => {
    const { user } = render();
    await open(user);
    await user.click(await screen.findByRole('option', { name: 'SEO / Technical SEO' }));
    expect(chosen()).toEqual([{ kind: 'existing', termId: MOCK_TERM_IDS.technicalSeo }]);
    expect(
      within(screen.getByRole('toolbar', { name: 'Chosen topics and tags' })).getByText('SEO / Technical SEO'),
    ).toBeInTheDocument();
  });

  it('picks from the keyboard: type to filter, Arrow Down, Enter, and Backspace removes the last chip', async () => {
    const { user } = render();
    await open(user);
    await user.keyboard('Blog');
    await screen.findByRole('option', { name: 'Content Marketing / Blog Strategy' });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(chosen()).toEqual([{ kind: 'existing', termId: MOCK_TERM_IDS.blogStrategy }]));
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(chosen()).toEqual([]));
    await user.keyboard('{Escape}');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the term chosen last of a single-valued vocabulary and says so', async () => {
    const { user } = render();
    await open(user);
    await user.click(await screen.findByRole('option', { name: 'Services: SEO Audit' }));
    await user.click(await screen.findByRole('option', { name: 'Services: Link Building' }));
    await waitFor(() => expect(chosen()).toHaveLength(1));
    expect(await visibleText('Pick one term of Services: it takes one.')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Chosen topics and tags' })).toHaveTextContent(
      'Services: Link Building',
    );
    expect(screen.getByRole('toolbar', { name: 'Chosen topics and tags' })).not.toHaveTextContent(
      'Services: SEO Audit',
    );
  });

  it('refuses more than 20 terms with its text and keeps what was chosen', async () => {
    const twenty: TopicSelection[] = Array.from({ length: 20 }, (_, index) => ({
      kind: 'new',
      vocabularyId: MOCK_VOCABULARY_IDS.topics,
      path: `Extra ${String(index)}`,
    }));
    const { user } = render({ initial: twenty });
    await open(user);
    await user.click(await screen.findByRole('option', { name: 'SEO' }));
    expect(await visibleText('A prompt takes at most 20 topics and tags.')).toBeInTheDocument();
    expect(chosen()).toEqual(twenty);
  });

  it('shows the topic the dialog was opened from as a chip once the topics have loaded', async () => {
    render({ initial: [{ kind: 'existing', termId: MOCK_TERM_IDS.seo }] });
    expect(await screen.findByRole('button', { name: 'Remove SEO' })).toBeInTheDocument();
    expect(chosen()).toEqual([{ kind: 'existing', termId: MOCK_TERM_IDS.seo }]);
  });

  it('offers to create a typed name or path and holds it as a new topic without writing anything', async () => {
    const posts = termPosts();
    const { user } = render();
    await open(user);
    await user.keyboard('Startups');
    await user.click(await screen.findByRole('option', { name: 'Create topic “Startups”' }));
    expect(chosen()).toEqual([{ kind: 'new', vocabularyId: MOCK_VOCABULARY_IDS.topics, path: 'Startups' }]);
    await user.keyboard('CRM/Startups');
    // The row says the path as it was typed, the chip as it will be made
    await user.click(await screen.findByRole('option', { name: 'Create “CRM/Startups”' }));
    expect(chosen()).toEqual([
      { kind: 'new', vocabularyId: MOCK_VOCABULARY_IDS.topics, path: 'Startups' },
      { kind: 'new', vocabularyId: MOCK_VOCABULARY_IDS.topics, path: 'CRM / Startups' },
    ]);
    expect(screen.getByRole('button', { name: 'Remove CRM / Startups (new)' })).toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('turns a typed path that is already a topic into that topic', async () => {
    const { user } = render();
    await open(user);
    await user.keyboard('seo/technical seo');
    await user.click(await screen.findByRole('option', { name: /^Create/ }));
    expect(chosen()).toEqual([{ kind: 'existing', termId: MOCK_TERM_IDS.technicalSeo }]);
  });

  it('refuses a typed path with an empty level', async () => {
    const { user } = render();
    await open(user);
    await user.keyboard('CRM//Startups');
    await user.click(await screen.findByRole('option', { name: /^Create/ }));
    expect(await visibleText('Each level of a topic needs a name.')).toBeInTheDocument();
    expect(chosen()).toEqual([]);
  });

  it('has no Create option without taxonomy:write and says only editors can create topics', async () => {
    const { user } = render({ member: membership('editor', { without: 'taxonomy:write' }) });
    await open(user);
    await user.keyboard('Startups');
    expect(await screen.findByText(/Only editors can create topics\./)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Create/ })).toBeNull();
  });

  it('offers a member limited to some projects no Create in the shared topics, a new vocabulary of their project, and Create in the one they have', async () => {
    const limited = membership('editor', { projectIds: [SCOPE.projectId] });
    const first = render({ member: limited });
    await open(first.user);
    await first.user.keyboard('Startups');
    // The shared vocabulary is not theirs to write: the topic goes in a vocabulary made for the project
    await first.user.click(await screen.findByRole('option', { name: 'Create topic “Startups”' }));
    expect(chosen()).toEqual([{ kind: 'new', vocabularyId: null, path: 'Startups' }]);
    first.unmount();

    withProjectTopics();
    const second = render({ member: limited });
    await open(second.user);
    await second.user.keyboard('Startups');
    await second.user.click(await screen.findByRole('option', { name: 'Create topic “Startups”' }));
    expect(chosen()).toEqual([{ kind: 'new', vocabularyId: OWN_TOPICS_ID, path: 'Startups' }]);
  });

  it('offers no Create without taxonomy:write even when the project has its own topic vocabulary', async () => {
    withProjectTopics();
    const { user } = render({ member: membership('editor', { without: 'taxonomy:write' }) });
    await open(user);
    await user.keyboard('Startups');
    expect(await screen.findByText(/Only editors can create topics\./)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Create/ })).toBeNull();
  });

  it('offers no Create to a viewer even when the project has its own topic vocabulary', async () => {
    withProjectTopics();
    const { user } = render({ member: membership('viewer') });
    await open(user);
    await user.keyboard('Startups');
    expect(await screen.findByText(/Only editors can create topics\./)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^Create/ })).toBeNull();
  });

  it('takes the 20th term and refuses the 21st', async () => {
    const nineteen: TopicSelection[] = Array.from({ length: 19 }, (_, index) => ({
      kind: 'new',
      vocabularyId: MOCK_VOCABULARY_IDS.topics,
      path: `Extra ${String(index)}`,
    }));
    const { user } = render({ initial: nineteen });
    await open(user);
    await user.click(await screen.findByRole('option', { name: 'SEO' }));
    await waitFor(() => expect(chosen()).toHaveLength(20));
    await user.click(await screen.findByRole('option', { name: 'Paid Search' }));
    expect(await visibleText('A prompt takes at most 20 topics and tags.')).toBeInTheDocument();
    expect(chosen()).toHaveLength(20);
  });

  it('shows loading without saying there are none, then an empty list with how to create the first topic', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(mswPath(VOCABULARIES), async () => {
        await gate;
        return HttpResponse.json({ data: [], page: { offset: 0, limit: 200, total: 0 } });
      }),
    );
    const { user } = render();
    expect(field()).toBeDisabled();
    expect(field()).toHaveAttribute('placeholder', 'Loading topics');
    release();
    await open(user);
    expect(await screen.findByText('No topics yet. Type a name to create the first topic.')).toBeInTheDocument();
  });

  describe('where the project has no topic vocabulary', () => {
    /** The project sees no vocabulary at all, as the owner's Eventus project: 134 prompts and no topics. */
    function withoutVocabularies(): void {
      server.use(
        http.get(mswPath(VOCABULARIES), () =>
          HttpResponse.json({ data: [], page: { offset: 0, limit: 200, total: 0 } }),
        ),
      );
    }

    it('offers an editor to create the typed topic, holds it for a vocabulary that is made on submit, and writes nothing', async () => {
      withoutVocabularies();
      const posts = termPosts();
      const { user } = render();
      await open(user);
      await user.keyboard('Startups');
      expect(screen.queryByText(/Only editors can create topics\./)).toBeNull();
      await user.click(await screen.findByRole('option', { name: 'Create topic “Startups”' }));
      expect(chosen()).toEqual([{ kind: 'new', vocabularyId: null, path: 'Startups' }]);
      expect(screen.getByRole('button', { name: 'Remove Startups (new)' })).toBeInTheDocument();
      expect(posts).toEqual([]);
    });

    it('offers a member limited to some projects to create it too, as the vocabulary is the one of their project', async () => {
      withoutVocabularies();
      const { user } = render({ member: membership('editor', { projectIds: [SCOPE.projectId] }) });
      await open(user);
      await user.keyboard('Startups');
      await user.click(await screen.findByRole('option', { name: 'Create topic “Startups”' }));
      expect(chosen()).toEqual([{ kind: 'new', vocabularyId: null, path: 'Startups' }]);
    });

    it('offers a viewer no Create and says only editors can create topics', async () => {
      withoutVocabularies();
      const { user } = render({ member: membership('viewer') });
      await open(user);
      await user.keyboard('Startups');
      expect(await screen.findByText(/Only editors can create topics\./)).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /^Create/ })).toBeNull();
    });

    it('says what is empty per role when nothing is typed', async () => {
      withoutVocabularies();
      const editor = render();
      await open(editor.user);
      expect(await screen.findByText('No topics yet. Type a name to create the first topic.')).toBeInTheDocument();
      editor.unmount();

      const viewer = render({ member: membership('viewer') });
      await open(viewer.user);
      expect(await screen.findByText('No topics yet. Only editors can create topics.')).toBeInTheDocument();
      viewer.unmount();

      const noWrite = render({ member: membership('editor', { without: 'taxonomy:write' }) });
      await open(noWrite.user);
      expect(await screen.findByText('No topics yet. Only editors can create topics.')).toBeInTheDocument();
    });
  });

  it('says the topics could not be loaded and reads them again on retry', async () => {
    let fail = true;
    server.use(http.get(mswPath(VOCABULARIES), () => (fail ? SERVER_ERROR() : undefined)));
    const { user } = render();
    expect(await visibleText('Topics could not be loaded.')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText('Topics could not be loaded.')).toBeNull());
    await waitFor(() => expect(field()).toBeEnabled());
  });

  it('keeps the topics that loaded and offers a retry when only some failed', async () => {
    server.use(
      http.get(mswPath(TERMS), ({ params }) =>
        params.vocabulary_id === MOCK_VOCABULARY_IDS.services ? SERVER_ERROR() : undefined,
      ),
    );
    const { user } = render();
    expect(await visibleText('Some topics could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await open(user);
    expect(await screen.findByRole('option', { name: 'SEO' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Services: SEO Audit' })).toBeNull();
  });
});
