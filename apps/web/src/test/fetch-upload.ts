import { z } from 'zod';

import { problemFrom } from '@/lib/api/problem';
import type { UploadOptions, UploadProgress } from '@/lib/api/upload';
import { parseCsv } from '@/lib/csv/csv';

const OPTIONS = z.object({ defaults: z.record(z.string(), z.unknown()).optional() });
const UPLOAD_SUFFIX = /\/upload$/;

/**
 * What a test can set to watch an upload that is under way: the progress events it reports (instead of the
 * one for the whole file) and a promise that holds the request back until the test lets it go.
 */
export const uploadScript: { events: readonly UploadProgress[] | null; hold: Promise<void> | null } = {
  events: null,
  hold: null,
};

/** Back to an upload that reports the whole file at once and is not held. Call it in `afterEach`. */
export function resetUploadScript(): void {
  uploadScript.events = null;
  uploadScript.hold = null;
}

const abortError = (): DOMException => new DOMException('The upload was stopped', 'AbortError');

/** Waits for `hold`, or rejects when the signal fires first, as a real upload ends when it is aborted. */
function held(hold: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return hold;
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
    void hold.then(resolve, reject);
  });
}

/**
 * `uploadForm` for component tests. Under jsdom neither route of a multipart body works with MSW: its
 * `XMLHttpRequest` interception cannot read jsdom's `FormData`, and the body parser that answers
 * `request.formData()` makes a `File` that is not jsdom's. So the file is read here and its rows go to the
 * JSON route that takes rows (`source: "api"`), which makes the same preview from the same rows. The real
 * upload is covered by the mocks' own tests (Node), `upload.test.ts` and the browser run. The rows are keyed
 * by the header text exactly as the file has it, spaces and case included, as the file itself reaches the API.
 * It reports one progress event, the whole file, as the real one does when an upload ends, unless a test
 * scripted others.
 */
export async function fetchUpload(
  path: `/api/v1/${string}`,
  form: FormData,
  options: UploadOptions = {},
): Promise<unknown> {
  const file = form.get('file');
  if (file === null || typeof file === 'string') throw new TypeError('The form has no file');
  const [headers = [], ...lines] = parseCsv(new TextDecoder().decode(await file.arrayBuffer()));
  const rows = lines.map((cells) => Object.fromEntries(headers.map((name, index) => [name, cells[index] ?? ''])));
  const optionsText = form.get('options');
  const { defaults } = OPTIONS.parse(typeof optionsText === 'string' ? JSON.parse(optionsText) : {});
  for (const event of uploadScript.events ?? [{ loaded: file.size, total: file.size }]) options.onProgress?.(event);
  if (uploadScript.hold !== null) await held(uploadScript.hold, options.signal);
  const response = await fetch(new URL(path.replace(UPLOAD_SUFFIX, ''), window.location.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'api', rows, ...(defaults === undefined ? {} : { defaults }) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const text = await response.text();
  const parsed: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) throw problemFrom(response, parsed);
  return parsed;
}
