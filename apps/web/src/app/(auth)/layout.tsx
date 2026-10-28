import type { ReactNode } from 'react';

import { AuthShowcase } from '@/features/auth/auth-showcase';

/**
 * The auth shell. Approved departure from T7 (24-page-templates.md section 11), which has one centred card:
 * from 1024 px a brand panel fills the left 5/12 and the form column sits on the right; below it the panel is
 * a compact band above the form. The form column starts 48 px from the top from 640 px wide, 24 px below that,
 * so a phone keyboard never hides the first field.
 */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <div className="flex min-h-dvh flex-col bg-background lg:flex-row">
      <AuthShowcase />
      <main className="flex flex-1 flex-col items-center px-4 pt-6 pb-12 sm:pt-12 lg:justify-center lg:pt-12">
        {children}
      </main>
    </div>
  );
}
