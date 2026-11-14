import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { TopicPicker } from './topic-picker';
import type { TopicSelection } from './topic-picker-model';
import { EnsureTopicsFailure, useEnsureTopics, useTopicLeftover, type EnsuredTopics } from './use-ensure-topics';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERM_IDS, MOCK_VOCABULARY_IDS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const TERMS = '/api/v1/workspaces/{workspace_id}/vocabularies/{vocabulary_id}/terms';
const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const TOPICS = MOCK_VOCABULARY_IDS.topics;

afterEach(() => {
  server.events.removeAllListeners();
});

interface Write {
  url: string;
  body: unknown;
}

/** The writes to terms, in order, with their bodies read as the request starts. */
function termWrites(): Write[] {
  const writes: Write[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/terms')) return;
    void request
      .clone()
      .json()
      .then((body: unknown) => writes.push({ url: request.url, body }));
  });
  return writes;
}

/**
 * What the dialog does on submit, in small: make the typed topics, then (here) fail or not, saying what the
 * topics left behind. The result and the message are written out for the test to read.
 */
function Harness({ selections, thenFail }: { selections: readonly TopicSelection[]; thenFail: boolean }): ReactElement {
  const ensure = useEnsureTopics(SCOPE);
  const leftover = useTopicLeftover();
  const [out, setOut] = useState<string>('');
  const submit = async (): Promise<void> => {
    try {
      const ensured: EnsuredTopics = await ensure(selections);
      setOut(thenFail ? (leftover(ensured.made) ?? 'nothing was made') : JSON.stringify(ensured));
    } catch (error) {
      setOut(error instanceof EnsureTopicsFailure ? `failed after ${JSON.stringify(error.made)}` : 'failed');
    }
  };
  return (
    <button type="button" onClick={() => void submit()}>
      Submit
      <output data-testid="out">{out}</output>
    </button>
  );
}

function render(selections: readonly TopicSelection[], thenFail = false): ReturnType<typeof renderWithProviders> {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('editor')}>
      <Harness selections={selections} thenFail={thenFail} />
    </PermissionProvider>,
  );
}

const OUT = z.object({ termIds: z.array(z.string()), made: z.array(z.string()) });
const result = (): z.infer<typeof OUT> => OUT.parse(JSON.parse(screen.getByTestId('out').textContent));

describe('useEnsureTopics', () => {
  it('writes nothing when every topic exists, and answers their ids in order', async () => {
    const writes = termWrites();
    const { user } = render([
      { kind: 'existing', termId: MOCK_TERM_IDS.seo },
      { kind: 'existing', termId: MOCK_TERM_IDS.paidSearch },
    ]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().termIds).toEqual([MOCK_TERM_IDS.seo, MOCK_TERM_IDS.paidSearch]));
    expect(result().made).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('creates a typed path on submit with its missing parents, in one request, and reads the new leaf from the tree', async () => {
    const writes = termWrites();
    const { user } = render([
      { kind: 'existing', termId: MOCK_TERM_IDS.seo },
      { kind: 'new', vocabularyId: TOPICS, path: 'CRM / Startups' },
    ]);
    expect(writes).toEqual([]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual(['CRM / Startups']));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toEqual({ items: [{ path: 'CRM/Startups' }] });
    expect(writes[0]?.url).toContain(`/vocabularies/${TOPICS}/terms`);
    expect(result().termIds).toHaveLength(2);
    expect(result().termIds[0]).toBe(MOCK_TERM_IDS.seo);
  });

  it('makes two new paths of one vocabulary in one request', async () => {
    const writes = termWrites();
    const { user } = render([
      { kind: 'new', vocabularyId: TOPICS, path: 'Startups' },
      { kind: 'new', vocabularyId: TOPICS, path: 'CRM / Agencies' },
    ]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual(['Startups', 'CRM / Agencies']));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toEqual({ items: [{ path: 'Startups' }, { path: 'CRM/Agencies' }] });
    expect(result().termIds).toHaveLength(2);
  });

  it('uses a topic that was made meanwhile and does not call it made', async () => {
    const { user } = render([{ kind: 'new', vocabularyId: TOPICS, path: 'Startups' }]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual(['Startups']));
    const first = result().termIds;
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual([]));
    expect(result().termIds).toEqual(first);
  });

  it('says the topic was created and the prompts were not added when the add fails after it', async () => {
    const { user } = render([{ kind: 'new', vocabularyId: TOPICS, path: 'Startups' }], true);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('Topic “Startups” was created. The prompts were not added.'),
    );
  });

  it('names several topics in one sentence', async () => {
    const { user } = render(
      [
        { kind: 'new', vocabularyId: TOPICS, path: 'Startups' },
        { kind: 'new', vocabularyId: TOPICS, path: 'CRM / Agencies' },
      ],
      true,
    );
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent(
        'Topics “Startups” and “CRM / Agencies” were created. The prompts were not added.',
      ),
    );
  });

  it('rejects with the failure when the create is refused, and names nothing as made', async () => {
    server.use(
      http.post(mswPath(TERMS), () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Forbidden', status: 403, code: 'forbidden', request_id: 'r' },
          { status: 403 },
        ),
      ),
    );
    const { user } = render([{ kind: 'new', vocabularyId: TOPICS, path: 'Startups' }]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('failed after []'));
  });
});

