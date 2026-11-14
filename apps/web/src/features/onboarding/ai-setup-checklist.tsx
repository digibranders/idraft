'use client';

import { CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { SetupChecklist, SetupFrame } from './setup-checklist';
import { continueHref, setupProgress, type SetupStep } from './setup-steps';
import { aiSetupHrefs, useAiSetupSteps, type AiSetupScope } from './use-ai-setup-steps';
import { ErrorId } from '@/components/app/status/error-id';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useErrorId } from '@/lib/api/use-error-id';

export interface AiSetupChecklistProps extends AiSetupScope {
  /** The steps of the page's own, listed before the AI steps; the count covers all of them. */
  extraSteps?: readonly SetupStep[] | undefined;
  /** Offered when every step is done. Keeping it dismissed for the project is the page's (open question 3). */
  onDismiss?: (() => void) | undefined;
}

/**
 * The setup checklist with the AI steps: reads the project's engines and answers, builds the steps and owns the
 * open or closed state (closed first). The Overview route mounts it and adds its own steps; nothing mounts it yet.
 *
 * Loading is a 40 px skeleton bar. When both reads fail the bar says so, with Retry and the error id, and no step
 * is shown, so none reads as done. When one fails, its step says it could not be checked and the rest render.
 */
export function AiSetupChecklist({ extraSteps = [], onDismiss, ...scope }: AiSetupChecklistProps): ReactElement {
  const t = useTranslations('setupChecklist');
  const common = useTranslations('common');
  const state = useAiSetupSteps(scope);
  const [expanded, setExpanded] = useState(false);
  const errorId = useErrorId(state.status === 'error' ? state.error : null);

  if (state.status === 'loading') {
    return (
      <SetupFrame busy>
        <div role="status" aria-label={t('loading')} data-slot="setup-skeleton" className="px-4">
          <Skeleton shape="block" height="row" />
        </div>
      </SetupFrame>
    );
  }
  if (state.status === 'error') {
    return (
      <SetupFrame>
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1">
          <Icon icon={CircleX} className="text-negative-text" />
          <p className="type-body-strong text-foreground">{t('error.title')}</p>
          <span className="ml-auto flex flex-wrap items-center gap-3">
            {errorId === null ? null : <ErrorId {...errorId} />}
            <Button variant="secondary" size="sm" loading={state.retrying} onClick={state.retry}>
              {common('retry')}
            </Button>
          </span>
        </div>
      </SetupFrame>
    );
  }

  const steps = [...extraSteps, ...state.steps];
  const progress = setupProgress(steps);
  return (
    <SetupChecklist
      steps={steps}
      progressText={t('progress', progress)}
      expanded={expanded}
      onExpandedChange={setExpanded}
      onDismiss={onDismiss}
      continueHref={continueHref(steps, aiSetupHrefs(scope).engines)}
      refetching={state.fetching}
    />
  );
}
