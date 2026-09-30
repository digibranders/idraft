'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';

export interface SwitchProps extends Omit<SwitchPrimitive.Root.Props, 'className' | 'render' | 'children'> {
  checked: boolean;
  /** Set by the caller after the save has been pending for 400 ms: further toggles are ignored. */
  busy?: boolean | undefined;
  /** Layout only. */
  className?: string | undefined;
}

/**
 * A setting that takes effect and is saved the moment it flips (09-buttons-controls.md section 8.3). Its
 * position is the confirmation, so a successful save shows nothing else. It lives in a `SettingRow`, which
 * names it; on its own it needs `aria-label`. A boolean saved with other fields is a `Checkbox`.
 */
export function Switch({ busy = false, onCheckedChange, className, ...props }: SwitchProps): ReactElement {
  const handleChange: NonNullable<SwitchPrimitive.Root.Props['onCheckedChange']> = (checked, details) => {
    if (busy) {
      details.cancel();
      return;
    }
    onCheckedChange?.(checked, details);
  };
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      {...(busy ? { 'aria-busy': true } : {})}
      {...props}
      onCheckedChange={handleChange}
      // The track is 20 px tall; the pseudo-element extends the target to 24 px
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-border-strong p-0.5 transition-colors duration-(--duration-fast) ease-standard after:absolute after:inset-x-0 after:-inset-y-0.5 not-aria-busy:not-data-disabled:hover:bg-foreground-muted focus-visible:focus-ring aria-busy:cursor-progress data-checked:bg-primary not-aria-busy:not-data-disabled:data-checked:hover:bg-primary-hover data-disabled:cursor-not-allowed data-disabled:bg-surface-disabled data-disabled:inset-ring data-disabled:inset-ring-border',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="size-4 rounded-full bg-surface transition-transform duration-(--duration-fast) ease-standard data-checked:translate-x-4 data-checked:bg-primary-foreground data-disabled:bg-foreground-disabled" />
    </SwitchPrimitive.Root>
  );
}
