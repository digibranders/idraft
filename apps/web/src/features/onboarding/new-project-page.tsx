import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { NewProjectForm } from './new-project-form';
import { PageHeader } from '@/components/app/shell/page-header';

/** The new-project page inside the workspace's top bar: the title, what this step covers, and the form. */
export function NewProjectPage({ workspace }: { workspace: { id: string; slug: string } }): ReactNode {
  const t = useTranslations('onboarding');
  return (
    <div className="flex w-full flex-col gap-5 px-3 pt-5 pb-8 md:px-4 lg:px-5">
      <PageHeader title={t('title')} />
      <div className="flex max-w-form flex-col gap-5">
        <p className="type-body text-foreground-secondary">{t('description')}</p>
        <NewProjectForm workspaceId={workspace.id} workspaceSlug={workspace.slug} />
      </div>
    </div>
  );
}
