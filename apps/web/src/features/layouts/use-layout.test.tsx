import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { layoutQueryKey, type ApiResolvedLayout, type LayoutRead } from './layout-api';
import { useLayout, type UseLayoutResult } from './use-layout';
import { ApiProblem } from '@/lib/api/problem';
import type { LayoutDocument } from '@/lib/layouts';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';
import { renderWithProviders as harness } from '@/test/render';

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const W = `/api/v1/workspaces/${WORKSPACE}`;
const READ = mswPath(`${W}/layouts/:screen`);
const PERSONAL = mswPath(`${W}/me/layouts/:screen`);
const TEAM = mswPath(`${W}/layouts/:screen/default`);

const DOCUMENT: LayoutDocument = {
  schema: 1,
  numbers: [],
  cards: [{ id: 'c1', type: 'seo.rank_distribution', width: 'half' }],
};
const BUILTIN: ApiResolvedLayout = {
  screen: 'overview',
  source: 'builtin',
  document: null,
  team_default_exists: false,
  team_document: null,
  updated_at: null,
  updated_by: null,
};
const SAVED: ApiResolvedLayout = {
  ...BUILTIN,
  source: 'personal',
  document: {
    schema: 1,
    numbers: [],
    cards: [{ id: 'c1', type: 'seo.rank_distribution', width: 'half', options: null }],
  },
};
const PRECONDITION_FAILED = {
  type: 'about:blank',
  title: 'Precondition failed',
  status: 412,
  code: 'precondition_failed',
};

let latest: UseLayoutResult | null = null;

function Probe({ refetch }: { refetch?: boolean }): null {
  const result = useLayout(WORKSPACE, 'overview', refetch === undefined ? undefined : { refetch });
  useEffect(() => {
    latest = result;
  }, [result]);
  return null;
}

const current = (): UseLayoutResult => {
  if (latest === null) throw new Error('The probe has not rendered');
  return latest;
};

/** What the server saw: the reads, and the `If-Match` of each write. */
interface Seen {
  reads: number;
  writes: (string | null)[];
}

function serve(
  etag = '"e1"',
  write: () => Response = () => HttpResponse.json({ data: SAVED }, { headers: { etag: '"e2"' } }),
): Seen {
  const seen: Seen = { reads: 0, writes: [] };
  server.use(
    http.get(READ, () => {
      seen.reads += 1;
      return HttpResponse.json({ data: BUILTIN }, { headers: { etag } });
    }),
    http.put(PERSONAL, ({ request }) => {
      seen.writes.push(request.headers.get('if-match'));
      return write();
    }),
    http.put(TEAM, ({ request }) => {
      seen.writes.push(request.headers.get('if-match'));
      return write();
    }),
    http.delete(PERSONAL, () => new HttpResponse(null, { status: 204 })),
    http.delete(TEAM, () => new HttpResponse(null, { status: 204 })),
  );
  return seen;
}

beforeEach(() => {
  latest = null;
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('useLayout reading', () => {
  it('starts without data and pending, then holds the layout and its ETag', async () => {
    serve('W/"e1"');
    harness(<Probe />);
    expect(current().query.data).toBeUndefined();
    expect(current().query.isPending).toBe(true);
    await waitFor(() => {
      expect(current().query.data?.etag).toBe('W/"e1"');
    });
    expect(current().query.data?.layout.screen).toBe('overview');
  });

  it('keeps the screens apart', async () => {
    serve();
    const { queryClient } = harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    expect(queryClient.getQueryData(layoutQueryKey(WORKSPACE, 'overview'))).toBeDefined();
    expect(queryClient.getQueryData(layoutQueryKey(WORKSPACE, 'rankings'))).toBeUndefined();
  });

  it('surfaces a failed read as an ApiProblem', async () => {
    server.use(
      http.get(READ, () =>
        HttpResponse.json({ ...PRECONDITION_FAILED, status: 500, code: 'internal' }, { status: 500 }),
      ),
    );
    harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isError).toBe(true);
    });
    expect(current().query.error).toBeInstanceOf(ApiProblem);
  });

  it('refetches on window focus unless the caller turns it off', async () => {
    serve();
    const first = harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    const key = layoutQueryKey(WORKSPACE, 'overview');
    const focusOf = (client: typeof first.queryClient): unknown =>
      client.getQueryCache().find({ queryKey: key })?.observers[0]?.options.refetchOnWindowFocus;
    expect(focusOf(first.queryClient)).not.toBe(false);
    first.unmount();

    const second = harness(<Probe refetch={false} />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    expect(focusOf(second.queryClient)).toBe(false);
  });
});

