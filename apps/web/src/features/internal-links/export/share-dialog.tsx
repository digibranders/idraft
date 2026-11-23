'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { InlineError } from '@/components/app/status/inline-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { expiryDaysValues } from '@/lib/api/schema';
import { copyText } from '@/lib/dom/clipboard';
import { formatTableDate } from '@/lib/format';
import { createShareMutation, revokeShareMutation } from '@/lib/internal-links/mutations';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { sharesQuery } from '@/lib/internal-links/queries';
import type { ExpiryDays, LinksScope, Share, ShareState } from '@/lib/internal-links/types';

const DEFAULT_EXPIRY: ExpiryDays = 30;

/** The address the public page answers at; the token is the only secret in it. */
export const sharedAddress = (token: string): string => `${window.location.origin}/public/internal-links/${token}`;

const STATE_KEY = {
  active: 'stateActive',
  expired: 'stateExpired',
  revoked: 'stateRevoked',
} as const satisfies Record<ShareState, string>;
const STATE_TONE = { active: 'positive', expired: 'neutral', revoked: 'negative' } as const satisfies Record<
  ShareState,
  'positive' | 'neutral' | 'negative'
>;

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinksScope;
  /** Whether the role holds `projects:write`: without it the dialog lists the links and nothing more. */
  canWrite: boolean;
  timeZone: string;
}

interface ShareRowProps {
  share: Share;
  scope: LinksScope;
  canWrite: boolean;
  timeZone: string;
}

/** One link of the list. An active link has a Revoke that asks once, in the row, before it acts. */
function ShareRow({ share, scope, canWrite, timeZone }: ShareRowProps): ReactElement {
  const t = useTranslations('internalLinks.share');
  const queryClient = useQueryClient();
  const revoke = useMutation(revokeShareMutation);
  const [asking, setAsking] = useState(false);
  const created = formatTableDate(share.created_at, timeZone);
  const ending =
    share.state === 'revoked' && share.revoked_at !== null
      ? t('revokedOn', { date: formatTableDate(share.revoked_at, timeZone) })
      : t(share.state === 'expired' ? 'expiredOn' : 'expiresOn', {
          date: formatTableDate(share.expires_at, timeZone),
        });

  const confirm = (): void => {
    revoke.mutate(
      { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId, share_id: share.id } } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: sharesQuery(scope).queryKey });
          toast({ type: 'success', title: t('revoked') });
        },
        onError: (error) => {
          setAsking(false);
          toast({ type: 'error', title: t('revokeFailed'), description: reasonOf(error) || t('revokeFailedReason') });
        },
      },
    );
  };

  let action: ReactElement | null = null;
  if (canWrite && share.state === 'active') {
    action = asking ? (
      <span className="flex shrink-0 items-center gap-2">
        <Button variant="destructive" size="sm" loading={revoke.isPending} onClick={confirm}>
          {t('revokeConfirm')}
        </Button>
        <Button variant="secondary" size="sm" disabled={revoke.isPending} onClick={() => setAsking(false)}>
          {t('revokeKeep')}
        </Button>
      </span>
    ) : (
      <Button
        variant="secondary"
        size="sm"
        aria-label={t('revokeLabel', { date: created })}
        onClick={() => setAsking(true)}
      >
        {t('revoke')}
      </Button>
    );
  }
  return (
    <li className="flex min-h-row flex-col gap-1 py-2">
      <div className="flex items-center gap-3">
        <Badge tone={STATE_TONE[share.state]}>{t(STATE_KEY[share.state])}</Badge>
        <span className="type-body">{t('createdOn', { date: created })}</span>
        <span className="type-meta">{ending}</span>
        <span className="ml-auto">{action}</span>
      </div>
      {asking ? <p className="type-meta">{t('revokeText')}</p> : null}
    </li>
  );
}

/**
 * Share link (spec 7.10): makes a read-only link to the client summary, shows its address once, and lists the
 * project's links with a Revoke for each active one. Every member who reads data sees the list; making and revoking
 * need `projects:write`.
 */
export function ShareDialog({ open, onOpenChange, scope, canWrite, timeZone }: ShareDialogProps): ReactElement {
  const t = useTranslations('internalLinks.share');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const shares = useQuery({ ...sharesQuery(scope), enabled: open });
  const create = useMutation(createShareMutation);
  const [days, setDays] = useState<ExpiryDays>(DEFAULT_EXPIRY);
  const [address, setAddress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    // A new visit starts clean: the secret of an earlier link is never shown again
    if (open) {
      setDays(DEFAULT_EXPIRY);
      setAddress(null);
      setFailure(null);
    }
  }

  const make = (): void => {
    if (create.isPending) return;
    setFailure(null);
    create.mutate(
      {
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: { expires_in_days: days },
      },
      {
        onSuccess: (answer) => {
          setAddress(sharedAddress(answer.data.token));
          void queryClient.invalidateQueries({ queryKey: sharesQuery(scope).queryKey });
        },
        onError: (error) => setFailure(reasonOf(error) || t('createFailedReason')),
      },
    );
  };

  const copy = (): void => {
    if (address === null) return;
    void copyText(address).then((copied) =>
      toast(copied ? { type: 'success', title: t('copied') } : { type: 'error', title: common('copy.failed') }),
    );
  };

  let list: ReactElement;
  if (shares.isError) {
    list = (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void shares.refetch()}
        retrying={shares.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (shares.data === undefined) {
    list = (
      <div className="flex flex-col gap-2" role="status" aria-label={t('loading')}>
        <Skeleton shape="block" height="row" />
        <Skeleton shape="block" height="row" />
      </div>
    );
  } else if (shares.data.data.length === 0) {
    list = <p className="type-body text-foreground-secondary">{t('empty')}</p>;
  } else {
    list = (
      <ul className="flex flex-col divide-y divide-border-subtle">
        {shares.data.data.map((share) => (
          <ShareRow key={share.id} share={share} scope={scope} canWrite={canWrite} timeZone={timeZone} />
        ))}
      </ul>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md">
      <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        {canWrite ? (
          <div className="flex flex-col gap-4">
            <Field width="medium">
              <FieldLabel>{t('expiryLabel')}</FieldLabel>
              <Select
                value={String(days)}
                onValueChange={(next) => setDays(expiryDaysValues.find((value) => String(value) === next) ?? days)}
                placeholder={t('expiryLabel')}
                options={expiryDaysValues.map((value) => ({
                  value: String(value),
                  label: t('expiryOption', { days: value }),
                }))}
              />
            </Field>
            {address === null ? null : (
              <div className="flex flex-col gap-2" role="status">
                <ReadOnlyList>
                  <ReadOnlyField label={t('addressLabel')} value={address} font="mono" reason={t('createdNote')} />
                </ReadOnlyList>
                <div>
                  <Button variant="secondary" size="sm" icon={Copy} onClick={copy}>
                    {t('copy')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="type-meta">{t('needsRole')}</p>
        )}
        <div className="flex flex-col gap-2">
          <h3 className="type-subsection-title">{t('listHeading')}</h3>
          {list}
        </div>
      </DialogBody>
      <DialogFooter
        primary={
          canWrite ? (
            <Button variant="primary" loading={create.isPending} onClick={make}>
              {t('create')}
            </Button>
          ) : (
            <DialogClose>
              <Button variant="secondary">{common('close')}</Button>
            </DialogClose>
          )
        }
        secondary={
          canWrite ? (
            <DialogClose>
              <Button variant="secondary">{common('close')}</Button>
            </DialogClose>
          ) : undefined
        }
      />
    </Dialog>
  );
}
