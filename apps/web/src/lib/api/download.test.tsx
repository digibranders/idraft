import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { downloadApiFile } from './download';
import { isApiProblem } from './problem';
import { server } from '@/test/msw';

vi.mock('@/lib/csv/csv-write', async (original) => ({
  ...(await original<typeof import('@/lib/csv/csv-write')>()),
  downloadBlob: vi.fn(),
}));

describe('downloadApiFile (decision W13)', () => {
  it('asks for the file with the query the list uses and saves it', async () => {
    let asked = '';
    server.use(
      http.get('*/api/v1/files/pages', ({ request }) => {
        asked = new URL(request.url).search;
        return new HttpResponse('url\n/a\n', { headers: { 'content-type': 'text/csv' } });
      }),
    );
    const { downloadBlob } = await import('@/lib/csv/csv-write');
    await downloadApiFile(
      '/api/v1/files/pages',
      { scope: 'all', 'filter[tier]': ['none', 'x'], format: 'csv' },
      'pages.csv',
    );
    expect(decodeURIComponent(asked)).toBe('?scope=all&filter[tier]=none,x&format=csv');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'pages.csv');
  });

  it('turns an error answer into an ApiProblem', async () => {
    server.use(
      http.get('*/api/v1/files/pages', () =>
        HttpResponse.json(
          { code: 'no_crawl', status: 404, title: 'No crawl' },
          { status: 404, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await expect(downloadApiFile('/api/v1/files/pages', {}, 'pages.csv')).rejects.toSatisfy((error) =>
      isApiProblem(error, 'no_crawl'),
    );
  });
});
