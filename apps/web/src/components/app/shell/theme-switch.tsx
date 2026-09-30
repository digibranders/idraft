'use client';

import { Moon, Sun } from 'lucide-react';
import type { MouseEvent, ReactElement } from 'react';

import { Icon } from '@/components/ui/icon';
import { Tooltip } from '@/components/ui/tooltip';

export interface ThemeSwitchProps {
  /** The theme on screen now; `null` before the page has hydrated, when the switch is not shown yet. */
  resolvedTheme: 'light' | 'dark' | null;
  /** The switch sets an explicit theme; `origin` is its centre, where the reveal starts. */
  onToggle: (next: 'light' | 'dark', origin: { x: number; y: number }) => void;
  /** "Dark theme": the switch's name, which its state completes. */
  label: string;
  /** "Switch theme", the tooltip. */
  tooltip: string;
}

/**
 * The top bar's theme control at 1440 px and up (11-navigation.md section 4, 25 section 5.9): a 52 by 28
 * px pill, a switch named "Dark theme" that is on in the dark theme. Sky track with a sun by day, navy
 * with a moon by night; the knob slides over `--duration-slow`. Below 1440 px it is hidden and the
 * account menu has the Theme group instead.
 */
export function ThemeSwitch({ resolvedTheme, onToggle, label, tooltip }: ThemeSwitchProps): ReactElement {
  const dark = resolvedTheme === 'dark';
  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    onToggle(dark ? 'light' : 'dark', { x: box.left + box.width / 2, y: box.top + box.height / 2 });
  };
  return (
    <Tooltip content={tooltip} side="bottom">
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label={label}
        onClick={toggle}
        disabled={resolvedTheme === null}
        className="group relative hidden h-7 w-13 shrink-0 items-center rounded-full bg-theme-switch-day inset-ring inset-ring-border transition-colors duration-(--duration-slow) focus-visible:focus-ring disabled:invisible aria-checked:bg-theme-switch-night 2xl:flex"
      >
        <Icon
          icon={Sun}
          size="sm"
          className="absolute right-1.5 text-theme-switch-sun transition-opacity duration-(--duration-slow) group-aria-checked:opacity-0"
        />
        <Icon
          icon={Moon}
          size="sm"
          className="absolute left-1.5 fill-current text-theme-switch-moon opacity-0 transition-opacity duration-(--duration-slow) group-aria-checked:opacity-100"
        />
        <span
          aria-hidden="true"
          className="absolute left-0.75 size-5.5 rounded-full bg-theme-switch-knob shadow-switch-knob transition-transform duration-(--duration-slow) group-aria-checked:translate-x-6"
        />
      </button>
    </Tooltip>
  );
}
