import { Bell, ChevronRight, Globe, Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon, type IconSize } from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';

const ICON_SIZES: readonly [IconSize, string][] = [
  ['xs', '12 px, stroke 1.5'],
  ['sm', '14 px'],
  ['default', '16 px'],
  ['md', '18 px'],
  ['lg', '20 px, stroke 1.5'],
];

export function IconsSection(): ReactNode {
  return (
    <>
      <SpecimenGroup title="Icon" note="07 section 2. Size and stroke are fixed by the wrapper.">
        {ICON_SIZES.map(([size, note]) => (
          <SpecimenRow key={size} label={`${size} (${note})`}>
            <Icon icon={Search} size={size} />
            <Icon icon={Bell} size={size} />
            <Icon icon={Globe} size={size} />
            <Icon icon={ChevronRight} size={size} />
          </SpecimenRow>
        ))}
      </SpecimenGroup>

      <SpecimenGroup title="Icon beside text" note="The icon takes the color of the text and sits on its center line.">
        <SpecimenRow label="body, meta, label">
          <span className="flex items-center gap-1.5 type-body">
            <Icon icon={Globe} /> fynix.digital
          </span>
          <span className="flex items-center gap-1 type-meta">
            <Icon icon={Bell} size="sm" /> 3 alerts
          </span>
          <span className="flex items-center gap-1 type-label">
            <Icon icon={Search} size="xs" /> Search volume
          </span>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Avatar" note="11 section 4. Decorative: the name is always beside it.">
        <SpecimenRow label="md, sm">
          <span className="flex items-center gap-2 type-body">
            <Avatar name="Ana Brandt" /> Ana Brandt
          </span>
          <span className="flex items-center gap-2 type-body">
            <Avatar name="Tomás Rivera" size="sm" /> Tomás Rivera
          </span>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Separator" note="06 section 5.">
        <SpecimenRow label="Horizontal, subtle and default">
          <div className="flex w-64 flex-col gap-3">
            <Separator />
            <Separator tone="default" />
          </div>
        </SpecimenRow>
        <SpecimenRow label="Vertical in a toolbar">
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost">
              Columns
            </Button>
            <Separator orientation="vertical" className="h-6 self-center" />
            <Button size="sm" variant="ghost">
              Export
            </Button>
          </div>
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
