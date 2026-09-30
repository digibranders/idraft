import type { ReactNode } from 'react';

/**
 * The T7 Auth page (24-page-templates.md section 11): one column on `background`, no product chrome. The
 * column starts 48 px from the top from 640 px wide, 24 px below that, so a phone keyboard never hides the
 * first field.
 */
export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-4 pt-6 pb-12 sm:pt-12">{children}</main>
  );
}
