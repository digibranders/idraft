import { notFound, redirect } from 'next/navigation';

import { PREVIEW_SECTIONS } from '@/components/design-system/registry';
import { publicEnv } from '@/lib/env/public';

export default function DesignSystemIndex(): never {
  // The page repeats the layout's gate: a client navigation can render a page without the layout
  if (publicEnv.NEXT_PUBLIC_APP_ENV === 'production') notFound();
  const first = PREVIEW_SECTIONS[0];
  if (!first) throw new Error('The design-system preview has no sections');
  redirect(`/design-system/${first.slug}`);
}
