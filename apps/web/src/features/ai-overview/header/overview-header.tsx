'use client';

import { Link2, ListChecks, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { ExportMenu } from '../export/export-menu';
import { useOverview } from '../overview-context';
import { BrandedFilter, PAGE_CONTROLS } from '../scope/branded-filter';
import { CustomizeShortcut } from './customize-shortcut';
import { OverviewFreshness } from './overview-freshness';
import { PageToolbar } from '@/components/app/page-toolbar';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { CustomizeButton, CustomizingBadge, useLayoutScreen } from '@/features/layouts';
import { copyText } from '@/lib/dom/clipboard';
import { useMediaQuery } from '@/lib/dom/use-media-query';

/** The id of the More actions item that copies the link. */
const COPY_LINK = 'copy-link';
const SHOW_SETUP = 'show-setup';

export interface OverviewHeaderProps {
  stats?: ReactNode | undefined;
  filters?: ReactNode | undefined;
  noticeChip?: ReactNode | undefined;
  setupSlot?: ReactNode | undefined;
}

/**
 * Sticky under the top bar from 1920 px, so the scope can be changed from any card (preview commit 1363ff90). It is one
 * row (52 px) only there. Measured in the real app: 96 px at 1680, 1440, 1280 and 1024 px (selects, then Branded, the
 * actions and the freshness wrap onto a second row) and 140 px at 768 px, too much of a screen to keep in view, so
 * below 1920 px the toolbar scrolls away with the page. The negative margins and the equal padding make it sit where
 * it would without them (8 px; the preview has 10).
 */
const TOOLBAR_CLASS =
  'bg-background -mx-3 -my-2 px-3 py-2 md:-mx-4 md:px-4 lg:-mx-5 lg:px-5 min-[120rem]:sticky min-[120rem]:top-topbar min-[120rem]:z-(--z-sticky)';

/**
 * The toolbar of the AI Overview page: the scope selects, then Branded, the freshness text, the Customize toggle, Export
 * and More actions, wrapping as the width asks. The setup checklist and the numbers strip follow it and scroll under it.
 */
export function OverviewHeader({ stats, filters, noticeChip, setupSlot }: OverviewHeaderProps = {}): ReactElement {
  const t = useTranslations('aiOverview');
  const tShell = useTranslations('aiOverview.shell');
  const common = useTranslations('common');
  const { engines, project } = useOverview();
  const { mode } = useLayoutScreen();
  const onPage = useMediaQuery(PAGE_CONTROLS);

  const copyLink = (): void => {
    void copyText(window.location.href).then((copied) =>
      toast(copied ? { type: 'success', title: t('linkCopied') } : { type: 'error', title: common('copy.failed') }),
    );
  };

  const handleShowSetup = (): void => {
    window.dispatchEvent(
      new CustomEvent('idraft:show-setup-steps', {
        detail: { projectId: project.id },
      }),
    );
  };

  return (
    <>
      <section aria-label={tShell('toolbar')} className={TOOLBAR_CLASS}>
        <PageToolbar
          title={t('title')}
          filters={filters}
          status={
            <>
              {noticeChip}
              <OverviewFreshness place="toolbar" />
              {mode === 'customize' ? <CustomizingBadge /> : null}
            </>
          }
          actions={
            <>
              {onPage ? <BrandedFilter /> : null}
              {engines.status === 'loading' ? (
                <span
                  aria-hidden="true"
                  className="hidden h-control-sm w-28 animate-skeleton-pulse rounded-md bg-surface-subtle md:block"
                />
              ) : (
                <CustomizeButton />
              )}
              <CustomizeShortcut />
              <ExportMenu />
              <Menu
                align="end"
                trigger={<IconButton icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
                items={[
                  { id: COPY_LINK, label: t('copyLink'), icon: Link2, onSelect: copyLink },
                  { id: SHOW_SETUP, label: t('showSetupSteps'), icon: ListChecks, onSelect: handleShowSetup },
                ]}
              />
            </>
          }
        />
      </section>
      {setupSlot}
      {stats === undefined || stats === null ? null : (
        <div
          className="scrollbar-none flex h-control-sm max-w-full min-w-0 items-center overflow-x-auto"
          style={{ contain: 'paint' }}
        >
          {stats}
        </div>
      )}
    </>
  );
}
