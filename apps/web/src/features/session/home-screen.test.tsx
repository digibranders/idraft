import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeScreen } from './home-screen';
import { meQuery } from './me-query';
import { mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { preferenceKey } from '@/lib/preferences/storage';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

const navigation = vi.hoisted(() => ({ hardNavigate: vi.fn() }));
vi.mock('@/lib/navigation/hard-navigate', () => ({ hardNavigate: navigation.hardNavigate }));

const EMAIL = 'lena@digibranders.test';
const signedIn = (): void => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.0; Path=/; Secure`;
};

/** A part of the page that shows who is signed in, as the account menu does: it keeps `/me` in the cache. */
function SignedInAs(): ReactNode {
  const { data } = useQuery(meQuery());
  return <p>{data === undefined ? 'loading' : data.data.user.email}</p>;
}

describe('HomeScreen', () => {
  beforeEach(() => {
    navigation.hardNavigate.mockReset();
    signedIn();
  });

  it('says the person is in no workspace yet, as whom, and has no accessibility violation', async () => {
    const { container } = renderWithProviders(<HomeScreen email={EMAIL} invitation={null} workspace={null} />);
    expect(screen.getByRole('heading', { level: 1, name: 'You are not in a workspace yet' })).toBeInTheDocument();
    expect(screen.getByText(`Signed in as ${EMAIL}`)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says why an invitation could not be accepted, and opens the workspace the person has', async () => {
    const { container } = renderWithProviders(
      <HomeScreen email={EMAIL} invitation="expired" workspace={{ name: 'Digibranders', slug: 'digibranders' }} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'The invitation could not be accepted' })).toBeInTheDocument();
    expect(screen.getByText('It has expired. Ask the person who invited you for a new one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to Digibranders' })).toHaveAttribute('href', '/digibranders');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('signs out: the API ends the session, the preferences go, and only the sign-in page loads', async () => {
    localStorage.setItem(preferenceKey(mockUser('editor').user_id, 'density'), 'compact');
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(new URL(request.url).pathname));
    const { user } = renderWithProviders(
      <>
        <HomeScreen email={EMAIL} invitation={null} workspace={null} />
        <SignedInAs />
      </>,
    );
    expect(await screen.findByText(mockUser('editor').email)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/login'));
    // Nothing on the page asks again with the ended session, so nothing sends the next person elsewhere
    expect(asked.slice(asked.indexOf('/api/v1/auth/sign-out') + 1)).toEqual([]);
    expect(navigation.hardNavigate).toHaveBeenCalledTimes(1);
    expect(Object.keys(localStorage).filter((key) => key.startsWith('sightline.pref.'))).toEqual([]);
    expect(document.cookie).not.toContain(SESSION_COOKIE);
    server.events.removeAllListeners();
  });

  it('counts a session that had already ended as signed out', async () => {
    server.use(
      http.post(
        '*/api/v1/auth/sign-out',
        () =>
          new HttpResponse(
            JSON.stringify({
              type: 'about:blank',
              title: 'Sign in',
              status: 401,
              code: 'unauthenticated',
              instance: '/',
              request_id: 'r',
            }),
            { status: 401, headers: { 'content-type': 'application/problem+json' } },
          ),
      ),
    );
    const { user } = renderWithProviders(<HomeScreen email={EMAIL} invitation={null} workspace={null} />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(navigation.hardNavigate).toHaveBeenCalledWith('/login'));
  });

  it('stays signed in and says so when the API cannot be reached', async () => {
    server.use(http.post('*/api/v1/auth/sign-out', () => HttpResponse.error()));
    const { user } = renderWithProviders(<HomeScreen email={EMAIL} invitation={null} workspace={null} />);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('You could not be signed out. Try again in a moment.')).toBeInTheDocument();
    expect(navigation.hardNavigate).not.toHaveBeenCalled();
  });
});
