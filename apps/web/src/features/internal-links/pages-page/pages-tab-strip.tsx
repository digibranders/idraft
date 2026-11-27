'use client';

import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { TabNav } from '@/components/app/shell/tab-nav';
import { livePagesTabs, type PagesTabId } from '@/lib/pages/tabs';
import { pagesTabPath } from '@/lib/routes/paths';

export interface PagesTabStripProps {
  workspaceSlug: string;
  projectSlug: string;
  current: PagesTabId;
  /** Adjusts a tab's address (the Pages screen adds the crawl in view); the plain route when left out. */
  hrefOf?: ((id: PagesTabId, route: Route) => Route) | undefined;
}

/** The tabs of Pages (Overview, All pages, Monitoring), as links to their routes. */
export function PagesTabStrip({ workspaceSlug, projectSlug, current, hrefOf }: PagesTabStripProps): ReactElement {
  const t = useTranslations('pages');
  return (
    <TabNav
      variant="segmented"
      label={t('tabs.label')}
      items={livePagesTabs().map(({ id }) => {
        const route = pagesTabPath(workspaceSlug, projectSlug, id);
        return {
          href: hrefOf === undefined ? route : hrefOf(id, route),
          label: t(`tabs.${id}`),
          current: id === current,
        };
      })}
    />
  );
}