/** The POSTs to vocabularies and terms in the order they start, each as `{ what, body }`. */
function vocabularyAndTermWrites(): { what: 'vocabularies' | 'terms'; body: unknown }[] {
  const writes: { what: 'vocabularies' | 'terms'; body: unknown }[] = [];
  server.events.on('request:start', ({ request }) => {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST') return;
    const what = path.endsWith('/terms') ? 'terms' : path.endsWith('/vocabularies') ? 'vocabularies' : null;
    if (what === null) return;
    // The slot is taken now, in order; the body arrives a moment later
    const entry: { what: 'vocabularies' | 'terms'; body: unknown } = { what, body: undefined };
    writes.push(entry);
    void request
      .clone()
      .json()
      .then((body: unknown) => {
        entry.body = body;
      });
  });
  return writes;
}

describe('useEnsureTopics where the project has no topic vocabulary', () => {
  it('makes the project vocabulary first and then the terms in it, and answers the new leaf id', async () => {
    const writes = vocabularyAndTermWrites();
    const { user } = render([{ kind: 'new', vocabularyId: null, path: 'CRM / Startups' }]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual(['CRM / Startups']));
    expect(writes.map((write) => write.what)).toEqual(['vocabularies', 'terms']);
    expect(writes[0]?.body).toEqual({
      kind: 'topic',
      name: 'Topics',
      project_id: SCOPE.projectId,
      is_hierarchical: true,
      is_single_valued: false,
    });
    expect(writes[1]?.body).toEqual({ items: [{ path: 'CRM/Startups' }] });
    expect(result().termIds).toHaveLength(1);
  });

  it('makes the vocabulary once for several topics and the terms in one request', async () => {
    const writes = vocabularyAndTermWrites();
    const { user } = render([
      { kind: 'new', vocabularyId: null, path: 'Startups' },
      { kind: 'new', vocabularyId: null, path: 'CRM / Agencies' },
    ]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual(['Startups', 'CRM / Agencies']));
    expect(writes.map((write) => write.what)).toEqual(['vocabularies', 'terms']);
    expect(writes[1]?.body).toEqual({ items: [{ path: 'Startups' }, { path: 'CRM/Agencies' }] });
    expect(result().termIds).toHaveLength(2);
  });

  it('uses the vocabulary that exists when the create answers 409 duplicate, and does not call its topics made', async () => {
    const writes = vocabularyAndTermWrites();
    const { user } = render([{ kind: 'new', vocabularyId: null, path: 'Startups' }]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual(['Startups']));
    const first = result().termIds;
    // The same submit again: the vocabulary is there now, so the create is refused and the one that exists is used
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual([]));
    expect(result().termIds).toEqual(first);
    expect(writes.map((write) => write.what)).toEqual(['vocabularies', 'terms', 'vocabularies', 'terms']);
  });

  it('says the topic was created when the add fails after the vocabulary and the topic were made', async () => {
    const { user } = render([{ kind: 'new', vocabularyId: null, path: 'Startups' }], true);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() =>
      expect(screen.getByTestId('out')).toHaveTextContent('Topic “Startups” was created. The prompts were not added.'),
    );
  });

  it('names nothing as made when the terms are refused after the vocabulary was made, and uses that vocabulary on the next try', async () => {
    let refuse = true;
    server.use(
      http.post(mswPath(TERMS), () =>
        refuse
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r' },
              { status: 500 },
            )
          : undefined,
      ),
    );
    const writes = vocabularyAndTermWrites();
    const { user } = render([{ kind: 'new', vocabularyId: null, path: 'Startups' }]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('failed after []'));
    refuse = false;
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(result().made).toEqual(['Startups']));
    expect(writes.filter((write) => write.what === 'vocabularies')).toHaveLength(2);
  });

  it('rejects with the failure and writes no term when the vocabulary is refused for another reason', async () => {
    server.use(
      http.post(mswPath('/api/v1/workspaces/{workspace_id}/vocabularies'), () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Forbidden', status: 403, code: 'forbidden', request_id: 'r' },
          { status: 403 },
        ),
      ),
    );
    const writes = vocabularyAndTermWrites();
    const { user } = render([{ kind: 'new', vocabularyId: null, path: 'Startups' }]);
    await user.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(screen.getByTestId('out')).toHaveTextContent('failed after []'));
    expect(writes.map((write) => write.what)).toEqual(['vocabularies']);
  });
});

describe('the topic picker and the submit', () => {
  it('holds a typed topic in the form and writes nothing until the form submits', async () => {
    const writes = termWrites();
    function Form(): ReactElement {
      const [value, setValue] = useState<readonly TopicSelection[]>([]);
      const ensure = useEnsureTopics(SCOPE);
      const [made, setMade] = useState('');
      return (
        <PermissionProvider membership={membershipFactory('editor')}>
          <label htmlFor="topics">Topics</label>
          <TopicPicker id="topics" scope={SCOPE} value={value} onValueChange={setValue} />
          <button type="button" onClick={() => void ensure(value).then((ensured) => setMade(ensured.made.join('|')))}>
            Save
          </button>
          <output data-testid="made">{made}</output>
        </PermissionProvider>
      );
    }
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor' satisfies Role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    const { user } = renderWithProviders(<Form />);
    const input = screen.getByRole('combobox', { name: 'Topics' });
    await waitFor(() => expect(input).toBeEnabled());
    await user.click(input);
    await user.keyboard('Startups');
    await user.click(await screen.findByRole('option', { name: 'Create topic “Startups”' }));
    expect(writes).toEqual([]);
    // The list stays open after a pick; Escape closes it, as a person does before pressing Save
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('made')).toHaveTextContent('Startups'));
    expect(writes).toHaveLength(1);
  });
});
