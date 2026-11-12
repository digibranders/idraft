'use client';

import { Download, ImageDown, Link2, MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { csvBlob, downloadBlob, type CsvTable } from '@/lib/csv/csv-write';
import { copyText } from '@/lib/dom/clipboard';

export interface ChartMenuAction {
  /** Draws the chart image; the menu downloads it. */
  png?: (() => Promise<Blob>) | undefined;
  csv?: (() => CsvTable) | undefined;
  /** An absolute address that opens this view. */
  link?: string | undefined;
}

export interface ChartMenuProps {
  title: string;
  /** File name without extension. */
  fileName: string;
  actions: ChartMenuAction;
}

/**
 * The chart's overflow menu (15-data-visualization.md section 11): Download PNG, Download CSV, Copy link,
 * each only when the chart offers it. Renders nothing when it offers none.
 */
export function ChartMenu({ title, fileName, actions }: ChartMenuProps): ReactElement | null {
  const t = useTranslations('chart');
  const { png, csv, link } = actions;
  const items: MenuItemDef[] = [
    ...(png === undefined
      ? []
      : [
          {
            id: 'png',
            label: t('menu.png'),
            icon: ImageDown,
            onSelect: () => {
              png()
                .then((blob) => downloadBlob(blob, `${fileName}.png`))
                .catch(() => toast({ type: 'error', title: t('menu.pngFailed') }));
            },
          },
        ]),
    ...(csv === undefined
      ? []
      : [
          {
            id: 'csv',
            label: t('menu.csv'),
            icon: Download,
            onSelect: () => downloadBlob(csvBlob(csv()), `${fileName}.csv`),
          },
        ]),
    ...(link === undefined
      ? []
      : [
          {
            id: 'link',
            label: t('menu.link'),
            icon: Link2,
            onSelect: () => {
              void copyText(link).then((copied) => {
                if (copied) announce(t('menu.linkCopied'));
                else toast({ type: 'error', title: t('menu.copyFailed') });
              });
            },
          },
        ]),
  ];
  if (items.length === 0) return null;
  return (
    <Menu
      align="end"
      items={items}
      trigger={<IconButton icon={MoreHorizontal} size="icon-sm" label={t('more', { title })} />}
    />
  );
}
