'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { isSignedOut, SIGN_OUT_META } from '@/lib/api/query-client';
import { apiMutation } from '@/lib/api/query';
import { hardNavigate } from '@/lib/navigation/hard-navigate';
import { clearPreferences } from '@/lib/preferences/storage';

const SIGN_IN = '/login';

export interface SignOut {
  /** Ends the session, forgets what this browser kept of it, and loads the sign-in page. Rejects when the API could not be reached. */
  signOut: () => Promise<void>;
  /** From the request until the sign-in page has loaded. */
  pending: boolean;
}

/**
 * Signing out (20-frontend-specification.md section 7.4): the API ends the session and clears the cookie;
 * the page then removes the person's preferences and loads the sign-in page in full, which leaves nothing
 * of the session in memory, the query cache included. The cache is not emptied first: a query still on
 * screen would ask again, hear 401 and send the next person to sign in with this person's page in `next`.
 * The API answers sign-out with 204 even without a session; a 401 is taken as signed out all the same. Any
 * other failure leaves the person signed in and rejects, for the caller to say so.
 */
export function useSignOut(): SignOut {
  const request = useMutation({ ...apiMutation('post', '/api/v1/auth/sign-out'), meta: { [SIGN_OUT_META]: true } });
  const [leaving, setLeaving] = useState(false);
  const signOut = async (): Promise<void> => {
    try {
      await request.mutateAsync(undefined);
    } catch (error) {
      if (!isSignedOut(error)) throw error;
    }
    setLeaving(true);
    clearPreferences();
    hardNavigate(SIGN_IN);
  };
  return { signOut, pending: request.isPending || leaving };
}
