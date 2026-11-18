import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LinksTabContext } from './tabs';
import { HISTORY_RUN_IDS } from '@/mocks/internal-links-world';
import { EVENTUS_LINKS, internalLinksAs } from '@/test/internal-links-harness';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/eventus-security/seo/internal-links',
  useSearchParams: () => new URLSearchParams(),
}));

// One tab that shows what the screen hands every tab, so the Changes and Opportunities tabs (Task 12 onward) can read it
vi.mock('./tabs', async (importOriginal) => {
  const original = await importOriginal<typeof import('./tabs')>();
  return {
    ...original,
    LINKS_TABS: original.defineLinksTabs([
      {
        id: 'pages',
        label: () => 'Pages',
        render: (context: LinksTabContext) => (
          <p data-testid="context">
            {JSON.stringify({
              run: context.crawl.run,
              unknown: context.crawl.unknown,
              older: context.crawl.older,
              linksAvailable: context.crawl.linksAvailable,
              invalidRun: context.state.invalid.run,
            })}
          </p>
        ),
      },
    ]),
  };
});

beforeEach(() => stubWideScreen());
afterEach(() => restoreWideScreen());

const contextOf = async (): Promise<Record<string, unknown>> =>
  JSON.parse((await screen.findByTestId('context')).textContent ?? '{}');

describe('what the screen hands every tab about the crawl in view', () => {
  it('exposes the older crawl, and that its links are kept', async () => {
    const older = HISTORY_RUN_IDS[1] ?? '';
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?run=${older}` });
    expect(await contextOf()).toEqual({
      run: older,
      unknown: false,
      older: true,
      linksAvailable: true,
      invalidRun: null,
    });
  });

  it('exposes `unknown` for a crawl id that names no crawl of the project, which Task 12 shows as not found', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), {
      searchParams: '?run=0192e4a0-1000-7000-8000-0000000000ff',
    });
    expect(await contextOf()).toMatchObject({ run: null, unknown: true, older: false, invalidRun: null });
  });

  it('exposes `invalid.run` for a malformed crawl id: read as the latest, so `unknown` is false and Task 12 reads `invalid.run`', async () => {
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: '?run=not-a-uuid' });
    expect(await contextOf()).toMatchObject({ run: null, unknown: false, invalidRun: 'not-a-uuid' });
  });

  it('reads an uppercase crawl id as the same crawl as the lowercase one', async () => {
    const older = HISTORY_RUN_IDS[1] ?? '';
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?run=${older.toUpperCase()}` });
    expect(await contextOf()).toMatchObject({ run: older, unknown: false, older: true });
  });
});
