import { Settings } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ButtonSpecimens } from './button-specimens';
import { SpecimenGroup, SpecimenRow } from './specimen';
import { Kbd } from '@/components/ui/kbd';
import { LinkButton } from '@/components/ui/link-button';
import { TextLink } from '@/components/ui/text-link';

/**
 * A Server Component on purpose: the link button and the text link below are rendered here without a
 * client boundary, which is how pages use them. The interactive examples are in ButtonSpecimens.
 */
export function ButtonsSection(): ReactNode {
  return (
    <>
      <ButtonSpecimens />

      <SpecimenGroup
        title="Link button"
        note="09 section 2.7. Navigates, so it stays a link. Rendered by a Server Component."
      >
        <SpecimenRow label="primary, sm with icon">
          <LinkButton variant="primary" render={<Link href="/design-system/forms" />}>
            Open project
          </LinkButton>
          <LinkButton size="sm" icon={Settings} render={<Link href="/design-system/forms" />}>
            Settings
          </LinkButton>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="Text link"
        note="Underlined at rest in a sentence; on hover and focus when it stands alone."
      >
        <SpecimenRow label="inline, standalone, inherit">
          <p className="type-body">
            Rates use the{' '}
            <TextLink href="/design-system/typography" variant="inline">
              Wilson interval
            </TextLink>
            .
          </p>
          <TextLink href="/design-system/badges" className="type-body">
            View all 20 competitors
          </TextLink>
          <p className="type-meta">
            <TextLink href="/design-system/tokens" tone="inherit">
              All projects
            </TextLink>
          </p>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Kbd" note="09 section 11. Glyphs on a Mac, words elsewhere.">
        <SpecimenRow label="Combination, single key">
          <Kbd keys={['mod', 'k']} />
          <Kbd keys={['shift', 'f10']} />
          <Kbd keys={['/']} />
          <Kbd keys={['esc']} />
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
