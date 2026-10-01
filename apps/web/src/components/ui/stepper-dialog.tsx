'use client';

import { ChevronRight, CircleCheck } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { Button } from './button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader, type DialogDiscardCopy } from './dialog';
import { Icon } from './icon';
import { cn } from '@/lib/utils';

/** A pending Continue shows its spinner only after this long, so a quick check never flickers. */
const LOADING_AFTER_MS = 400;
/** What takes focus when a step opens, and the first error when Continue finds one. */
const FIELDS =
  'input:not([type="hidden"]), textarea, select, [role="combobox"], [role="checkbox"], [role="radio"], [role="switch"]';
const ERRORS = '[aria-invalid="true"], [data-slot="form-alert"]';

export interface StepperStep<TStep extends string> {
  id: TStep;
  /** One or two words: "Map columns". */
  label: string;
}

export interface StepperDialogLabels {
  /** Names the list of steps: "Import steps". */
  steps: string;
  close: string;
  back: string;
  cancel: string;
  continue: string;
  /** Read after a completed step's name, since its check mark is not read: "completed". */
  completed: string;
}

export interface StepperDialogProps<TStep extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  steps: readonly StepperStep<TStep>[];
  current: TStep;
  /** Steps that passed Continue; they are buttons back to themselves. */
  completed: ReadonlySet<TStep>;
  /** Back, a completed step, or the next step after a Continue that passed. */
  onStepChange: (step: TStep) => void;
  /**
   * Checks the current step and, on the last one, does the work. `invalid` keeps the step and moves focus
   * to its first error, which the step shows itself. A rejection keeps the step too; the caller shows why.
   */
  onContinue: () => Promise<'ok' | 'invalid'>;
  /** The last step's button names the result: "Import 1,204 keywords". */
  finalLabel: string;
  labels: StepperDialogLabels;
  /** The question a close past the first step asks first. */
  discard: DialogDiscardCopy;
  /** The current step's content. */
  children: ReactNode;
}

/**
 * A multi-step task in a 720 px dialog (16-drawers-dialogs-popovers.md section 4.6, 25 section 3.35): an
 * ordered list of steps at the top of the body, where completed steps are buttons back and the current one
 * is marked `aria-current="step"`; Back, Cancel and Continue below. Continue checks the step and moves on,
 * or keeps it and focuses its first error. Closing past the first step asks before discarding.
 */
export function StepperDialog<TStep extends string>({
  open,
  onOpenChange,
  title,
  steps,
  current,
  completed,
  onStepChange,
  onContinue,
  finalLabel,
  labels,
  discard,
  children,
}: StepperDialogProps<TStep>): ReactElement {
  const body = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const index = Math.max(
    steps.findIndex((step) => step.id === current),
    0,
  );
  const previous = steps[index - 1];
  const next = steps[index + 1];
  const last = next === undefined;

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setTimeout(() => setSlow(true), LOADING_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [pending]);

  // A new step starts at its first field, or at its name in the list when it has none, so the keyboard
  // does not stay on a button of the last step (or on a step button that just went away)
  const shownStep = useRef(current);
  const currentStep = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (shownStep.current === current) return;
    shownStep.current = current;
    (body.current?.querySelector<HTMLElement>(FIELDS) ?? currentStep.current)?.focus();
  }, [current]);

  // A check that fails focuses the first error once the step has drawn it, which for an answer from the
  // server is a render after this one
  const [failedChecks, setFailedChecks] = useState(0);
  useEffect(() => {
    if (failedChecks > 0) body.current?.querySelector<HTMLElement>(ERRORS)?.focus();
  }, [failedChecks]);

  // What the dialog shows now, for a check that returns after the person moved on or closed it
  const live = useRef({ current, open });
  useEffect(() => {
    live.current = { current, open };
  }, [current, open]);

  const proceed = async (): Promise<void> => {
    if (pending) return;
    const startedOn = current;
    setPending(true);
    try {
      const outcome = await onContinue();
      // The answer belongs to a step that is no longer shown: it moves nothing
      if (live.current.current !== startedOn || !live.current.open) return;
      if (outcome === 'invalid') setFailedChecks((count) => count + 1);
      else if (next !== undefined) onStepChange(next.id);
    } catch {
      // The step stays; the caller has shown what went wrong
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" dirty={index > 0 || completed.size > 0} discard={discard}>
      <DialogHeader title={title} closeLabel={labels.close} />
      <DialogBody ref={body}>
        <ol aria-label={labels.steps} className="flex flex-wrap items-center gap-2 type-label">
          {steps.map((step, position) => {
            const isCurrent = step.id === current;
            const done = !isCurrent && completed.has(step.id);
            return (
              <Fragment key={step.id}>
                {position > 0 ? (
                  <li aria-hidden="true" className="flex text-foreground-tertiary">
                    <Icon icon={ChevronRight} size="xs" />
                  </li>
                ) : null}
                <li className="flex">
                  {done ? (
                    <button
                      type="button"
                      // No jumping while Continue is checking: its answer would land on the wrong step
                      disabled={pending}
                      onClick={() => onStepChange(step.id)}
                      className="inline-flex items-center gap-1 rounded-xs text-foreground-secondary outline-none not-disabled:hover:text-foreground focus-visible:focus-ring"
                    >
                      <Icon icon={CircleCheck} size="sm" />
                      {step.label}
                      <span className="sr-only">{`, ${labels.completed}`}</span>
                    </button>
                  ) : (
                    <span
                      ref={isCurrent ? currentStep : undefined}
                      tabIndex={isCurrent ? -1 : undefined}
                      aria-current={isCurrent ? 'step' : undefined}
                      className={cn(
                        isCurrent ? 'type-inline-strong text-foreground outline-none' : 'text-foreground-tertiary',
                      )}
                    >
                      {step.label}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
        {children}
      </DialogBody>
      <DialogFooter
        start={
          previous === undefined ? undefined : (
            <Button variant="ghost" onClick={() => onStepChange(previous.id)} disabled={pending}>
              {labels.back}
            </Button>
          )
        }
        secondary={
          <DialogClose>
            <Button variant="secondary">{labels.cancel}</Button>
          </DialogClose>
        }
        primary={
          <Button variant="primary" loading={slow} onClick={() => void proceed()}>
            {last ? finalLabel : labels.continue}
          </Button>
        }
      />
    </Dialog>
  );
}