describe('useLayout writing', () => {
  it('sends the ETag it read as If-Match and writes the answer into the cache without reading again', async () => {
    const seen = serve('W/"e1"');
    const { queryClient } = harness(<Probe />);
    await waitFor(() => {
      expect(current().query.data?.etag).toBe('W/"e1"');
    });

    let saved: LayoutRead | null = null;
    await act(async () => {
      saved = await current().savePersonal.mutateAsync({
        document: DOCUMENT,
        etag: current().query.data?.etag ?? null,
      });
    });

    expect(seen.writes).toEqual(['"e1"']);
    expect(saved).toEqual({ layout: SAVED, etag: '"e2"' });
    expect(queryClient.getQueryData(layoutQueryKey(WORKSPACE, 'overview'))).toEqual({ layout: SAVED, etag: '"e2"' });
    expect(seen.reads).toBe(1);
  });

  it('writes the team default through its own route and keeps the answer too', async () => {
    const seen = serve();
    const { queryClient } = harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    await act(async () => {
      await current().saveTeam.mutateAsync({ document: DOCUMENT, etag: '"e1"' });
    });
    expect(seen.writes).toEqual(['"e1"']);
    expect(queryClient.getQueryData(layoutQueryKey(WORKSPACE, 'overview'))).toEqual({ layout: SAVED, etag: '"e2"' });
    expect(seen.reads).toBe(1);
  });

  it('on a 412 rejects with the problem, invalidates and reads the layout again', async () => {
    const seen = serve('"e1"', () => HttpResponse.json(PRECONDITION_FAILED, { status: 412 }));
    harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });

    let failure: unknown = null;
    await act(async () => {
      failure = await current()
        .savePersonal.mutateAsync({ document: DOCUMENT, etag: '"e1"' })
        .catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(ApiProblem);
    expect(failure).toMatchObject({ status: 412, code: 'precondition_failed' });
    // The write settles only after the read: the count is already 2 when mutateAsync returns
    expect(seen.reads).toBe(2);
  });

  it('on a 412 of the team default reads again too', async () => {
    const seen = serve('"e1"', () => HttpResponse.json(PRECONDITION_FAILED, { status: 412 }));
    harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    await act(async () => {
      await current()
        .saveTeam.mutateAsync({ document: DOCUMENT, etag: '"e1"' })
        .catch(() => undefined);
    });
    // The write settles only after the read: the count is already 2 when mutateAsync returns
    expect(seen.reads).toBe(2);
  });

  it('does not read again after another failure', async () => {
    const seen = serve('"e1"', () =>
      HttpResponse.json({ ...PRECONDITION_FAILED, status: 500, code: 'internal' }, { status: 500 }),
    );
    harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    await act(async () => {
      await current()
        .savePersonal.mutateAsync({ document: DOCUMENT, etag: '"e1"' })
        .catch(() => undefined);
    });
    await waitFor(() => {
      expect(current().savePersonal.isError).toBe(true);
    });
    expect(seen.reads).toBe(1);
  });

  it('reads again after the personal layout is removed', async () => {
    const seen = serve();
    harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    await act(async () => {
      await current().removePersonal.mutateAsync();
    });
    // The write settles only after the read: the count is already 2 when mutateAsync returns
    expect(seen.reads).toBe(2);
  });

  it('reads again after the team default is removed', async () => {
    const seen = serve();
    harness(<Probe />);
    await waitFor(() => {
      expect(current().query.isSuccess).toBe(true);
    });
    await act(async () => {
      await current().removeTeam.mutateAsync();
    });
    // The write settles only after the read: the count is already 2 when mutateAsync returns
    expect(seen.reads).toBe(2);
  });
});
