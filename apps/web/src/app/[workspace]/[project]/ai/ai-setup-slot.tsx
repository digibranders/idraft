'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { useSetupDismissed } from './setup-dismissal';
import { AiSetupChecklist } from '@/features/onboarding';

export interface AiSetupSlotProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId: string;
  projectSlug: string;
  hideWhenComplete?: boolean | undefined;
}

/**
 * The setup checklist as the AI Overview shows it, under the header: the onboarding feature's own bar, which offers
 * Dismiss once every step is done, and a dismissal kept for this workspace and project in this browser. The route
 * is where the two features meet: the Overview takes the checklist as a slot and never imports it.
 */
export function AiSetupSlot({ hideWhenComplete = false, ...props }: AiSetupSlotProps): ReactElement | null {
  const { dismissed, dismiss } = useSetupDismissed(props.workspaceId, props.projectId);
  const [forceShow, setForceShow] = useState(false);

  useEffect(() => {
    const handleShowSetup = (event: Event): void => {
      const customEvent = event as CustomEvent<{ projectId?: string }>;
      if (!customEvent.detail?.projectId || customEvent.detail.projectId === props.projectId) {
        setForceShow(true);
      }
    };
    window.addEventListener('idraft:show-setup-steps', handleShowSetup);
    return () => {
      window.removeEventListener('idraft:show-setup-steps', handleShowSetup);
    };
  }, [props.projectId]);

  if (dismissed && !forceShow) return null;
  return <AiSetupChecklist {...props} forceShow={forceShow || !hideWhenComplete} dense onDismiss={dismiss} />;
}
