import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { LayoutsCustomizeLive } from '@/features/layouts/customize-specimen';
import { LayoutsLive } from '@/features/layouts/live-specimen';
import { publicEnv } from '@/lib/env/public';

const IS_PRODUCTION = publicEnv.NEXT_PUBLIC_APP_ENV === 'production';

// In production the page is a 404, and its title must not say that it exists
export const metadata: Metadata = IS_PRODUCTION ? {} : { title: 'Layouts, live' };

/**
 * The layout screens of WP-15 on the real provider and the mock API. It is a page of its own, next to the
 * registered sections, because it fetches and a section of the preview may not. It does not exist in production.
 */
export default function LayoutsLivePage(): ReactNode {
  // The page repeats the layout's gate: a client navigation can render a page without the layout
  if (IS_PRODUCTION) notFound();
  return (
    <>
      <h1 className="type-page-title">Layouts, live</h1>
      <LayoutsLive />
      <LayoutsCustomizeLive />
    </>
  );
}
