import type { ReactNode } from 'react';

import { SharedSummary } from '@/features/internal-links/export/shared-summary';

export default async function SharedSummaryPage({ params }: { params: Promise<{ token: string }> }): Promise<ReactNode> {
  const { token } = await params;
  return <SharedSummary token={token} />;
}
