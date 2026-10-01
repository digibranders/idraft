'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { useSignOut } from '@/lib/session/sign-out';
import { AuthCard } from '@/components/app/shell/auth-card';
import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { LinkButton } from '@/components/ui/link-button';
import type { InvitationFailure } from '@/lib/routes/home-notices';
import { NEW_WORKSPACE_PATH, workspacePath } from '@/lib/routes/paths';

export interface HomeScreenProps {
  /** The signed-in person's address, so they can tell which account has no workspace. */
  email: string;
  /** Why the invitation they followed could not be accepted, when they come from one. */
  invitation: InvitationFailure | null;
  /** The first workspace they can open, if any. */
  workspace: { name: string; slug: string } | null;
  /** A platform operator may create a workspace while sign-up is by invitation. */
  canCreateWorkspace: boolean;
}

/**
 * What `/` shows instead of opening a workspace, on the T7 template: that an invitation could not be
 * accepted (with the way on to a workspace the person has), or that they belong to no workspace yet. Both
 * offer signing out, so a person signed in with the wrong account can change it.
 */
export function HomeScreen({ email, invitation, workspace, canCreateWorkspace }: HomeScreenProps): ReactNode {
  const t = useTranslations('session');
  const app = useTranslations('app');
  const { signOut, pending } = useSignOut();
  const [failed, setFailed] = useState(false);
  const leave = (): void => {
    setFailed(false);
    signOut().catch(() => setFailed(true));
  };
  const title = invitation === null ? t('noWorkspace.title') : t('invitation.title');
  const description = invitation === null ? t('noWorkspace.description') : t(`invitation.${invitation}`);

  return (
    <AuthCard productName={app('name')} title={title} description={description}>
      <div className="flex flex-col gap-4">
        {failed ? <FormAlert message={t('signOutFailed')} /> : null}
        {workspace === null ? null : (
          <LinkButton
            variant="primary"
            size="lg"
            className="w-full"
            render={<Link href={workspacePath(workspace.slug)} />}
          >
            {t('invitation.continueTo', { workspace: workspace.name })}
          </LinkButton>
        )}
        {workspace === null && canCreateWorkspace ? (
          <LinkButton variant="primary" size="lg" className="w-full" render={<Link href={NEW_WORKSPACE_PATH} />}>
            {t('noWorkspace.createWorkspace')}
          </LinkButton>
        ) : null}
        <p className="type-body text-foreground-secondary">{t('noWorkspace.signedInAs', { email })}</p>
        <Button
          type="button"
          variant={workspace === null && !canCreateWorkspace ? 'primary' : 'secondary'}
          size="lg"
          className="w-full"
          loading={pending}
          onClick={leave}
        >
          {t('noWorkspace.signOut')}
        </Button>
      </div>
    </AuthCard>
  );
}
