'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { ChangePasswordDialog } from './change-password-dialog';
import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, apiQuery } from '@/lib/api/query';
import type { SessionItem } from '@/lib/api/types';
import { browserTimeZone, formatRelative } from '@/lib/format/date';
import { parseUserAgent } from '@/lib/format/user-agent';
import { useMe } from '@/lib/session/use-me';

const SESSIONS = apiQuery('/api/v1/auth/sessions');

/**
 * Settings > Security (11-navigation.md section 5): the password, the state of two-factor authentication
 * (setup comes later: this shows the state only), and the sessions signed in to the account, each of which
 * can be signed out.
 */
export function SecurityScreen(): ReactNode {
  const t = useTranslations('account.security');
  const { user } = useMe();
  const [passwordOpen, setPasswordOpen] = useState(false);
  return (
    <section aria-labelledby="security-title" className="flex flex-col gap-5">
      <div>
        <h2 id="security-title" className="type-section-title">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1 basis-60">
            <p className="type-body-strong text-foreground">{t('password')}</p>
            <p className="type-meta">{t('passwordHint')}</p>
          </div>
          <Button variant="secondary" aria-haspopup="dialog" onClick={() => setPasswordOpen(true)}>
            {t('changePassword')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3">
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex items-center gap-2 type-body-strong text-foreground">
              {t('twoFactor')}
              {user.two_factor_enabled ? (
                <Badge tone="positive">{t('twoFactorOn')}</Badge>
              ) : (
                <Badge>{t('twoFactorOff')}</Badge>
              )}
            </p>
            <p className="type-meta">{t('twoFactorLater')}</p>
          </div>
        </div>
      </div>
      <Sessions />
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </section>
  );
}

function Sessions(): ReactNode {
  const t = useTranslations('account.security');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const sessions = useQuery(SESSIONS);
  const revokeOne = useMutation(apiMutation('delete', '/api/v1/auth/sessions/{session_id}'));
  const revokeOthers = useMutation(apiMutation('post', '/api/v1/auth/sessions/revoke-others'));
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: SESSIONS.queryKey });
  const fail = (): void => {
    toast({ type: 'error', title: t('actionFailed') });
  };
  // The button that was pressed goes with its row, or with the last other session: focus stays in the section
  const done = (message: string): void => {
    toast({ type: 'success', title: message });
    heading.current?.focus();
  };
  const deviceOf = (session: SessionItem): string => {
    const names = parseUserAgent(session.user_agent);
    if (names === null) return t('unknownDevice');
    return names.browser !== null && names.system !== null
      ? t('deviceOn', { browser: names.browser, system: names.system })
      : (names.browser ?? names.system ?? t('unknownDevice'));
  };

  const signOut = (session: SessionItem): void => {
    revokeOne
      .mutateAsync({ params: { path: { session_id: session.session_id } } })
      .then(() => done(t('sessionSignedOut')))
      .catch((error: unknown) => {
        // A session that ended meanwhile (it expired, or another device signed it out) is what was asked for
        if (isApiProblem(error, 'not_found')) done(t('sessionSignedOut'));
        else fail();
      })
      .finally(refresh);
  };
  const signOutOthers = (): void => {
    revokeOthers
      .mutateAsync(undefined)
      .then(() => done(t('othersSignedOut')))
      .catch(fail)
      .finally(refresh);
  };
  const others = sessions.data?.data.filter((session) => !session.is_current).length ?? 0;

  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 ref={heading} tabIndex={-1} className="type-subsection-title outline-none">
            {t('sessions')}
          </h3>
          <p className="mt-1 type-meta">{t('sessionsDescription')}</p>
        </div>
        {others === 0 ? null : (
          <Button variant="secondary" size="sm" loading={revokeOthers.isPending} onClick={signOutOthers}>
            {t('signOutOthers')}
          </Button>
        )}
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
        {sessions.isError ? (
          <InlineError
            title={t('loadFailed')}
            reason={t('actionFailed')}
            errorId={null}
            onRetry={() => void sessions.refetch()}
            retrying={sessions.isFetching}
            retryLabel={common('retry')}
          />
        ) : (
          <table className="w-full type-table">
            <caption className="sr-only">{t('sessions')}</caption>
            <thead className="bg-surface-subtle">
              <tr>
                <th scope="col" className="h-row-header px-4 text-left type-table-header">
                  {t('device')}
                </th>
                <th scope="col" className="hidden h-row-header px-3 text-left type-table-header sm:table-cell">
                  {t('place')}
                </th>
                <th scope="col" className="h-row-header px-3 text-left type-table-header">
                  {t('lastActive')}
                </th>
                <th scope="col" className="h-row-header px-4 text-right">
                  <span className="sr-only">{t('signOut')}</span>
                </th>
              </tr>
            </thead>
            <tbody aria-busy={sessions.isPending}>
              {sessions.isPending ? (
                <tr className="h-row-compact border-t border-border-subtle">
                  <td colSpan={4} className="px-4">
                    <Skeleton shape="text-12" widthPct={56} />
                  </td>
                </tr>
              ) : (
                sessions.data?.data.map((session) => {
                  const device = deviceOf(session);
                  return (
                    <tr key={session.session_id} className="h-row-compact border-t border-border-subtle">
                      <th scope="row" className="px-4 text-left font-normal">
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span className="whitespace-nowrap text-foreground">{device}</span>
                          {session.is_current ? <Badge tone="info">{t('thisDevice')}</Badge> : null}
                        </span>
                      </th>
                      <td className="hidden px-3 text-foreground-secondary sm:table-cell">
                        <span className="font-mono">{session.ip ?? t('unknownIp')}</span>
                      </td>
                      <td className="px-3 whitespace-nowrap text-foreground-secondary">
                        {formatRelative(session.last_seen_at, browserTimeZone())}
                      </td>
                      <td className="px-4 text-right">
                        {session.is_current ? null : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('signOutSession', { device })}
                            loading={
                              revokeOne.isPending && revokeOne.variables?.params.path.session_id === session.session_id
                            }
                            onClick={() => signOut(session)}
                          >
                            {t('signOut')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
