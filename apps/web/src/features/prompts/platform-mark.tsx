import { Layers } from 'lucide-react';
import type { ReactElement } from 'react';

import { engineMark } from '@/components/app/engine/marks';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

/**
 * The 16 px mark of a platform, with no name beside it: the Platform select shows it before its label, where the
 * label is the option's own text. Decorative (`alt=""`). A platform without a mark, or the choice of all or of
 * several, gets the layers glyph, so the label never moves.
 */
export function PlatformMark({ code }: { code: string | null }): ReactElement {
  const mark = code === null ? null : engineMark(code);
  if (mark === null) return <Icon icon={Layers} size="default" className="text-foreground-secondary" />;
  return (
    // A fixed box, so a row never shifts while the mark loads. A 16 px static SVG has nothing for next/image to optimize
    // eslint-disable-next-line @next/next/no-img-element -- see above
    <img
      src={mark.src}
      alt=""
      width={16}
      height={16}
      className={cn('size-icon shrink-0', mark.followsText && 'dark:invert')}
    />
  );
}
