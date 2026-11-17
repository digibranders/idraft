'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactElement } from 'react';

import { DeleteTierDialog, TierFormDialog } from './tier-dialogs';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { workspaceKey } from '@/lib/api/keys';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger } from '@/lib/format';
import { createTierMutation, deleteTierMutation, updateTierMutation } from '@/lib/internal-links/mutations';
import { pageTiersQuery } from '@/lib/internal-links/queries';
import { MAX_TIERS } from '@/lib/internal-links/tiers';
import type { PageTier } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';

type Row = { kind: 'tier'; tier: PageTier } | { kind: 'untiered' };

const rowKey = (row: Row): string => (row.kind === 'tier' ? row.tier.tier_id : 'untiered');

/** A tier being added, or one being renamed. */
type Editing = PageTier | 'new';

/**
 * Workspace settings > Page tiers (spec 5.1). Owners and admins add, rename and delete; everyone else reads. The
 * list has no reorder: the API fixes a tier's position by when it was added, and deleting one closes the codes up.
 */
export function PageTiersScreen({ workspaceId }: { workspaceId: string }): ReactElement {
  const t = useTranslations('pageTiers');
  const common = useTranslations('common');
  const canEdit = useCan('workspace:update');
  const queryClient = useQueryClient();
  const read = useQuery(pageTiersQuery(workspaceId));
  const create = useMutation(createTierMutation);
  const update = useMutation(updateTierMutation);
  const remove = useMutation(deleteTierMutation);
  // Both dialogs keep what they showed while they close, so their words do not empty under the closing fade
  // `serial` remounts a dialog each time it opens, so it starts from the tier it is opened for
  const [form, setForm] = useState<{ target: Editing; open: boolean; serial: number } | null>(null);
  const [removal, setRemoval] = useState<{ shown: PageTier; open: boolean; serial: number } | null>(null);
  const serial = useRef(0);
  const [formFailure, setFormFailure] = useState<string | null>(null);
  const [deleteFailure, setDeleteFailure] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const deleted = useRef(false);
  const tiers = read.data?.data ?? [];
  const full = tiers.length >= MAX_TIERS;
  const path = { workspace_id: workspaceId };
  // The dialog reads the tier from the fresh list, so counts that changed under it (pages tagged by someone else)
  // show and the choice of where they go appears; the copy it opened with is the fallback
  const deleting =
    removal === null ? null : (tiers.find((tier) => tier.tier_id === removal.shown.tier_id) ?? removal.shown);
  // Page counts live in the tier list and in every project's reads, so the whole workspace is read again
  const refresh = (): Promise<void> => queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId) });

  const openForm = (target: Editing): void => {
    setFormFailure(null);
    serial.current += 1;
    setForm({ target, open: true, serial: serial.current });
  };
  const closeForm = (): void => setForm((current) => (current === null ? null : { ...current, open: false }));
  const openDelete = (shown: PageTier): void => {
    setDeleteFailure(null);
    deleted.current = false;
    serial.current += 1;
    setRemoval({ shown, open: true, serial: serial.current });
  };
  const closeDelete = (): void => setRemoval((current) => (current === null ? null : { ...current, open: false }));

  const save = (name: string, description: string): void => {
    const done = (title: string, label: string): void => {
      toast({ type: 'success', title, description: label });
      closeForm();
      void refresh();
    };
    if (form === null) return;
    const editing = form.target;
    if (editing === 'new') {
      create.mutate(
        { params: { path }, body: { name, description } },
        {
          onSuccess: (answer) => done(t('added'), answer.data.label),
          onError: (error) => {
            setFormFailure(isApiProblem(error, 'tier_limit') ? t('limit') : t('saveFailed'));
            // The list was stale if the limit was reached: read it again so Add tier is current
            void refresh();
          },
        },
      );
      return;
    }
    update.mutate(
      { params: { path: { ...path, tier_id: editing.tier_id } }, body: { name, description } },
      {
        onSuccess: (answer) => done(t('saved'), answer.data.label),
        onError: () => setFormFailure(t('saveFailed')),
      },
    );
  };

  const confirmDelete = (moveTo: string | null): void => {
    if (deleting === null) return;
    const label = deleting.label;
    remove.mutate(
      { params: { path: { ...path, tier_id: deleting.tier_id }, query: moveTo === null ? {} : { move_to: moveTo } } },
      {
        onSuccess: () => {
          toast({ type: 'success', title: t('deleted'), description: label });
          // The row and its button are gone: focus goes to the heading of the section
          deleted.current = true;
          closeDelete();
          void refresh();
        },
        onError: (error) => {
          if (isApiProblem(error, 'tier_in_use')) {
            // Pages or rules arrived since the list was read: show the new counts and ask again
            setDeleteFailure(t('inUseNow'));
            void refresh();
            return;
          }
          setDeleteFailure(t('deleteFailed'));
        },
      },
    );
  };

  const rows: Row[] = [...tiers.map((tier): Row => ({ kind: 'tier', tier })), { kind: 'untiered' }];
  const columns: PlainColumn<Row>[] = [
    { id: 'code', header: t('code'), cell: (row) => <TierBadge tier={row.kind === 'tier' ? row.tier : null} /> },
    { id: 'name', header: t('name'), cell: (row) => (row.kind === 'tier' ? row.tier.name : t('untiered')) },
    {
      id: 'description',
      header: t('tierDescription'),
      wrap: true,
      cell: (row) =>
        row.kind === 'untiered' ? (
          <span className="text-foreground-secondary">{t('untieredDescription')}</span>
        ) : row.tier.description === '' ? (
          <span className="text-foreground-tertiary">{t('noDescription')}</span>
        ) : (
          row.tier.description
        ),
    },
    {
      id: 'pages',
      header: t('pages'),
      cell: (row) =>
        row.kind === 'tier' ? (
          formatInteger(row.tier.page_count)
        ) : (
          <span className="type-meta text-foreground-tertiary">{t('notCounted')}</span>
        ),
    },
    {
      id: 'actions',
      header: t('actions'),
      hideHeader: true,
      actions: true,
      cell: (row) =>
        row.kind === 'untiered' ? (
          <span className="type-meta text-foreground-tertiary">{t('always')}</span>
        ) : canEdit ? (
          <span className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('renameName', { label: row.tier.label })}
              onClick={() => openForm(row.tier)}
            >
              {t('rename')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('deleteName', { label: row.tier.label })}
              onClick={() => openDelete(row.tier)}
            >
              {t('delete')}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <section aria-labelledby="page-tiers-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="page-tiers-title" ref={heading} tabIndex={-1} className="type-section-title outline-none">
          {t('title')}
        </h2>
        <p className="type-body text-foreground-secondary">{t('description')}</p>
      </div>
      {read.isError ? (
        <InlineError
          title={t('loadFailed')}
          reason={t('loadFailedReason')}
          errorId={null}
          onRetry={() => void read.refetch()}
          retrying={read.isFetching}
          retryLabel={common('retry')}
        />
      ) : (
        <PlainTable<Row>
          caption={t('caption')}
          rows={rows}
          rowKey={rowKey}
          status={read.isPending ? 'loading' : 'ready'}
          errorState={null}
          emptyText={t('noTiers')}
          columns={columns}
        />
      )}
      {canEdit ? (
        <div className="flex flex-col items-start gap-1">
          <Button variant="secondary" icon={Plus} disabled={full || read.isPending} onClick={() => openForm('new')}>
            {t('add')}
          </Button>
          {full ? <p className="type-meta text-foreground-secondary">{t('addFull')}</p> : null}
        </div>
      ) : (
        <p className="type-meta text-foreground-secondary">{t('readOnly')}</p>
      )}
      <TierFormDialog
        key={form === null ? 'none' : form.serial}
        open={form?.open === true}
        tier={form === null || form.target === 'new' ? null : form.target}
        pending={create.isPending || update.isPending}
        failure={formFailure}
        onClose={closeForm}
        onSave={save}
      />
      <DeleteTierDialog
        key={removal === null ? 'none' : removal.serial}
        open={removal?.open === true}
        tier={deleting}
        tiers={tiers}
        pending={remove.isPending}
        failure={deleteFailure}
        finalFocus={() => (deleted.current && heading.current !== null ? heading.current : true)}
        onClose={closeDelete}
        onDelete={confirmDelete}
      />
    </section>
  );
}
