'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { ReauthDialog, type ReauthMethod, type ReauthOutcome } from '@/components/app/shell/reauth-dialog';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { ConfirmContext, type ConfirmIdentity } from '@/lib/session/fresh-session';
import { meQuery } from '@/lib/session/me-query';

/**
 * A confirmation this recent covers a request that was already on its way when it was given: the API
 * then refused it with the session of before, and it is sent again without asking twice.
 */
const JUST_CONFIRMED_MS = 60_000;

/**
 * Holds the one `ReauthDialog` of the page. Requests that need a fresh session while it is open wait for
 * the same answer, so the person confirms once. The dialog asks for what `/me` says the account uses,
 * read again when it opens, since two-factor may have been turned on or off since the page loaded.
 */
export function FreshSessionProvider({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const queryClient = useQueryClient();
  const me = useQuery(meQuery()).data?.data;
  const reauthenticate = useMutation(apiMutation('post', '/api/v1/me/reauthenticate'));
  const [open, setOpen] = useState(false);
  const waiting = useRef<{ answer: Promise<boolean>; settle: (confirmed: boolean) => void } | null>(null);
  const confirmedAt = useRef(Number.NEGATIVE_INFINITY);
  // While the password or code is on its way, Cancel and Escape wait: the answer settles the requests
  const submitting = useRef(false);

  const confirm = useCallback<ConfirmIdentity>(() => {
    if (Date.now() - confirmedAt.current < JUST_CONFIRMED_MS) return Promise.resolve(true);
    if (waiting.current === null) {
      let settle: (confirmed: boolean) => void = () => undefined;
      const answer = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      waiting.current = { answer, settle };
      void queryClient
        .fetchQuery({ ...meQuery(), staleTime: 0 })
        .catch(() => undefined)
        .finally(() => setOpen(true));
    }
    return waiting.current.answer;
  }, [queryClient]);

  const finish = useCallback((confirmed: boolean): void => {
    if (confirmed) confirmedAt.current = Date.now();
    waiting.current?.settle(confirmed);
    waiting.current = null;
    setOpen(false);
  }, []);

  // Requests still waiting when the workspace is left are answered: nobody is there to confirm
  useEffect(() => () => finish(false), [finish]);

  const submit = async (method: ReauthMethod, secret: string): Promise<ReauthOutcome> => {
    submitting.current = true;
    try {
      await reauthenticate.mutateAsync({ body: method === 'password' ? { password: secret } : { totp_code: secret } });
    } catch (error) {
      // One answer for a wrong password and a wrong code, as the API gives it
      if (isApiProblem(error, 'invalid_credentials')) return 'invalid';
      if (isApiProblem(error, 'second_factor_required')) return 'second-factor-required';
      throw error;
    } finally {
      submitting.current = false;
    }
    // `/me` carries the session's freshness
    void queryClient.invalidateQueries({ queryKey: meQuery().queryKey });
    finish(true);
    return 'ok';
  };

  return (
    <ConfirmContext value={confirm}>
      {children}
      <ReauthDialog
        open={open}
        method={me?.user.two_factor_enabled === true ? 'totp' : 'password'}
        onSubmit={submit}
        onCancel={() => {
          if (!submitting.current) finish(false);
        }}
      />
    </ConfirmContext>
  );
}
