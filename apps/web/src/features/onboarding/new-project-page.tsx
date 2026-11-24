import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { NewProjectForm } from './new-project-form';
import { PageHeader } from '@/components/app/shell/page-header';

/** The new-project page inside the workspace shell: the title and what it covers, then the form with its summary. */
export function NewProjectPage({ workspace }: { workspace: { id: string; slug: string } }): ReactNode {
  const t = useTranslations('onboarding');
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-col gap-2 px-3 pt-5 md:px-4 lg:px-5">
        <PageHeader title={t('title')} />
        <p className="max-w-form type-body text-foreground-secondary">{t('description')}</p>
      </div>
      <NewProjectForm workspaceId={workspace.id} workspaceSlug={workspace.slug} />
    </div>
  );
}
