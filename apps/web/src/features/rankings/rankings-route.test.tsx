import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RankingsRoute } from './rankings-route';
import type { RankingsScreenProps } from './rankings-screen';

const navigation = vi.hoisted(() => ({
  segment: null as string | null,
  pathname: '/digibranders/fynix/seo/rankings',
  search: '',
  replace: vi.fn<(path: string, options: { scroll: boolean }) => void>(),
}));

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => navigation.segment,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: navigation.replace }),
}));

// The screen is Rankings' own business; the route only tells it whether the dialog is open
vi.mock('./rankings-screen', () => ({
  RankingsScreen: ({ importOpen, onImportOpenChange }: RankingsScreenProps): ReactElement => (
    <div>
      <p>{importOpen === true ? 'dialog open' : 'dialog closed'}</p>
      <button type="button" onClick={() => onImportOpenChange?.(!(importOpen === true))}>
        toggle
      </button>
    </div>
  ),
}));

const route = (): ReactElement => (
  <RankingsRoute
    workspaceId="w"
    projectId="p"
    timeZone="Europe/Berlin"
    defaults={{ location: null, languageCode: 'en' }}
  >
    <p>page</p>
  </RankingsRoute>
);

beforeEach(() => {
  navigation.segment = null;
  navigation.pathname = '/digibranders/fynix/seo/rankings';
  navigation.search = '';
  navigation.replace.mockClear();
});

describe('RankingsRoute', () => {
  it('opens the import under the page, keeping the query string', async () => {
    navigation.search = 'intent=commercial&archived=true';
    render(route());
    expect(screen.getByText('dialog closed')).toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
      '/digibranders/fynix/seo/rankings/import?intent=commercial&archived=true',
      { scroll: false },
    );
  });

  it('reads the import segment as an open dialog, and closes back to the page', async () => {
    navigation.segment = 'import';
    navigation.pathname = '/digibranders/fynix/seo/rankings/import';
    navigation.search = 'q=audit';
    render(route());
    expect(screen.getByText('dialog open')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/digibranders/fynix/seo/rankings?q=audit', {
      scroll: false,
    });
  });
});
