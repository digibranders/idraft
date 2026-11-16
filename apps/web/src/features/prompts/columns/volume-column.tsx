import type { GroupVolumeReading, VolumeReading } from '../facts';
import { SORT_ID } from '../prompt-model';
import type { Translate } from '../seams/shared';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE, formatInteger } from '@/lib/format';

/**
 * The preview's width, 132 px. The volume column type stops at 120, which cuts the header "SEARCH VOLUME", so this is a
 * count of the `volumeTrend` type, whose width may be set down to this.
 */
const VOLUME_WIDTH = 132;

type Reading = VolumeReading | GroupVolumeReading;
const isGroup = (reading: Reading): reading is GroupVolumeReading => 'prompts' in reading;

/**
 * Search volume: the monthly searches of the keyword a prompt is linked to, and for a group the sum of its linked
 * keywords, each counted once (`groupVolumeOf`). A row with no linked keyword, or none with a volume yet, says so in
 * the tooltip of an `n/a`, never a 0; it sorts last. `readingOf` gives a prompt's or a group's reading.
 */
export function volumeColumn<TRow>(t: Translate, readingOf: (row: TRow) => Reading): DataTableColumn<TRow> {
  const base = col.volumeTrend<TRow>(
    SORT_ID.volume,
    (row) => {
      const reading = readingOf(row);
      return reading.state === 'ok' ? reading.value : null;
    },
    {
      header: t('prompts.metrics.volume.header'),
      headerTooltip: t('prompts.metrics.volume.tip'),
      priority: 3,
      width: VOLUME_WIDTH,
      minWidth: VOLUME_WIDTH,
      known: (_row, value) => <span className="num">{formatInteger(value)}</span>,
      unknown: (row) => {
        const reading = readingOf(row);
        if (reading.state === 'ok') return { label: EMPTY_VALUE };
        const group = isGroup(reading);
        switch (reading.reason) {
          case 'not_collected':
            return { label: EMPTY_VALUE, tooltip: t('prompts.metrics.notCollectedTip') };
          case 'no_link':
            return {
              label: EMPTY_VALUE,
              tooltip: t(group ? 'prompts.metrics.volume.noLinkGroupTip' : 'prompts.metrics.volume.noLinkTip'),
            };
          case 'no_volume':
            return {
              label: EMPTY_VALUE,
              tooltip: t(group ? 'prompts.metrics.volume.noVolumeGroupTip' : 'prompts.metrics.volume.noVolumeTip'),
            };
        }
      },
    },
  );
  return {
    ...base,
    cellTip: (row) => {
      const reading = readingOf(row);
      if (reading.state !== 'ok') return base.cellTip?.(row);
      if (!isGroup(reading)) {
        return { content: t('prompts.metrics.volume.promptTip', { keyword: reading.keyword }) };
      }
      const content = t('prompts.metrics.volume.groupTip', { keywords: reading.keywords, prompts: reading.prompts });
      return reading.missing === 0
        ? { content }
        : { content, detail: t('prompts.metrics.volume.groupMissingTip', { missing: reading.missing }) };
    },
  };
}
