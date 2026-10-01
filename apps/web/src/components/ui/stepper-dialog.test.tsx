import { screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StepperDialog } from './stepper-dialog';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

type Step = 'upload' | 'map' | 'review';
const STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Map columns' },
  { id: 'review', label: 'Review' },
] as const;
const LABELS = {
  steps: 'Import steps',
  close: 'Close',
  back: 'Back',
  cancel: 'Cancel',
  continue: 'Continue',
  completed: 'completed',
};
const DISCARD = {
  title: 'Discard this import?',
  description: 'The file and the mapping are lost.',
  keepEditingLabel: 'Keep editing',
  discardLabel: 'Discard',
};

const finish = vi.fn();

function Harness({ invalidOn = null }: { invalidOn?: Step | null }): ReactElement {
  const [open, setOpen] = useState(true);
  const [current, setCurrent] = useState<Step>('upload');
  const [completed, setCompleted] = useState<ReadonlySet<Step>>(new Set());
  const [error, setError] = useState(false);
  return (
    <StepperDialog<Step>
      open={open}
      onOpenChange={setOpen}
      title="Import keywords"
      steps={STEPS}
      current={current}
      completed={completed}
      onStepChange={setCurrent}
      onContinue={async () => {
        // As a server check would: the answer, and the error it shows, come after an await
        await Promise.resolve();
        if (current === invalidOn) {
          setError(true);
          return 'invalid';
        }
        setCompleted((done) => new Set([...done, current]));
        if (current === 'review') finish();
        return 'ok';
      }}
      finalLabel="Import 1,204 keywords"
      labels={LABELS}
      discard={DISCARD}
    >
      <label>
        {`${current} field`}
        <input aria-invalid={error ? true : undefined} />
      </label>
    </StepperDialog>
  );
}

beforeEach(() => {
  finish.mockReset();
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
});
afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

describe('StepperDialog', () => {
  it('lists the steps, marks the current one, and names the result on the last', async () => {
    const { user } = renderWithProviders(<Harness />);
    const steps = await screen.findByRole('list', { name: 'Import steps' });
    expect(within(steps).getByText('Upload')).toHaveAttribute('aria-current', 'step');
    expect(within(steps).queryByRole('button')).toBeNull();
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(within(steps).getByText('Map columns')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('textbox', { name: 'map field' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Import 1,204 keywords' }));
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('goes back to a completed step from the list or with Back', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Upload, completed' }));
    expect(screen.getByText('Upload')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Map columns, completed' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Upload')).toHaveAttribute('aria-current', 'step');
  });

  it('keeps a step that does not pass and focuses its first error', async () => {
    const { user } = renderWithProviders(<Harness invalidOn="upload" />);
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Upload')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('textbox', { name: 'upload field' })).toHaveFocus();
  });

  it('asks before closing once past the first step', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard this import?' })).toBeInTheDocument();
  });
});
