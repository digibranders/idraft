import { afterEach, describe, expect, it, vi } from 'vitest';

import { isApiProblem } from './problem';
import { uploadForm } from './upload';

interface FakeProgress {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

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
  responseHeaders = 'content-type: application/json';
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
    return this.responseHeaders;
  }
  send(body: unknown): void {
    this.sent = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
}

/** The request the code under test just made. */
function lastXhr(): FakeXhr {
  if (FakeXhr.last === null) throw new Error('No request was made');
  return FakeXhr.last;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeXhr.last = null;
});

describe('uploadForm', () => {
  it('posts the form with a request id, reports progress and answers the JSON body', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const progress: (number | null)[] = [];
    const form = new FormData();
    const answer = uploadForm('/api/v1/x', form, { onProgress: ({ loaded }) => progress.push(loaded) });
    const xhr = lastXhr();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(`${window.location.origin}/api/v1/x`);
    expect(xhr.headers.get('x-request-id')).toMatch(/^req_.+/);
    expect(xhr.sent).toBe(form);
    xhr.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true });
    xhr.status = 202;
    xhr.responseText = '{"data":{"import_id":"i1"}}';
    xhr.onload?.();
    await expect(answer).resolves.toEqual({ data: { import_id: 'i1' } });
    expect(progress).toEqual([50]);
  });

  it('says the total is unknown when the browser cannot tell it', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const seen: { loaded: number; total: number | null }[] = [];
    const answer = uploadForm('/api/v1/x', new FormData(), { onProgress: (value) => seen.push(value) });
    const xhr = lastXhr();
    xhr.upload.onprogress?.({ loaded: 7, total: 0, lengthComputable: false });
    xhr.status = 202;
    xhr.onload?.();
    await expect(answer).resolves.toBeNull();
    expect(seen).toEqual([{ loaded: 7, total: null }]);
  });

  it('turns an error answer into the API problem', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const answer = uploadForm('/api/v1/x', new FormData());
    const xhr = lastXhr();
    xhr.status = 413;
    xhr.responseHeaders = 'content-type: application/problem+json\r\nx-request-id: req_1';
    xhr.responseText = JSON.stringify({
      type: 'about:blank',
      title: 'Too large',
      status: 413,
      code: 'payload_too_large',
      limit_bytes: 52_428_800,
    });
    xhr.onload?.();
    await expect(answer).rejects.toSatisfy((error: unknown) => isApiProblem(error, 'payload_too_large'));
    await expect(answer).rejects.toMatchObject({ status: 413, requestId: 'req_1' });
  });

  it('turns an error answer that is not JSON into an http_error problem', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const answer = uploadForm('/api/v1/x', new FormData());
    const xhr = lastXhr();
    xhr.status = 502;
    xhr.responseHeaders = 'content-type: text/html';
    xhr.responseText = '<html>Bad gateway</html>';
    xhr.onload?.();
    await expect(answer).rejects.toSatisfy((error: unknown) => isApiProblem(error, 'http_error'));
  });

  it('rejects with a TypeError when the connection fails, and with an AbortError when aborted', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const failed = uploadForm('/api/v1/x', new FormData());
    lastXhr().onerror?.();
    await expect(failed).rejects.toBeInstanceOf(TypeError);
    const controller = new AbortController();
    const aborted = uploadForm('/api/v1/x', new FormData(), { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(lastXhr().aborted).toBe(true);
  });

  it('gives up on a request that takes ten minutes, as on a lost connection', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const answer = uploadForm('/api/v1/x', new FormData());
    const xhr = lastXhr();
    expect(xhr.timeout).toBe(10 * 60_000);
    xhr.ontimeout?.();
    await expect(answer).rejects.toBeInstanceOf(TypeError);
  });

  it('stops listening to the signal once the request is over, however it ended', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const endings: [string, (xhr: FakeXhr) => void][] = [
      [
        'an answer',
        (xhr) => {
          xhr.status = 202;
          xhr.onload?.();
        },
      ],
      ['a lost connection', (xhr) => xhr.onerror?.()],
      ['a timeout', (xhr) => xhr.ontimeout?.()],
    ];
    for (const [, end] of endings) {
      const controller = new AbortController();
      const removed = vi.spyOn(controller.signal, 'removeEventListener');
      const answer = uploadForm('/api/v1/x', new FormData(), { signal: controller.signal }).catch(() => undefined);
      const xhr = lastXhr();
      end(xhr);
      await answer;
      expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
      // A later abort of the same signal (a dialog that closes) touches a request that is over no more
      controller.abort();
      expect(xhr.aborted).toBe(false);
    }
  });

  it('does not send when the signal is already aborted', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const controller = new AbortController();
    controller.abort();
    const answer = uploadForm('/api/v1/x', new FormData(), { signal: controller.signal });
    await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last).toBeNull();
  });
});
