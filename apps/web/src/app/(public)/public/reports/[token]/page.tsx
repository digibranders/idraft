import type { ReactNode } from 'react';

import { GuestReport } from '@/features/reports';

export default async function GuestReportPage({ params }: { params: Promise<{ token: string }> }): Promise<ReactNode> {
  const { token } = await params;
  return <GuestReport token={token} />;
}
