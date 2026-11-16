import { Layers } from 'lucide-react';
import type { ReactElement } from 'react';

import { EngineMark } from '@/components/app/engine/engine-logo';
import { engineMark } from '@/components/app/engine/marks';
import { Icon } from '@/components/ui/icon';

/**
 * The 16 px mark of a platform, with no name beside it: the Platform select, the column headers and the column chooser
 * show it before a label of their own. Decorative (`alt=""`). A platform without a mark, or the choice of all or of
 * several, gets the layers glyph, so the label never moves.
 */
export function PlatformMark({ code }: { code: string | null }): ReactElement {
  if (code === null || engineMark(code) === null) {
    return <Icon icon={Layers} size="default" className="text-foreground-secondary" />;
  }
  return <EngineMark engine={code} />;
}
