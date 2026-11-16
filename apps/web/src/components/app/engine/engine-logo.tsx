import type { ReactElement } from 'react';

import { engineMark } from './marks';
import { Truncate } from '@/components/ui/truncate';
import { cn } from '@/lib/utils';

export interface EngineLogoProps {
  /** The API engine code, such as `chatgpt_web`. */
  engine: string;
  /** The engine's name, the API's `engine.label`. It is always shown: the mark is never alone. */
  name: string;
  /** Turns the mark off in one place (ADR-DS-020 rule 6): the name alone. */
  hidden?: boolean | undefined;
  /** Ends the name in an ellipsis when the row is too narrow. */
  truncate?: boolean | undefined;
}

/**
 * The vendor's 16 px mark immediately left of the engine's name (07-icons.md section 5). The mark is decorative
 * (`alt=""`) because the name beside it is the label, and no export of this folder renders a mark without it.
 * An engine without a mark, or `hidden`, shows the name alone.
 */
export function EngineLogo({ engine, name, hidden = false, truncate = false }: EngineLogoProps): ReactElement {
  const label = truncate ? <Truncate text={name} /> : name;
  const mark = hidden ? null : <EngineMark engine={engine} />;
  if (mark === null || engineMark(engine) === null)
    return <span className="inline-flex min-w-0 items-center">{label}</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      {mark}
      {label}
    </span>
  );
}

/**
 * The vendor's 16 px mark alone, for a place that names the engine by other means (an option of a select, whose label
 * is the name). Decorative (`alt=""`); an engine without a mark draws nothing.
 */
export function EngineMark({ engine }: { engine: string }): ReactElement | null {
  const mark = engineMark(engine);
  if (mark === null) return null;
  return (
    <>
      {/* A fixed box, so a row never shifts while the mark loads. A 16 px static SVG has nothing for next/image to optimize */}
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={mark.src}
        alt=""
        width={16}
        height={16}
        className={cn('size-icon shrink-0', mark.followsText && 'dark:invert')}
      />
    </>
  );
}
