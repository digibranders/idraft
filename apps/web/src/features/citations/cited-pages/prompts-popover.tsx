'use client';

import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { Popover } from '@/components/ui/popover';
import { Truncate } from '@/components/ui/truncate';
import type { CitedPageRow } from '@/lib/citations/board-queries';

/** The prompts a popover lists (C 428). */
export const POPOVER_PROMPTS = 10;

export interface PromptsPopoverProps {
  row: CitedPageRow;
  /** The row's "+N" or "Details" chip. */
  chip: ReactElement;
  /** Opens the page drawer, which starts on its Prompts tab (C 437 to 440). */
  onDetails: () => void;
}

/** The prompts a page is cited for, top ten (C 416 to 444): head, ordered list, and the way to the page drawer. */
export function PromptsPopover({ row, chip, onDetails }: PromptsPopoverProps): ReactElement {
  const t = useTranslations('citations.promptsPopover');
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={chip}
      aria-label={t('label', { path: row.path })}
      width="wide"
      padding="none"
      align="start"
      footer={
        <div className="w-full px-3 py-2">
          <button
            type="button"
            className="rounded-sm type-body text-link outline-none hover:underline focus-visible:focus-ring"
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
          >
            {row.prompts > POPOVER_PROMPTS ? t('showAll', { count: row.prompts }) : t('details')}
          </button>
        </div>
      }
    >
      <div className="flex items-baseline gap-2 border-b border-border-subtle px-3 pt-3 pb-2">
        <span className="type-subsection-title">{t('head')}</span>
        <span className="num type-meta">{t('meta', { prompts: row.prompts, citations: row.citations })}</span>
      </div>
      <ol className="max-h-80 overflow-y-auto py-1">
        {row.top_prompts.slice(0, POPOVER_PROMPTS).map((prompt) => (
          <li key={prompt.prompt_id} className="flex min-h-8 items-center gap-3 px-3 py-1">
            <Truncate text={prompt.text} className="min-w-0 flex-1 type-body text-foreground" />
            <span className="shrink-0 num type-meta">{t('count', { count: prompt.citations })}</span>
          </li>
        ))}
      </ol>
    </Popover>
  );
}
