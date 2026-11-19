import { screen } from '@testing-library/react';
import { FileText } from 'lucide-react';
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
        icon: FileText,
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

  it.each(['0192e4a0-1000-7000-8000-0000000000ff', 'not-a-uuid'])(
    'shows not found instead of the tab for the crawl id %s',
    async (run) => {
      renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?run=${run}` });
      expect(await screen.findByRole('heading', { name: 'That crawl was not found' })).toBeInTheDocument();
      expect(screen.queryByTestId('context')).toBeNull();
    },
  );

  it('reads an uppercase crawl id as the same crawl as the lowercase one', async () => {
    const older = HISTORY_RUN_IDS[1] ?? '';
    renderWithProviders(internalLinksAs('editor', EVENTUS_LINKS), { searchParams: `?run=${older.toUpperCase()}` });
    expect(await contextOf()).toMatchObject({ run: older, unknown: false, older: true });
  });
});
