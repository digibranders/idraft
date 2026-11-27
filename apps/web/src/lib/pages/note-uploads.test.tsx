import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoteFileRefusal, isNoteFileRefusal, refusalKindOf, useNoteFileUpload } from './note-uploads';
import { problemFrom } from '@/lib/api/problem';
import { UrlIdError } from '@/lib/internal-links/queries';
import type { LinksScope } from '@/lib/internal-links/types';

const SCOPE: LinksScope = {
  workspaceId: '0192d1a8-7e8b-7c3a-9f3e-3b5a2c1d4e5f',
  projectId: '0192d1a8-7e8b-7c3a-9f3e-3b5a2c1d4e60',
};
const PATH = `/api/v1/workspaces/${SCOPE.workspaceId}/projects/${SCOPE.projectId}/internal-links/pages/108/note-attachments`;
const STORED = {
  id: '0192e4a0-b000-7000-8000-000000000001',
  name: 'shot.png',
  size: 8,
  content_type: 'image/png',
  is_image: true,
  url: `${PATH}/0192e4a0-b000-7000-8000-000000000001`,
};

interface FakeProgress {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

/** The parts of `XMLHttpRequest` that `uploadForm` uses, driven by the test. */
class FakeXhr {
  static last: FakeXhr | null = null;
  upload: { onprogress: ((event: FakeProgress) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  status = 0;
  responseText = '';
  headers = new Map<string, string>();
  sent: unknown = null;
  method = '';
  url = '';
  aborted = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
  getAllResponseHeaders(): string {
    return 'content-type: application/json';
  }
  send(body: unknown): void {
    this.sent = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  answer(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function lastXhr(): FakeXhr {
  if (FakeXhr.last === null) throw new Error('No request was made');
  return FakeXhr.last;
}

const PICTURE = new File([Uint8Array.of(1, 2, 3)], 'shot.png', { type: 'image/png' });

function mounted(urlId = '108'): { current: ReturnType<typeof useNoteFileUpload> } {
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  const { result } = renderHook(() => useNoteFileUpload(SCOPE, urlId));
  return result;
}

const problem = (status: number, code: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: `https://idraft.ai/api/problems/${code}`,
  title: code,
  status,
  code,
  ...extra,
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.last = null;
});

describe('useNoteFileUpload', () => {
  it('sends one multipart request with the file and no content type of its own, and answers the stored file', async () => {
    const hook = mounted();
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = hook.current.upload(PICTURE);
    });
    const xhr = lastXhr();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(`${window.location.origin}${PATH}`);
    // The browser writes the boundary: a header set by hand would lose it
    expect(xhr.headers.has('content-type')).toBe(false);
    const form = xhr.sent;
    if (!(form instanceof FormData)) throw new Error('not a form');
    expect([...form.keys()]).toEqual(['file']);
    expect(form.get('file')).toBeInstanceOf(File);
    expect((form.get('file') as File).name).toBe('shot.png');
    await act(async () => {
      xhr.answer(201, { data: STORED });
      await result;
    });
    await expect(result).resolves.toEqual(STORED);
  });

  it('is pending while the request runs, and not before or after', async () => {
    const hook = mounted();
    expect(hook.current.pending).toBe(false);
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = hook.current.upload(PICTURE);
    });
    expect(hook.current.pending).toBe(true);
    await act(async () => {
      lastXhr().answer(201, { data: STORED });
      await result;
    });
    expect(hook.current.pending).toBe(false);
  });

  it('reports the progress of the request', () => {
    const hook = mounted();
    const seen: number[] = [];
    act(() => {
      void hook.current.upload(PICTURE, { onProgress: ({ loaded }) => seen.push(loaded) }).catch(() => undefined);
    });
    lastXhr().upload.onprogress?.({ loaded: 2, total: 3, lengthComputable: true });
    expect(seen).toEqual([2]);
  });

  it('stops the request when the signal fires, and rejects with the abort, which is no refusal', async () => {
    const hook = mounted();
    const controller = new AbortController();
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = hook.current.upload(PICTURE, { signal: controller.signal });
    });
    await act(async () => {
      controller.abort();
      await result.catch(() => undefined);
    });
    expect(lastXhr().aborted).toBe(true);
    const failure: unknown = await result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DOMException);
    expect(isNoteFileRefusal(failure)).toBe(false);
    expect(hook.current.pending).toBe(false);
  });

  const refusals: readonly [string, number, Record<string, unknown>, string][] = [
    ['too big', 413, problem(413, 'payload_too_large', { limit_bytes: 10485760 }), 'size'],
    ['of a type that is not allowed', 415, problem(415, 'unsupported_media_type'), 'type'],
    ['over the workspace quota', 422, problem(422, 'quota_exceeded', { limit: 6, used: 6, requested: 1 }), 'quota'],
    [
      'empty',
      422,
      problem(422, 'validation_failed', {
        errors: [{ location: 'body', path: 'file', code: 'file_empty', message: 'x' }],
      }),
      'empty',
    ],
    ['stored nowhere', 503, problem(503, 'storage_unavailable'), 'storage'],
    ['refused for any other reason', 500, problem(500, 'internal_error'), 'failed'],
    ['answered by something that is no problem', 502, { oops: true }, 'failed'],
  ];
  it.each(refusals)('rejects a file that is %s with the kind %s', async (_what, status, body, kind) => {
    const hook = mounted();
    let result: Promise<unknown> = Promise.resolve();
    act(() => {
      result = hook.current.upload(PICTURE);
    });
    await act(async () => {
      lastXhr().answer(status, body);
      await result.catch(() => undefined);
    });
    const failure: unknown = await result.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NoteFileRefusal);
    expect(failure).toMatchObject({ kind });
    expect(isNoteFileRefusal(failure)).toBe(true);
    expect(hook.current.pending).toBe(false);
  });

  it('rejects with failed when the connection is lost or the answer is not a stored file', async () => {
    const hook = mounted();
    let lost: Promise<unknown> = Promise.resolve();
    act(() => {
      lost = hook.current.upload(PICTURE);
    });
    await act(async () => {
      lastXhr().onerror?.();
      await lost.catch(() => undefined);
    });
    await expect(lost).rejects.toMatchObject({ kind: 'failed' });

    let odd: Promise<unknown> = Promise.resolve();
    act(() => {
      odd = hook.current.upload(PICTURE);
    });
    await act(async () => {
      lastXhr().answer(201, { data: { id: 1 } });
      await odd.catch(() => undefined);
    });
    await expect(odd).rejects.toMatchObject({ kind: 'failed' });
  });

  it('refuses a page id that is not a url id before anything is sent', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    expect(() => renderHook(() => useNoteFileUpload(SCOPE, '../108'))).toThrow(UrlIdError);
    expect(FakeXhr.last).toBeNull();
  });
});

