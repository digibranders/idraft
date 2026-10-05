import { z } from 'zod';

import { problemFrom } from '@/lib/api/problem';
import type { UploadOptions } from '@/lib/api/upload';
import { parseCsv } from '@/lib/csv/csv';

const OPTIONS = z.object({ defaults: z.record(z.string(), z.unknown()).optional() });
const UPLOAD_SUFFIX = /\/upload$/;

/**
 * `uploadForm` for component tests. Under jsdom neither route of a multipart body works with MSW: its
 * `XMLHttpRequest` interception cannot read jsdom's `FormData`, and the body parser that answers
 * `request.formData()` makes a `File` that is not jsdom's. So the file is read here and its rows go to the
 * JSON route that takes rows (`source: "api"`), which makes the same preview from the same rows. The real
 * upload is covered by the mocks' own tests (Node), `upload.test.ts` and the browser run. It reports one
 * progress event, the whole file, as the real one does when an upload ends.
 */
export async function fetchUpload(
  path: `/api/v1/${string}`,
  form: FormData,
  options: UploadOptions = {},
): Promise<unknown> {
  const file = form.get('file');
  if (file === null || typeof file === 'string') throw new TypeError('The form has no file');
  const [header = [], ...lines] = parseCsv(new TextDecoder().decode(await file.arrayBuffer()));
  const headers = header.map((name) => name.trim());
  const rows = lines.map((cells) => Object.fromEntries(headers.map((name, index) => [name, cells[index] ?? ''])));
  const optionsText = form.get('options');
  const { defaults } = OPTIONS.parse(typeof optionsText === 'string' ? JSON.parse(optionsText) : {});
  options.onProgress?.({ loaded: file.size, total: file.size });
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
