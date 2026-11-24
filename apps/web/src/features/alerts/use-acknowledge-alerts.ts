'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ACKNOWLEDGE_ALERTS, refreshEvents, type AlertScope } from './alert-queries';
import { toast } from '@/components/ui/toast';

export interface AcknowledgeAlerts {
  /** True while a call is out; a second one is ignored until it ends. */
  busy: boolean;
  /** Acknowledges these alerts with one call, tells the member how it went and reads the alerts again. */
  send: (ids: readonly string[]) => Promise<void>;
}

/** Acknowledging alerts, shared by the Recent alerts table and the notification bell. */
export function useAcknowledgeAlerts(scope: AlertScope): AcknowledgeAlerts {
  const t = useTranslations('alerts.recent');
  const queryClient = useQueryClient();
  const acknowledge = useMutation(ACKNOWLEDGE_ALERTS);
  const [busy, setBusy] = useState(false);

  const send = async (ids: readonly string[]): Promise<void> => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    try {
      const done = await acknowledge.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: { ids: [...ids] },
      });
      toast({ type: 'success', title: t('acknowledgedDone', { count: done.data.acknowledged }) });
    } catch {
      toast({ type: 'error', title: t('acknowledgeFailed') });
    } finally {
      setBusy(false);
      void refreshEvents(queryClient, scope);
    }
  };
  return { busy, send };
}
