import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound(): ReactNode {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="type-page-title">Page not found</h1>
      <p className="type-body text-foreground-secondary">
        This page does not exist, or you do not have access to it.
      </p>
    </main>
  );
}
