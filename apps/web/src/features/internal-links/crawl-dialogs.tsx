'use client';

import { ListFilter, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement, type ReactNode } from 'react';

import { ShareDialog } from './export/share-dialog';
import { ImportDialog } from './rules/import-dialog';
import { RulesDialog } from './rules/rules-dialog';
import { Button } from '@/components/ui/button';
import type { MenuItemDef } from '@/components/ui/menu';
import type { LinksScope, PageTier } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';

export type CrawlDialogId = 'rules' | 'import' | 'alerts' | 'share';

export interface CrawlDialogActions {
  canWrite: boolean;
  dialog: CrawlDialogId | null;
  setDialog: (next: CrawlDialogId | null) => void;
  /** Tier rules, and Import tiers from CSV for a member who may write: the More menu entries. */
  items: MenuItemDef[];
  /** The same two as buttons, for a first crawl that is still under way. */
  buttons: ReactNode;
}

/**
 * The tier actions both crawl screens carry (Internal links and Pages). Anyone who reads the project reads the
 * rules; only a member who may write sets them or imports tiers.
 */
export function useCrawlDialogs(): CrawlDialogActions {
  const t = useTranslations('internalLinks');
  const canWrite = useCan('projects:write');
  const [dialog, setDialog] = useState<CrawlDialogId | null>(null);
  const items: MenuItemDef[] = [
    { id: 'rules', label: t('rules.open'), icon: ListFilter, onSelect: () => setDialog('rules') },
    ...(canWrite ? [{ id: 'import', label: t('csv.open'), icon: Upload, onSelect: () => setDialog('import') }] : []),
  ];
  const buttons = canWrite ? (
    <>
      <Button variant="secondary" size="sm" onClick={() => setDialog('rules')}>
        {t('rules.setUp')}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setDialog('import')}>
        {t('csv.open')}
      </Button>
    </>
  ) : undefined;
  return { canWrite, dialog, setDialog, items, buttons };
}

export interface CrawlDialogsProps {
  actions: CrawlDialogActions;
  scope: LinksScope;
  host: string;
  tiers: readonly PageTier[];
  timeZone: string;
}

/** The Tier rules, Share link and Import tiers dialogs that `useCrawlDialogs` opens. */
export function CrawlDialogs({ actions, scope, host, tiers, timeZone }: CrawlDialogsProps): ReactElement {
  const { canWrite, dialog, setDialog } = actions;
  return (
    <>
      <RulesDialog
        open={dialog === 'rules'}
        onOpenChange={(next) => setDialog(next ? 'rules' : null)}
        scope={scope}
        host={host}
        tiers={tiers}
        canWrite={canWrite}
      />
      <ShareDialog
        open={dialog === 'share'}
        onOpenChange={(next) => setDialog(next ? 'share' : null)}
        scope={scope}
        canWrite={canWrite}
        timeZone={timeZone}
      />
      {canWrite ? (
        <ImportDialog
          open={dialog === 'import'}
          onOpenChange={(next) => setDialog(next ? 'import' : null)}
          scope={scope}
          tiers={tiers}
        />
      ) : null}
    </>
  );
}
