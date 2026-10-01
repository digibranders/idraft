'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { SettingsNav, type SettingsNavGroup } from '@/components/app/shell/settings-nav';
import { useGuardedPush } from '@/lib/navigation/use-leave-guard';
import { projectPath, workspaceSettingsPath } from '@/lib/routes/paths';

/**
 * The sections of Settings, by group, in the order of 11-navigation.md section 5. Only the sections that
 * are built are listed: the others arrive with their plans. Every member sees every section; one they may
 * not change is read-only.
 */
const GROUPS = {
  account: ['profile', 'security', 'preferences'],
  project: ['general', 'entities', 'domains', 'taxonomy'],
  workspace: ['workspace', 'members'],
} as const;

export type SettingsSection = (typeof GROUPS)[keyof typeof GROUPS][number];

const SECTIONS: readonly SettingsSection[] = Object.values(GROUPS).flat();

/**
 * Settings (T4, 24-page-templates.md section 6): the page title, the local navigation (200 px, a select
 * below 1024 px) and the 640 px form column. Inside a project every group is listed; outside one (the
 * workspace's own settings routes) the project group is left out and the links stay outside projects.
 */
export function SettingsFrame({
  workspace,
  project,
  children,
}: Readonly<{ workspace: string; project?: string | undefined; children: ReactNode }>): ReactNode {
  const t = useTranslations('settings');
  const pathname = usePathname();
  const push = useGuardedPush();
  const groups: SettingsNavGroup[] = Object.entries(GROUPS)
    .filter(([group]) => project !== undefined || group !== 'project')
    .map(([group, sections]) => ({
      label: t(`groups.${group as keyof typeof GROUPS}`),
      items: sections.map((section) => ({
        id: section,
        label: t(`items.${section}`),
        href:
          project === undefined
            ? workspaceSettingsPath(workspace, section)
            : projectPath(workspace, project, `/settings/${section}`),
      })),
    }));
  // A section's own pages (an entity's editor) keep the section current
  const current =
    SECTIONS.find(
      (section) => pathname.endsWith(`/settings/${section}`) || pathname.includes(`/settings/${section}/`),
    ) ?? 'profile';
  return (
    <div className="flex flex-1 flex-col gap-5 px-3 pt-5 pb-8 md:px-4 lg:px-5">
      <h1 tabIndex={-1} className="type-page-title outline-none">
        {t('title')}
      </h1>
      <div className="flex flex-col gap-x-6 gap-y-5 lg:flex-row lg:items-start">
        <SettingsNav
          label={t('sections')}
          selectLabel={t('section')}
          groups={groups}
          current={current}
          onSelect={(item) => push(item.href)}
        />
        <div className="max-w-form min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
