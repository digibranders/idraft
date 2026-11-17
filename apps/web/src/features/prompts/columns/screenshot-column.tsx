import type { ReactElement } from 'react';

import type { FactsRow, LatestAnswer } from '../facts';
import { engineOf } from '../facts/engine-rows';
import { ScreenshotCell } from '../lists/screenshot-cell';
import { PlatformMark } from '../platform-mark';
import type { Translate } from '../seams/shared';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE } from '@/lib/format';

/** The column's width in the preview: the image icon and a short date. */
export const SCREENSHOT_WIDTH = 120;

export interface ScreenshotColumnOptions<TRow> {
  id?: string;
  /** The row's own summary row; `undefined` when the summary has none for it (with `loaded` it has no answers). */
  rowOf: (row: TRow) => FactsRow | undefined;
  /** The text the dialog names the prompt with, and the cell button's name. */
  promptTextOf: (row: TRow) => string;
  loaded: boolean;
  /** The one platform in view and its name. */
  platform: { code: string; name: string };
  timeZone: string;
  t: Translate;
}

type Shown =
  { kind: 'button'; latest: LatestAnswer & { screenshot_url: string } } | { kind: 'text'; text: string; tip: string };

/**
 * What a row's cell shows. `latest` absent is a backend that does not send it (`n/a`, not collected yet); `null` or no
 * row is no answer in the period; an answer with no stored image has nothing to open, which is `n/a` too, never an
 * invented picture.
 */
function shownOf<TRow>(row: TRow, options: ScreenshotColumnOptions<TRow>): Shown {
  const { t, loaded, platform } = options;
  const unknown = (key: 'notCollectedTip' | 'shot.notCollectedTip'): Shown => ({
    kind: 'text',
    text: EMPTY_VALUE,
    tip: t(`prompts.lists.${key}`),
  });
  const found = options.rowOf(row);
  if (found === undefined) {
    return loaded
      ? { kind: 'text', text: t('prompts.lists.shot.noAnswer'), tip: t('prompts.lists.shot.noAnswerTip') }
      : unknown('notCollectedTip');
  }
  const latest = engineOf(found, platform.code)?.latest;
  if (latest === undefined) {
    return engineOf(found, platform.code) === undefined
      ? { kind: 'text', text: t('prompts.lists.shot.noAnswer'), tip: t('prompts.lists.shot.noAnswerTip') }
      : unknown('notCollectedTip');
  }
  if (latest === null) {
    return { kind: 'text', text: t('prompts.lists.shot.noAnswer'), tip: t('prompts.lists.shot.noAnswerTip') };
  }
  return latest.screenshot_url === null
    ? unknown('shot.notCollectedTip')
    : { kind: 'button', latest: { ...latest, screenshot_url: latest.screenshot_url } };
}

/**
 * The Screenshot column of one platform, generic over the row: the day of the platform's latest answer on a button that
 * opens the stored image. A plain column (no order), 120 px, with the platform's mark in its header. It exists only while
 * one platform is in view.
 */
export function screenshotColumn<TRow>(options: ScreenshotColumnOptions<TRow>): DataTableColumn<TRow> {
  const { t, platform, promptTextOf, timeZone } = options;
  return col.aiOverview<TRow>(options.id ?? 'screenshot', () => null, {
    header: t('prompts.lists.columns.screenshot'),
    headerTooltip: t('prompts.lists.headers.screenshotTip'),
    headerIcon: <PlatformMark code={platform.code} />,
    width: SCREENSHOT_WIDTH,
    // The header with the platform mark and the button with the day need this much
    minWidth: SCREENSHOT_WIDTH,
    sortable: false,
    hasControls: true,
    cell: (row): ReactElement => {
      const shown = shownOf(row, options);
      return shown.kind === 'text' ? (
        <span className="text-foreground-tertiary">{shown.text}</span>
      ) : (
        <ScreenshotCell latest={shown.latest} platform={platform} promptText={promptTextOf(row)} timeZone={timeZone} />
      );
    },
    cellTip: (row) => {
      const shown = shownOf(row, options);
      return shown.kind === 'text' ? { content: shown.tip } : undefined;
    },
  });
}
