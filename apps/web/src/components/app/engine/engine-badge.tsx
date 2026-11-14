import type { ReactElement } from 'react';

import { EngineLogo } from './engine-logo';
import { Badge } from '@/components/ui/badge';

export interface EngineBadgeProps {
  /** The API engine code, such as `gemini_web`. */
  engine: string;
  /** The engine's name, the API's `engine.label`. */
  name: string;
  /** Adds the engine's mark beside the name. Off by default, for dense tables. */
  logo?: boolean | undefined;
}

/**
 * The engine's name as a neutral subtle badge, with its mark when `logo` is set. No brand colours. `Badge` takes
 * a string only, so the logo form repeats its neutral subtle classes around `EngineLogo`: keep the two in step.
 */
export function EngineBadge({ engine, name, logo = false }: EngineBadgeProps): ReactElement {
  if (!logo) return <Badge>{name}</Badge>;
  return (
    <span
      data-slot="badge"
      className="inline-flex h-badge shrink-0 items-center rounded-sm border border-neutral-border bg-neutral-subtle px-2 type-micro whitespace-nowrap text-neutral-text group-aria-selected:bg-surface"
    >
      <EngineLogo engine={engine} name={name} />
    </span>
  );
}
