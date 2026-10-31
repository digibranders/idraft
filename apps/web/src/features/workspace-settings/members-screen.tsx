'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { MemberDialog } from './member-dialog';
import { membersQuery, refreshPeople } from './workspace-queries';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import type { Member } from '@/lib/api/types';
import { browserTimeZone, formatRelative } from '@/lib/format/date';
import { useCan, useMembership } from '@/lib/permissions';
import { useFreshSession } from '@/lib/session/fresh-session';
import { useMe } from '@/lib/session/use-me';

const REMOVE = apiMutation('delete', '/api/v1/workspaces/{workspace_id}/members/{user_id}');
const SKELETON_ROWS = 3;

/**
 * Workspace settings > Members and roles (20 section 5.19.2): every member with their role, project access,
 * two-factor and last activity. With `members:manage`, each row has "Change role and access" and "Remove
 * from workspace"; an owner's row, and the owner role, are for owners only.
 */
export function MembersScreen(): ReactNode {
  const t = useTranslations('workspaceSettings.members');
  const common = useTranslations('common');
  const roles = useTranslations('common.roles');
  const membership = useMembership();
  const { user } = useMe();
  const canManage = useCan('members:manage');
  const workspaceId = membership.workspace.workspace_id;
  const queryClient = useQueryClient();
  const members = useQuery(membersQuery(workspaceId));
  const withFresh = useFreshSession();
  const { mutationFn } = REMOVE;
  if (mutationFn === undefined) throw new Error('apiMutation gave no mutationFn');
  const remove = useMutation({ ...REMOVE, mutationFn: withFresh(mutationFn) });
  const [editing, setEditing] = useState<Member | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Once the row is gone with its menu button, the dialog hands focus to the section's heading
  const [rowGone, setRowGone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const callerIsOwner = membership.role === 'owner';

  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    setRemoveError(null);
    try {
      await remove.mutateAsync({ params: { path: { workspace_id: workspaceId, user_id: removing.user.user_id } } });
    } catch (error) {
      if (isApiProblem(error, 'not_found')) {
        // Removed meanwhile, by someone else: the list catches up and the question closes
        toast({ type: 'info', title: t('removeDialog.gone', { name: removing.user.name }) });
        setRowGone(true);
        refreshPeople(queryClient, workspaceId);
        return;
      }
      // A cancelled "Confirm it is you" keeps the question open with nothing to say
      if (!isApiProblem(error, 'fresh_session_required')) {
        setRemoveError(
          isApiProblem(error, 'last_owner')
            ? t('removeDialog.lastOwner')
            : t('removeDialog.failed', { name: removing.user.name }),
        );
      }
      throw error;
    }
    toast({ type: 'success', title: t('removeDialog.removed', { name: removing.user.name }) });
    setRowGone(true);
    refreshPeople(queryClient, workspaceId);
  };

  const itemsFor = (member: Member): MenuItemDef[] => {
    const ownerOnly = member.role === 'owner' && !callerIsOwner ? t('dialog.forbidden') : undefined;
    return [
      { id: 'change', label: t('change'), disabledReason: ownerOnly, onSelect: () => setEditing(member) },
      // Leaving the workspace is deferred, so a member cannot remove themselves here
      ...(member.user.user_id === user.user_id
        ? []
        : [
            {
              id: 'remove',
              label: t('remove'),
              tone: 'destructive' as const,
              disabledReason: ownerOnly,
              onSelect: () => {
                setRowGone(false);
                setRemoving(member);
              },
            },
          ]),
    ];
  };

  return (
    <section aria-labelledby="members-title" className="flex flex-col gap-5">
      <div>
        <h2 id="members-title" ref={heading} tabIndex={-1} className="type-section-title outline-none">
          {t('title')}
        </h2>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      {canManage ? null : <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        {members.isError ? (
          <InlineError
            title={t('loadFailed')}
            reason={t('loadFailedReason')}
            errorId={null}
            onRetry={() => void members.refetch()}
            retrying={members.isFetching}
            retryLabel={common('retry')}
          />
        ) : (
          <table className="w-full type-table">
            <caption className="sr-only">{t('table')}</caption>
            <thead className="bg-surface-subtle">
              <tr>
                <th scope="col" className="h-row-header px-4 text-left type-table-header">
                  {t('member')}
                </th>
                <th scope="col" className="h-row-header px-3 text-left type-table-header">
                  {t('role')}
                </th>
                <th
                  scope="col"
                  className="hidden h-row-header px-3 text-left type-table-header whitespace-nowrap md:table-cell"
                >
                  {t('access')}
                </th>
                <th scope="col" className="hidden h-row-header px-3 text-left type-table-header lg:table-cell">
                  {t('twoFactor')}
                </th>
                <th scope="col" className="hidden h-row-header px-3 text-left type-table-header lg:table-cell">
                  {t('lastActive')}
                </th>
                {canManage ? (
                  <th scope="col" className="h-row-header px-4 text-right">
                    <span className="sr-only">{t('actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody aria-busy={members.isPending}>
              {members.isPending
                ? Array.from({ length: SKELETON_ROWS }, (_, row) => (
                    <tr key={row} className="h-row-compact border-t border-border-subtle">
                      <td colSpan={canManage ? 6 : 5} className="px-4">
                        <Skeleton shape="text-12" widthPct={56} />
                      </td>
                    </tr>
                  ))
                : members.data.data.map((member) => (
                    <tr key={member.user.user_id} className="h-row-compact border-t border-border-subtle">
                      <th scope="row" className="px-4 text-left font-normal">
                        <span className="flex flex-col">
                          <span className="flex items-center gap-2 text-foreground">
                            {member.user.name}
                            {member.user.user_id === user.user_id ? <Badge>{t('you')}</Badge> : null}
                          </span>
                          <span className="type-label">{member.user.email}</span>
                        </span>
                      </th>
                      <td className="px-3">
                        <Badge>{roles(member.role)}</Badge>
                      </td>
                      <td className="hidden px-3 whitespace-nowrap text-foreground-secondary md:table-cell">
                        {member.project_ids === null
                          ? t('allProjects')
                          : t('someProjects', { count: member.project_ids.length })}
                      </td>
                      <td className="hidden px-3 text-foreground-secondary lg:table-cell">
                        {member.two_factor_enabled === null
                          ? null
                          : member.two_factor_enabled
                            ? t('twoFactorOn')
                            : t('twoFactorOff')}
                      </td>
                      <td className="hidden px-3 whitespace-nowrap text-foreground-secondary lg:table-cell">
                        {member.last_active_at === null
                          ? null
                          : formatRelative(member.last_active_at, browserTimeZone())}
                      </td>
                      {canManage ? (
                        <td className="px-4 text-right">
                          <Menu
                            align="end"
                            trigger={
                              <IconButton
                                icon={MoreHorizontal}
                                size="icon-sm"
                                variant="ghost"
                                label={t('actionsFor', { name: member.user.name })}
                              />
                            }
                            items={itemsFor(member)}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </div>
      <MemberDialog
        workspaceId={workspaceId}
        member={editing}
        callerIsOwner={callerIsOwner}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (open) setRowGone(false);
          else {
            setRemoving(null);
            setRemoveError(null);
          }
        }}
        finalFocus={rowGone ? heading : undefined}
        title={t('removeDialog.title', { name: removing?.user.name ?? '' })}
        description={t('removeDialog.description', { name: removing?.user.name ?? '' })}
        confirmLabel={t('removeDialog.confirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmRemove}
        error={removeError}
      />
    </section>
  );
}
