'use client';

import type { ReactElement } from 'react';

import { useSetupDismissed } from './setup-dismissal';
import { AiSetupChecklist } from '@/features/onboarding';

export interface AiSetupSlotProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
}

/**
 * The setup checklist as the AI Overview shows it, under the header: the onboarding feature's own bar, which offers
 * Dismiss once every step is done, and a dismissal kept for this workspace and project in this browser. The route
 * is where the two features meet: the Overview takes the checklist as a slot and never imports it.
 */
export function AiSetupSlot(props: AiSetupSlotProps): ReactElement | null {
  const { dismissed, dismiss } = useSetupDismissed(props.workspaceId, props.projectId);
  if (dismissed) return null;
  return <AiSetupChecklist {...props} onDismiss={dismiss} />;
}
