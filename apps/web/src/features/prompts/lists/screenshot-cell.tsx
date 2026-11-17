'use client';

import { Image } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { AnswerDialog } from './answer-dialog';
import type { LatestAnswer } from '../facts';
import { Button } from '@/components/ui/button';
import { formatTableDate } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

export interface ScreenshotCellProps {
  /** The newest answer of the platform for the row; its `screenshot_url` is set (a row without one has no button). */
  latest: LatestAnswer & { screenshot_url: string };
  platform: { code: string; name: string };
  promptText: string;
  timeZone: string;
}

/**
 * The Screenshot cell of one platform: an outlined button with the image icon and the day of the latest answer, which
 * opens the answer's dialog. The dialog sits in the cell, so a click inside it never opens the row behind it.
 */
export function ScreenshotCell({ latest, platform, promptText, timeZone }: ScreenshotCellProps): ReactElement {
  const t = useTranslations('prompts.lists.shot');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        className="h-6 px-1.5"
        icon={Image}
        aria-label={t('openLabel', { platform: platform.name, prompt: promptText })}
        aria-haspopup="dialog"
        {...CELL_CONTROL}
        onClick={() => setOpen(true)}
      >
        <span className="num type-body font-normal">{formatTableDate(latest.observed_at, timeZone)}</span>
      </Button>
      <AnswerDialog
        open={open}
        onOpenChange={setOpen}
        platform={platform}
        promptText={promptText}
        observedAt={latest.observed_at}
        screenshotUrl={latest.screenshot_url}
        timeZone={timeZone}
      />
    </>
  );
}
