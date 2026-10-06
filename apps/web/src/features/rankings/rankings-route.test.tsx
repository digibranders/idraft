import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RankingsRoute } from './rankings-route';
import type { RankingsScreenProps } from './rankings-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';

const navigation = vi.hoisted(() => ({
  segment: null as string | null,
  pathname: '/digibranders/fynix/seo/rankings',
  search: '',
  push: vi.fn<(path: string, options: { scroll: boolean }) => void>(),
  replace: vi.fn<(path: string, options: { scroll: boolean }) => void>(),
  back: vi.fn<() => void>(),
}));

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => navigation.segment,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push, replace: navigation.replace, back: navigation.back }),
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

const route = (role: Role = 'editor'): ReactElement => (
  <PermissionProvider membership={membershipFactory(role)}>
    <RankingsRoute
      workspaceSlug="digibranders"
      projectSlug="fynix"
      workspaceId="w"
      projectId="p"
      timeZone="Europe/Berlin"
      defaults={{ location: null, languageCode: 'en' }}
    >
      <p>page</p>
    </RankingsRoute>
  </PermissionProvider>
);

beforeEach(() => {
  navigation.segment = null;
  navigation.pathname = '/digibranders/fynix/seo/rankings';
  navigation.search = '';
  navigation.push.mockClear();
  navigation.replace.mockClear();
  navigation.back.mockClear();
});

describe('RankingsRoute', () => {
  it('opens the import under the page with a history entry of its own, keeping the query string', async () => {
    navigation.search = 'intent=commercial&archived=true';
    render(route());
    expect(screen.getByText('dialog closed')).toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith(
      '/digibranders/fynix/seo/rankings/import?intent=commercial&archived=true',
      { scroll: false },
    );
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('closes a dialog it opened by going back, so Back and Forward stay as they were', async () => {
    const view = render(route());
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    navigation.segment = 'import';
    navigation.pathname = '/digibranders/fynix/seo/rankings/import';
    view.rerender(route());
    expect(screen.getByText('dialog open')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(navigation.back).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('closes by replacing once the browser’s Back button closed the dialog it opened, and a link opened a new one', async () => {
    const view = render(route());
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    navigation.segment = 'import';
    view.rerender(route());
    // The browser's Back button: the segment is gone, the entry the dialog was opened on with it
    navigation.segment = null;
    view.rerender(route());
    navigation.segment = 'import';
    view.rerender(route());
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(navigation.back).not.toHaveBeenCalled();
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  it('reads the import segment as an open dialog, and a dialog that came with the URL closes by replacing', async () => {
    navigation.segment = 'import';
    navigation.pathname = '/digibranders/fynix/seo/rankings/import';
    navigation.search = 'q=audit';
    render(route());
    expect(screen.getByText('dialog open')).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/digibranders/fynix/seo/rankings?q=audit', {
      scroll: false,
    });
  });

  it('builds its paths from the slugs of the URL, encoded', async () => {
    navigation.search = '';
    render(
      <PermissionProvider membership={membershipFactory('editor')}>
        <RankingsRoute
          workspaceSlug="a-b"
          projectSlug="c d"
          workspaceId="w"
          projectId="p"
          timeZone="UTC"
          defaults={{ location: null, languageCode: 'en' }}
        >
          {null}
        </RankingsRoute>
      </PermissionProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(navigation.push).toHaveBeenCalledExactlyOnceWith('/a-b/c%20d/seo/rankings/import', { scroll: false });
  });

  it('replaces the import address of a member who may not import with the page, keeping the query string', () => {
    navigation.segment = 'import';
    navigation.pathname = '/digibranders/fynix/seo/rankings/import';
    navigation.search = 'q=audit';
    render(route('viewer'));
    expect(screen.getByText('dialog closed')).toBeInTheDocument();
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith('/digibranders/fynix/seo/rankings?q=audit', {
      scroll: false,
    });
  });

  it('leaves the page of a viewer as it is when the import is not what the URL names', () => {
    render(route('viewer'));
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
