'use client';

import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useCheckWords } from './check-words';
import { Button } from '@/components/ui/button';
import type { IssueCheck } from '@/lib/issues/types';

export interface CheckViewProps {
  check: IssueCheck;
  /** Back to the list: clears the check from the address. */
  onBack: () => void;
}

/**
 * One open check. Task 3 replaces the body with the bar, the two lines and the table of pages; until then it holds
 * what the page needs to be left again: the name of the check and the way back.
 */
export function CheckView({ check, onBack }: CheckViewProps): ReactElement {
  const t = useTranslations('issues.check');
  const words = useCheckWords();
  return (
    <section className="flex min-h-12 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <Button variant="secondary" size="sm" icon={ChevronLeft} onClick={onBack}>
        {t('back')}
      </Button>
      <h2 className="min-w-0 truncate type-body-strong text-foreground">{words.nameOf(check)}</h2>
    </section>
  );
}
