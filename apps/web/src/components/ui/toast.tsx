'use client';

import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import { CircleCheck, CircleX, Info, X, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactElement, type ReactNode } from 'react';

import { Button } from './button';
import { Icon } from './icon';
import { IconButton } from './icon-button';
import { Spinner } from './spinner';
import { cn } from '@/lib/utils';

/** There is no warning type: a warning is a condition, and conditions are banners (18 section 3.2). */
export type ToastType = 'success' | 'info' | 'error' | 'progress';

export interface ToastOptions {
  /** A toast with the id of one that is showing replaces it in place, which is how a progress toast ends. */
  id?: string | undefined;
  type: ToastType;
  /** The result first, in the past tense, with the object and the count: "12 keywords archived". */
  title: string;
  /** Two lines at most. */
  description?: string | undefined;
  /** One action at most, two words at most: "Undo", "View report". Using it closes the toast. */
  action?: { label: string; onAction: () => void } | undefined;
}

/** How long a success or info toast without an action stays (20-accessibility.md section 10.5). */
const AUTO_DISMISS_MS = 6000;
const VISIBLE_LIMIT = 3;

const manager = ToastPrimitive.createToastManager();
let sequence = 0;
/**
 * Toasts asked for before a provider listens. Base UI's provider subscribes in an effect, and the effects
 * of its children run first, so a toast shown from a mount effect would otherwise be lost.
 */
let waiting: Parameters<typeof manager.add>[0][] = [];
let listening = false;

/**
 * Shows a toast and returns its id. A toast confirms the result of the user's own action once the screen
 * that started it is gone (18-notifications-alerts.md section 3.3). Success and info toasts leave after
 * 6 seconds. A toast with an action, a progress toast and an error stay until dismissed, and an error is
 * announced at once.
 */
export function toast({ id, type, title, description, action }: ToastOptions): string {
  sequence += 1;
  const toastId = id ?? `toast-${String(sequence)}`;
  const stays = type === 'error' || type === 'progress' || action !== undefined;
  const options = {
    id: toastId,
    type,
    title,
    description,
    timeout: stays ? 0 : AUTO_DISMISS_MS,
    priority: type === 'error' ? ('high' as const) : ('low' as const),
    actionProps: action
      ? {
          children: action.label,
          onClick: (): void => {
            action.onAction();
            manager.close(toastId);
          },
        }
      : undefined,
  };
  if (listening) manager.add(options);
  else waiting.push(options);
  return toastId;
}

/** Closes one toast, or all of them without an id. */
export function dismissToast(id?: string): void {
  waiting = id === undefined ? [] : waiting.filter((entry) => entry.id !== id);
  manager.close(id);
}

/**
 * Placed after the provider, so its effect runs after the one in which Base UI's provider starts to listen
 * (effects run child before parent and sibling after sibling). It hands over what was asked for until then.
 */
function Listening(): null {
  useEffect(() => {
    listening = true;
    for (const entry of waiting) manager.add(entry);
    waiting = [];
    return () => {
      listening = false;
    };
  }, []);
  return null;
}

/** Makes `toast()` work for everything below it. Mounted once, at the root of the app. */
export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <>
      <ToastPrimitive.Provider toastManager={manager} limit={VISIBLE_LIMIT} timeout={AUTO_DISMISS_MS}>
        {children}
      </ToastPrimitive.Provider>
      <Listening />
    </>
  );
}

const TYPE_ICON: Readonly<Record<Exclude<ToastType, 'progress'>, { icon: LucideIcon; className: string }>> = {
  success: { icon: CircleCheck, className: cn('text-positive-text') },
  info: { icon: Info, className: cn('text-info-text') },
  error: { icon: CircleX, className: cn('text-negative-text') },
};
const isToastType = (type: string | undefined): type is ToastType =>
  type === 'success' || type === 'info' || type === 'error' || type === 'progress';

function TypeIcon({ type }: { type: string | undefined }): ReactElement | null {
  if (!isToastType(type)) return null;
  // The 16 px icon is centered on the 32 px row that the title and the action share
  if (type === 'progress') return <Spinner className="mt-2" />;
  const { icon, className } = TYPE_ICON[type];
  return <Icon icon={icon} className={cn('mt-2', className)} />;
}

export interface ToasterProps {
  /** The name of the region, which F6 jumps to: "Notifications". */
  label: string;
  /** The name of the Close button of every toast: "Close". */
  closeLabel: string;
}

/**
 * The place toasts appear: bottom right, 20 px from the edges, and across the bottom below 768 px. Three
 * are visible at most, the newest at the bottom; more wait their turn. Timers pause while the pointer is
 * over the region, while a toast has focus and while the window is in the background. Mounted once,
 * inside `ToastProvider`.
 */
export function Toaster({ label, closeLabel }: ToasterProps): ReactElement {
  const { toasts } = ToastPrimitive.useToastManager();
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        data-slot="toaster"
        aria-label={label}
        className="fixed inset-x-3 bottom-3 z-(--z-toast) flex flex-col-reverse gap-2 rounded-lg focus-visible:focus-ring md:inset-x-auto md:right-5 md:bottom-5 md:w-90"
      >
        {toasts.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            toast={item}
            swipeDirection="right"
            data-slot="toast"
            className="translate-x-(--toast-swipe-movement-x) rounded-lg border border-border bg-surface-elevated shadow-popover transition-[opacity,translate] duration-(--duration-base) ease-standard data-ending-style:opacity-0 data-ending-style:duration-(--duration-fast) data-ending-style:ease-exit data-limited:hidden data-starting-style:translate-y-2 data-starting-style:opacity-0 data-swiping:duration-(--duration-instant)"
          >
            <ToastPrimitive.Content className="flex min-h-12 items-start gap-2 px-3 py-2">
              <TypeIcon type={item.type} />
              <div className="flex min-w-0 flex-1 flex-col py-1.5">
                <ToastPrimitive.Title className="truncate type-body-strong text-foreground" />
                <ToastPrimitive.Description className="line-clamp-2 type-meta text-foreground-secondary" />
              </div>
              {item.actionProps ? <ToastPrimitive.Action render={<Button size="sm" variant="ghost" />} /> : null}
              <ToastPrimitive.Close
                render={<IconButton icon={X} label={closeLabel} size="icon-xs" className="mt-1" />}
              />
            </ToastPrimitive.Content>
          </ToastPrimitive.Root>
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  );
}
