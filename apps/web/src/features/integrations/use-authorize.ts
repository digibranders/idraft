'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';

import { AUTHORIZE_GSC, type GscScope } from './gsc-queries';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { useFreshSession } from '@/lib/session/fresh-session';

export interface Authorize {
  /** Asks the API for Google's consent address and sends the person there. */
  connect: () => void;
  /** From the click until the page leaves: the button keeps its place and ignores clicks. */
  pending: boolean;
  /** Why it did not start, in words, or `null`. A person who cancelled the sign-in check gets none. */
  error: string | null;
}

/**
 * Whether `address` is somewhere the page may send the person: Google's consent page over https, or, in a
 * development setup, this same origin. The address comes from the API, but a page that navigates to
 * whatever it is told would turn a wrong answer into an open redirect.
 */
export function isConsentAddress(address: string, origin: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' || url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Starts connecting Google (docs/18 section 4.8): `POST .../integrations/gsc/authorize` needs a fresh
 * session, which `withFresh` asks for, then the page navigates to the consent address. Google returns the
 * person to this page with `?connection_id=` or `?error=`.
 */
export function useAuthorize({ workspaceId, projectId }: GscScope): Authorize {
  const t = useTranslations('integrations');
  const withFresh = useFreshSession();
  const { mutationFn } = AUTHORIZE_GSC;
  if (mutationFn === undefined) throw new Error('apiMutation gave no mutationFn');
  const authorize = useMutation({ ...AUTHORIZE_GSC, mutationFn: withFresh(mutationFn) });
  const [navigating, setNavigating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback((): void => {
    setError(null);
    authorize
      .mutateAsync({ params: { path: { workspace_id: workspaceId, project_id: projectId, kind: 'gsc' } } })
      .then((answer) => {
        const address = answer.data.authorization_url;
        if (!isConsentAddress(address, window.location.origin)) {
          setError(t('authorizeFailed'));
          return;
        }
        setNavigating(true);
        announce(t('opening'));
        hardNavigate(address);
      })
      .catch((failure: unknown) => {
        // Cancelling the sign-in check means nothing was asked of Google
        if (isApiProblem(failure, 'fresh_session_required')) return;
        setError(
          isApiProblem(failure, 'integration_not_configured') ? t('authorizeNotConfigured') : t('authorizeFailed'),
        );
      });
  }, [authorize, workspaceId, projectId, t]);

  return { connect, pending: authorize.isPending || navigating, error };
}
