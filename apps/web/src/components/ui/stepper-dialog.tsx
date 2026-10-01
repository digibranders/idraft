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
   * to its first error, which the step shows itself.
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

  // A new step starts at its first field, so the keyboard does not stay on a button of the last one
  const shownStep = useRef(current);
  useEffect(() => {
    if (shownStep.current === current) return;
    shownStep.current = current;
    body.current?.querySelector<HTMLElement>(FIELDS)?.focus();
  }, [current]);

  const proceed = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const outcome = await onContinue();
      if (outcome === 'invalid') {
        body.current?.querySelector<HTMLElement>(ERRORS)?.focus();
        return;
      }
      if (next !== undefined) onStepChange(next.id);
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
                      onClick={() => onStepChange(step.id)}
                      className="inline-flex items-center gap-1 rounded-xs text-foreground-secondary outline-none hover:text-foreground focus-visible:focus-ring"
                    >
                      <Icon icon={CircleCheck} size="sm" />
                      {step.label}
                    </button>
                  ) : (
                    <span
                      aria-current={isCurrent ? 'step' : undefined}
                      className={cn(isCurrent ? 'type-inline-strong text-foreground' : 'text-foreground-tertiary')}
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
