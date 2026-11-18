import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

const MARK = 'rounded-sm bg-primary-subtle px-0.5 type-body-strong text-foreground';

/** The context sentence with the phrase marked; the phrase is found without regard to case (mock `mention`). */
export function MentionText({
  context,
  phrase,
  className,
}: {
  context: string;
  phrase: string;
  className?: string | undefined;
}): ReactElement {
  const at = context.toLowerCase().indexOf(phrase.toLowerCase());
  const paragraph = cn('type-meta text-foreground-secondary', className);
  if (at < 0) {
    return (
      <p className={paragraph}>
        <span data-mention="" className={MARK}>
          {phrase}
        </span>{' '}
        {context}
      </p>
    );
  }
  const end = at + phrase.length;
  return (
    <p className={paragraph}>
      {context.slice(0, at)}
      <span data-mention="" className={MARK}>
        {context.slice(at, end)}
      </span>
      {context.slice(end)}
    </p>
  );
}
