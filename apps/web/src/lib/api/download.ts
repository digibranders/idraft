import { apiFetch } from './api-fetch';
import { problemFrom } from './problem';
import { downloadBlob } from '@/lib/csv/csv-write';
import { newRequestId, REQUEST_ID_HEADER } from '@/lib/request-id';

/** A query value: lists go once, comma separated, as the typed client sends them (client.ts). */
export type DownloadQuery = Readonly<Record<string, string | number | boolean | readonly string[]>>;

/**
 * Saves a file the API answers (a list with `format=csv`, decision W13). The typed client refuses a 2xx that is not
 * JSON, so this one request goes through `apiFetch` with the request id, and an error answer becomes an
 * `ApiProblem` the screen shows as it shows any other.
 */
export async function downloadApiFile(path: `/api/v1/${string}`, query: DownloadQuery, name: string): Promise<void> {
  downloadBlob(await fetchApiBlob(path, query), name);
}

/** Reads a file the API answers without saving it, for a screen that looks at it first (the planned fixes). */
export async function fetchApiBlob(path: `/api/v1/${string}`, query: DownloadQuery): Promise<Blob> {
  const search = Object.entries(query)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(Array.isArray(value) ? value.join(',') : String(value))}`,
    )
    .join('&');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const request = new Request(`${origin}${path}${search === '' ? '' : `?${search}`}`, {
    credentials: 'same-origin',
    headers: { [REQUEST_ID_HEADER]: newRequestId() },
  });
  const response = await apiFetch(request);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw problemFrom(response, body);
  }
  return response.blob();
}
