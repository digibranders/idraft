import { CircleCheck, Minus } from 'lucide-react';
import type { ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface PresenceMarkProps {
  present: boolean;
  /** The name and the tooltip when it is there: "Your brand is mentioned in these answers". */
  yes: string;
  /** The same when it is not. */
  no: string;
}

/**
 * Answers "is my brand in this list?" at a glance: a green check when it is, a quiet dash when it is not. The meaning is
 * in the name and the tooltip too, so the color is not the only carrier.
 */
export function PresenceMark({ present, yes, no }: PresenceMarkProps): ReactElement {
  const text = present ? yes : no;
  return (
    <Tooltip content={text} purpose="label">
      <span
        role="img"
        aria-label={text}
        className={cn(
          'flex size-icon shrink-0 items-center justify-center',
          present ? 'text-positive-text' : 'text-foreground-tertiary',
        )}
      >
        <Icon icon={present ? CircleCheck : Minus} size="sm" />
      </span>
    </Tooltip>
  );
}

/** The mark and the list opener side by side, the mark never shrinking. */
export function MarkedList({ mark, children }: { mark: ReactElement; children: ReactElement }): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {mark}
      {children}
    </div>
  );
}
