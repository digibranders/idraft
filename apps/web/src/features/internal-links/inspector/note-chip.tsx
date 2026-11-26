'use client';

import { FileText, Hash, TriangleAlert, User, type LucideIcon } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import type { MentionType, NoteMention } from '@/lib/pages/note-mentions';
import { cn } from '@/lib/utils';

export interface NoteChipProps {
  mention: NoteMention;
  /** Opens the page of a page chip in the drawer, by its url id. */
  onOpenPage: (urlId: string) => void;
  /** The route of a check on the Issues page, or `null` while that page is not there (the chip is then plain). */
  issueHref: (checkId: string) => Route | null;
}

const CHIP_ICON: Readonly<Record<MentionType, LucideIcon>> = {
  page: FileText,
  user: User,
  issue: TriangleAlert,
  keyword: Hash,
};

// One line of the note's height: the label truncates, the full words are in the accessible name or in hidden text
const CHIP = cn(
  'inline-flex max-w-full items-center gap-1 rounded-sm bg-primary-subtle px-1.5 align-bottom type-body text-primary-text',
);
const ACTION = cn('cursor-pointer hover:underline focus-visible:focus-ring');

/**
 * One mention of a saved note (spec 9.8.3). A page chip is a button that opens the page, named by the page's current
 * path; an issue chip is a link to the check when the Issues page is there. User and keyword chips only state what
 * they are. The label is only ever drawn as text.
 */
export function NoteChip({ mention, onOpenPage, issueHref }: NoteChipProps): ReactElement {
  const t = useTranslations('pages.drawer.notes.chips');
  // The label keeps its at sign in the stored text and the body; the chip drops it, as the icon says the same
  const label = mention.label.replace(/^@/, '');
  const inner = (
    <>
      <Icon icon={CHIP_ICON[mention.type]} size="xs" />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  if (mention.type === 'page') {
    return (
      <button
        type="button"
        aria-label={t('openPage', { path: mention.path ?? label })}
        className={cn(CHIP, ACTION)}
        onClick={() => onOpenPage(mention.target)}
      >
        {inner}
      </button>
    );
  }
  if (mention.type === 'issue') {
    const href = issueHref(mention.target);
    if (href !== null) {
      return (
        <Link href={href} aria-label={t('openIssue')} className={cn(CHIP, ACTION)}>
          {inner}
        </Link>
      );
    }
    return <span className={CHIP}>{inner}</span>;
  }
  // Plain chips: the words that say what they are are hidden text beside the label the eye reads
  const words = mention.type === 'user' ? t('user', { name: label }) : t('keyword', { keyword: mention.target });
  return (
    <span className={CHIP}>
      <Icon icon={CHIP_ICON[mention.type]} size="xs" />
      <span aria-hidden="true" className="min-w-0 truncate">
        {label}
      </span>
      <span className="sr-only">{words}</span>
    </span>
  );
}