describe('refusalKindOf', () => {
  const asProblem = (status: number, body: Record<string, unknown>): unknown =>
    problemFrom(new Response(null, { status, headers: { 'content-type': 'application/problem+json' } }), body);

  it('names what a note write refuses about its files: too many, and an unusable file', () => {
    const tooMany = (code: string): unknown =>
      asProblem(
        422,
        problem(422, 'validation_failed', {
          errors: [{ location: 'body', path: 'attachment_ids', code, message: 'x' }],
        }),
      );
    expect(refusalKindOf(tooMany('too_long'))).toBe('count');
    expect(refusalKindOf(tooMany('too_many_attachments'))).toBe('count');
    expect(
      refusalKindOf(
        asProblem(
          422,
          problem(422, 'validation_failed', {
            errors: [{ location: 'body', path: 'attachment_ids[0]', code: 'attachment_unavailable', message: 'x' }],
          }),
        ),
      ),
    ).toBe('failed');
  });

  it('goes by the status when the body carries no code, and is failed for what is no problem', () => {
    expect(refusalKindOf(asProblem(413, {}))).toBe('size');
    expect(refusalKindOf(asProblem(415, {}))).toBe('type');
    expect(refusalKindOf(asProblem(503, {}))).toBe('storage');
    expect(refusalKindOf(new TypeError('offline'))).toBe('failed');
    expect(refusalKindOf('x')).toBe('failed');
  });
});
