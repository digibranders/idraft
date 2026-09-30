import { redirect } from 'next/navigation';

import { PREVIEW_SECTIONS } from '@/components/design-system/registry';

export default function DesignSystemIndex(): never {
  const first = PREVIEW_SECTIONS[0];
  if (!first) throw new Error('The design-system preview has no sections');
  redirect(`/design-system/${first.slug}`);
}
