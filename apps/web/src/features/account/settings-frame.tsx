'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { SettingsNav, type SettingsNavGroup } from '@/components/app/shell/settings-nav';
import { projectPath } from '@/lib/routes/paths';
import { useGuardedPush } from '@/lib/navigation/use-leave-guard';

export const ACCOUNT_SECTIONS = ['profile', 'security', 'preferences'] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

/**
 * Settings (T4, 24-page-templates.md section 6): the page title, the local navigation (200 px, a select
 * below 1024 px) and the 640 px form column. This plan has the "Your account" group only; the project and
 * workspace groups arrive with their settings.
 */
export function SettingsFrame({
  workspace,
  project,
  children,
}: Readonly<{ workspace: string; project: string; children: ReactNode }>): ReactNode {
  const t = useTranslations('settings');
  const pathname = usePathname();
  const push = useGuardedPush();
  const groups: SettingsNavGroup[] = [
    {
      label: t('groups.account'),
      items: ACCOUNT_SECTIONS.map((section) => ({
        id: section,
        label: t(`items.${section}`),
        href: projectPath(workspace, project, `/settings/${section}`),
      })),
    },
  ];
  const current = ACCOUNT_SECTIONS.find((section) => pathname.endsWith(`/settings/${section}`)) ?? 'profile';
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
