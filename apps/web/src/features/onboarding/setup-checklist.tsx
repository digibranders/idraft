'use client';

import { Circle, CircleCheck } from 'lucide-react';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useId, type ReactElement, type ReactNode } from 'react';

import type { SetupStep } from './setup-steps';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { LinkButton } from '@/components/ui/link-button';
import { TextLink } from '@/components/ui/text-link';

export interface SetupChecklistProps {
  steps: readonly SetupStep[];
  /** "Setup: 4 of 9 steps complete". */
  progressText: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Offered only when every step is done; keeping it dismissed is the page's. */
  onDismiss?: (() => void) | undefined;
  /** Where "Continue setup" goes: the first step still to do. */
  continueHref: Route;
  /** A read is under way while the steps stay: the static 2 px bar of a refetch (17 section 3.4). */
  refetching?: boolean | undefined;
}

/**
 * The frame of the checklist: a bordered panel named "Project setup". The bar, its skeleton and its error all
 * sit in it, so the panel keeps its place whatever it holds.
 */
export function SetupFrame({
  children,
  refetching = false,
  busy = false,
}: {
  children: ReactNode;
  refetching?: boolean;
  busy?: boolean;
}): ReactElement {
  const t = useTranslations('setupChecklist');
  return (
    <section
      aria-label={t('label')}
      aria-busy={busy || undefined}
      className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-surface"
    >
      {refetching ? (
        <div aria-hidden="true" data-slot="setup-refetch-bar" className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
      ) : null}
      {children}
    </section>
  );
}

const share = (done: number, total: number): string => `${String(total <= 0 ? 0 : (done / total) * 100)}%`;

/**
 * The compact onboarding checklist (23-application-patterns.md section 13, 25 section 13.1): a 40 px bar with the
 * count, a 64 px progress bar, Continue setup and Show steps; opened, a list of 32 px rows with the state of each
 * step, its fact and, while it is to do, its action. Complete, the bar reads "Setup complete". It takes finished
 * steps: reading them is the container's.
 */
export function SetupChecklist({
  steps,
  progressText,
  expanded,
  onExpandedChange,
  onDismiss,
  continueHref,
  refetching = false,
}: SetupChecklistProps): ReactElement {
  const t = useTranslations('setupChecklist');
  const listId = useId();
  const done = steps.filter((step) => step.done).length;
  const complete = steps.length > 0 && done === steps.length;
  return (
    <SetupFrame refetching={refetching}>
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1">
        <p className="type-body-strong text-foreground">{complete ? t('complete') : progressText}</p>
        <div
          role="progressbar"
          aria-label={t('progressBar')}
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-valuetext={progressText}
          className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-subtle"
        >
          <span className="block h-full rounded-full bg-primary" style={{ width: share(done, steps.length) }} />
        </div>
        <span className="ml-auto flex items-center gap-1">
          {complete ? (
            onDismiss === undefined ? null : (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                {t('dismiss')}
              </Button>
            )
          ) : (
            <LinkButton render={<Link href={continueHref} />} variant="secondary" size="sm">
              {t('continue')}
            </LinkButton>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => onExpandedChange(!expanded)}
          >
            {expanded ? t('hideSteps') : t('showSteps')}
          </Button>
        </span>
      </div>
      <ol
        id={listId}
        hidden={!expanded}
        aria-label={t('stepsLabel')}
        className="flex flex-col border-t border-border-subtle px-4 pt-1 pb-3"
      >
        {steps.map((step) => (
          <li key={step.id} className="flex min-h-8 flex-wrap items-center gap-x-2 py-1">
            <Icon
              icon={step.done ? CircleCheck : Circle}
              size="sm"
              className={step.done ? 'text-positive-text' : 'text-foreground-muted'}
            />
            <span className="type-body text-foreground">
              <span className="sr-only">{step.done ? t('done') : t('todo')} </span>
              {step.name}
            </span>
            {step.fact === undefined ? null : (
              // An ordinary fact is hidden on a phone, as in the preview; "Could not be checked" is what tells that
              // step from a plain to do, so it stays at every width
              <span
                className={
                  step.unchecked === true ? 'min-w-0 truncate type-meta' : 'hidden truncate type-meta sm:inline'
                }
              >
                {step.fact}
              </span>
            )}
            {step.done || step.action === undefined ? null : (
              <TextLink
                render={<Link href={step.action.href} />}
                className="ml-auto shrink-0 type-body whitespace-nowrap"
              >
                {step.action.label}
              </TextLink>
            )}
          </li>
        ))}
      </ol>
    </SetupFrame>
  );
}
