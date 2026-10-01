'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { InviteDialog } from './invite-dialog';
import { invitationsQuery } from './workspace-queries';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { Invitation } from '@/lib/api/types';
import { browserTimeZone, formatTableDateTime } from '@/lib/format/date';
import { useMembership } from '@/lib/permissions';

const WITHDRAW = apiMutation('delete', '/api/v1/workspaces/{workspace_id}/invitations/{invitation_id}');
const SKELETON_ROWS = 2;

/**
 * The invitations of the workspace that wait for an answer (20 section 5.19.2), with "Invite people" and
 * "Withdraw". Shown to members with `members:manage` only: the API lists invitations to them alone.
 */
export function InvitationsSection(): ReactNode {
  const t = useTranslations('workspaceSettings.invitations');
  const members = useTranslations('workspaceSettings.members');
  const roles = useTranslations('common.roles');
  const common = useTranslations('common');
  const membership = useMembership();
  const workspaceId = membership.workspace.workspace_id;
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery(workspaceId));
  const withdraw = useMutation(WITHDRAW);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Invitation | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  // Once the row is gone with its button, the dialog hands focus to the section's heading
  const [rowGone, setRowGone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const pending = invitations.data?.data.filter((invitation) => invitation.status === 'pending') ?? [];
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: invitationsQuery(workspaceId).queryKey });

  const confirmWithdraw = async (): Promise<void> => {
    if (withdrawing === null) return;
    setWithdrawError(null);
    try {
      await withdraw.mutateAsync({
        params: { path: { workspace_id: workspaceId, invitation_id: withdrawing.invitation_id } },
      });
    } catch (error) {
      if (isApiProblem(error, 'invalid_state_transition') || isApiProblem(error, 'not_found')) {
        // Used, withdrawn or expired meanwhile: the list shows what it is now
        toast({ type: 'info', title: t('withdrawDialog.gone') });
        setRowGone(true);
        refresh();
        return;
      }
      setWithdrawError(t('withdrawDialog.failed'));
      throw error;
    }
    toast({ type: 'success', title: t('withdrawDialog.withdrawn', { email: withdrawing.email }) });
    setRowGone(true);
    refresh();
  };

  return (
    <section aria-labelledby="invitations-title" className="flex flex-col gap-3 pt-2">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id="invitations-title" ref={heading} tabIndex={-1} className="type-section-title outline-none">
            {t('title')}
          </h2>
          <p className="mt-1 type-meta">{t('description')}</p>
        </div>
        <Button variant="secondary" size="sm" aria-haspopup="dialog" onClick={() => setInviteOpen(true)}>
          <Icon icon={UserPlus} size="sm" />
          {t('invite')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        {invitations.isError ? (
          <InlineError
            title={t('loadFailed')}
            reason={t('loadFailedReason')}
            errorId={null}
            onRetry={() => void invitations.refetch()}
            retrying={invitations.isFetching}
            retryLabel={common('retry')}
          />
        ) : !invitations.isPending && pending.length === 0 ? (
          <p className="px-4 py-3 type-body text-foreground-secondary">{t('none')}</p>
        ) : (
          <table className="w-full">
            <caption className="sr-only">{t('table')}</caption>
            <thead className="bg-surface-subtle">
              <tr>
                <th scope="col" className="h-row-header px-4 text-left type-label">
                  {t('email')}
                </th>
                <th scope="col" className="h-row-header px-3 text-left type-label">
                  {t('role')}
                </th>
                <th
                  scope="col"
                  className="hidden h-row-header px-3 text-left type-label whitespace-nowrap md:table-cell"
                >
                  {t('access')}
                </th>
                <th
                  scope="col"
                  className="hidden h-row-header px-3 text-left type-label whitespace-nowrap lg:table-cell"
                >
                  {t('invitedBy')}
                </th>
                <th scope="col" className="hidden h-row-header px-3 text-left type-label sm:table-cell">
                  {t('expires')}
                </th>
                <th scope="col" className="h-row-header px-4">
                  <span className="sr-only">{t('withdraw')}</span>
                </th>
              </tr>
            </thead>
            <tbody aria-busy={invitations.isPending}>
              {invitations.isPending
                ? Array.from({ length: SKELETON_ROWS }, (_, row) => (
                    <tr key={row} className="h-row border-t border-border-subtle">
                      <td colSpan={6} className="px-4">
                        <Skeleton shape="text-14" widthPct={56} />
                      </td>
                    </tr>
                  ))
                : pending.map((invitation) => (
                    <tr key={invitation.invitation_id} className="h-row border-t border-border-subtle">
                      <th scope="row" className="px-4 text-left type-body font-normal text-foreground">
                        {invitation.email}
                      </th>
                      <td className="px-3">
                        <Badge>{roles(invitation.role)}</Badge>
                      </td>
                      <td className="hidden px-3 type-body whitespace-nowrap text-foreground-secondary md:table-cell">
                        {invitation.project_ids === null
                          ? members('allProjects')
                          : members('someProjects', { count: invitation.project_ids.length })}
                      </td>
                      <td className="hidden px-3 type-body whitespace-nowrap text-foreground-secondary lg:table-cell">
                        {invitation.invited_by.name}
                      </td>
                      <td className="hidden px-3 type-body whitespace-nowrap text-foreground-secondary sm:table-cell">
                        {formatTableDateTime(invitation.expires_at, browserTimeZone())}
                      </td>
                      <td className="px-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('withdrawFor', { email: invitation.email })}
                          onClick={() => {
                            setRowGone(false);
                            setWithdrawing(invitation);
                          }}
                        >
                          {t('withdraw')}
                        </Button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </div>
      <InviteDialog
        workspaceId={workspaceId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        callerIsOwner={membership.role === 'owner'}
      />
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setWithdrawing(null);
            setWithdrawError(null);
          }
        }}
        finalFocus={rowGone ? heading : undefined}
        title={t('withdrawDialog.title', { email: withdrawing?.email ?? '' })}
        description={t('withdrawDialog.description')}
        confirmLabel={t('withdrawDialog.confirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmWithdraw}
        error={withdrawError}
      />
    </section>
  );
}
