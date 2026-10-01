'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { SettingsNav, type SettingsNavGroup } from '@/components/app/shell/settings-nav';
import { useGuardedPush } from '@/lib/navigation/use-leave-guard';
import { projectPath, workspaceSettingsPath, type WorkspaceSettingsSection } from '@/lib/routes/paths';

/**
 * The sections of Settings, by group, in the order of 11-navigation.md section 5. Only the sections that
 * are built are listed: the others arrive with their plans. Every member sees every section; one they may
 * not change is read-only.
 */
const ACCOUNT = ['profile', 'security', 'preferences'] as const satisfies readonly WorkspaceSettingsSection[];
const PROJECT = ['general', 'entities', 'domains', 'taxonomy'] as const;
const WORKSPACE = ['workspace', 'members'] as const satisfies readonly WorkspaceSettingsSection[];

export type SettingsSection = (typeof ACCOUNT | typeof PROJECT | typeof WORKSPACE)[number];

const SECTIONS: readonly SettingsSection[] = [...ACCOUNT, ...PROJECT, ...WORKSPACE];

/**
 * Settings (T4, 24-page-templates.md section 6): the page title, the local navigation (200 px, a select
 * below 1024 px) and the 640 px form column. Inside a project every group is listed; outside one (`project`
 * is `null`: the workspace's own settings routes) the project group is left out and the links stay outside
 * projects.
 */
export function SettingsFrame({
  workspace,
  project,
  children,
}: Readonly<{ workspace: string; project: string | null; children: ReactNode }>): ReactNode {
  const t = useTranslations('settings');
  const pathname = usePathname();
  const push = useGuardedPush();
  const group = <Section extends SettingsSection>(
    name: 'account' | 'project' | 'workspace',
    sections: readonly Section[],
    href: (section: Section) => Route,
  ): SettingsNavGroup => ({
    label: t(`groups.${name}`),
    items: sections.map((section) => {
      const id: SettingsSection = section;
      return { id, label: t(`items.${id}`), href: href(section) };
    }),
  });
  let groups: SettingsNavGroup[];
  if (project === null) {
    const outside = (section: WorkspaceSettingsSection): Route => workspaceSettingsPath(workspace, section);
    groups = [group('account', ACCOUNT, outside), group('workspace', WORKSPACE, outside)];
  } else {
    const inside = (section: SettingsSection): Route => projectPath(workspace, project, `/settings/${section}`);
    groups = [
      group('account', ACCOUNT, inside),
      group('project', PROJECT, inside),
      group('workspace', WORKSPACE, inside),
    ];
  }
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
