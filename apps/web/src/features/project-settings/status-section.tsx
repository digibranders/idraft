'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { projectQuery } from './project-query';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { apiMutation } from '@/lib/api/query';
import type { Project } from '@/lib/api/types';
import { workspacePath } from '@/lib/routes/paths';

/**
 * Tracking and the danger zone of Project settings > General (24-page-templates.md T4): pause or resume the
 * project's checks, and archive it. Archiving takes the project out of the list and closes its pages; there
 * is no delete yet (deferred, docs/29 section 1.1).
 */
export function StatusSection({ project, workspaceSlug }: { project: Project; workspaceSlug: string }): ReactNode {
  const t = useTranslations('projectSettings');
  const common = useTranslations('common');
  const router = useRouter();
  const queryClient = useQueryClient();
  // Two mutations, so the pause button does not spin while the project is being archived
  const tracking = useMutation(apiMutation('patch', '/api/v1/workspaces/{workspace_id}/projects/{project_id}'));
  const archiving = useMutation(apiMutation('patch', '/api/v1/workspaces/{workspace_id}/projects/{project_id}'));
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const paused = project.status === 'paused';
  const path = { workspace_id: project.workspace_id, project_id: project.project_id };

  const toggle = (): void => {
    tracking
      .mutateAsync({ params: { path }, body: { status: paused ? 'active' : 'paused' } })
      .then((saved) => {
        queryClient.setQueryData(projectQuery(project).queryKey, { data: saved.data });
        announce(saved.data.status === 'paused' ? t('status.pausedDone') : t('status.resumedDone'));
        router.refresh();
      })
      .catch(() => toast({ type: 'error', title: paused ? t('status.resumeFailed') : t('status.pauseFailed') }));
  };

  const archive = async (): Promise<void> => {
    setArchiveError(null);
    try {
      await archiving.mutateAsync({ params: { path }, body: { status: 'archived' } });
    } catch (error) {
      setArchiveError(t('danger.failed'));
      throw error;
    }
    toast({ type: 'success', title: t('danger.archived', { project: project.name }) });
    // The project's pages close with it, so the person lands on the workspace's list. Unsaved edits of the
    // form above go with the page: archiving was confirmed, and the project cannot be edited any more
    router.replace(workspacePath(workspaceSlug));
  };

  return (
    <>
      <section
        aria-labelledby="project-tracking-title"
        className="flex flex-col gap-3 border-t border-border-subtle pt-5"
      >
        <h3 id="project-tracking-title" className="flex items-center gap-2 type-subsection-title">
          {t('status.title')}
          {paused ? <Badge tone="warning">{t('status.pausedBadge')}</Badge> : null}
        </h3>
        <p className="type-meta">{paused ? t('status.paused') : t('status.active')}</p>
        <Button variant="secondary" className="self-start" loading={tracking.isPending} onClick={toggle}>
          {paused ? t('status.resume') : t('status.pause')}
        </Button>
      </section>
      <section
        aria-labelledby="project-danger-title"
        className="flex flex-col gap-3 border-t border-border-subtle pt-5"
      >
        <h3 id="project-danger-title" className="type-subsection-title">
          {t('danger.title')}
        </h3>
        <p className="type-meta">{t('danger.archiveHint')}</p>
        <Button variant="destructive" className="self-start" onClick={() => setArchiveOpen(true)}>
          {t('danger.archive')}
        </Button>
      </section>
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={(open) => {
          setArchiveOpen(open);
          if (!open) setArchiveError(null);
        }}
        title={t('danger.confirmTitle', { project: project.name })}
        description={t('danger.confirmDescription', { project: project.name })}
        confirmLabel={t('danger.archive')}
        cancelLabel={common('cancel')}
        onConfirm={archive}
        error={archiveError}
      />
    </>
  );
}
