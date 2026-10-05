import { problemFrom } from './problem';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';

export interface UploadProgress {
  loaded: number;
  /** `null` when the browser cannot tell the size. */
  total: number | null;
}

export interface UploadOptions {
  onProgress?: ((progress: UploadProgress) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** Response headers as `XMLHttpRequest` lists them, for `problemFrom`. */
function headersOf(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const at = line.indexOf(':');
    if (at > 0) headers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return headers;
}

/** The parsed JSON body of an answer, its text when it is not JSON, `null` when it is empty. */
function bodyOf(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const abortError = (): DOMException => new DOMException('The upload was stopped', 'AbortError');

/**
 * A multipart POST to this app's API with upload progress, which `fetch` cannot report. Same origin, so the
 * session cookie goes along as with the typed client, and with an `X-Request-Id` as every request has. The
 * answer is the parsed JSON body, `unknown` until the caller checks it; an error answer rejects with the
 * `ApiProblem`, a lost connection with a `TypeError` (retryable, as `fetch`'s), an abort with an `AbortError`.
 */
export function uploadForm(path: `/api/v1/${string}`, form: FormData, options: UploadOptions = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${window.location.origin}${path}`);
    xhr.setRequestHeader(REQUEST_ID_HEADER, newRequestId());
    xhr.upload.onprogress = (event) => {
      options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null });
    };
    xhr.onload = () => {
      const body = bodyOf(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      // `problemFrom` reads the status and the headers of the response, and the body as parsed here
      const response = new Response(null, { status: xhr.status, headers: headersOf(xhr.getAllResponseHeaders()) });
      reject(problemFrom(response, body));
    };
    xhr.onerror = () => {
      reject(new TypeError('The upload lost its connection'));
    };
    xhr.onabort = () => {
      reject(abortError());
    };
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
