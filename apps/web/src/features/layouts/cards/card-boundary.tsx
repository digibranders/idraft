'use client';

/**
 * One card's own error boundary (spec section 8, WB-LAY-38): a card that throws, fails to load its code or whose
 * data fails shows its error state in its own place, and every other card goes on. Retry asks the registry for a
 * fresh load (React.lazy remembers a failure for good), clears the query errors the card's data left, and renders
 * the card again.
 */
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Component, type ReactElement, type ReactNode } from 'react';

import { useLayoutScreen } from '../layout-provider';
import { InlineError } from '@/components/app/status/inline-error';
import { Icon } from '@/components/ui/icon';
import { cardName, type CardItem } from '@/lib/layouts';

interface CatcherProps {
  /** What stands in for the card; `retry` clears the failure and renders the card again. */
  fallback: (retry: () => void) => ReactNode;
  /** Runs before the card is rendered again. */
  onRetry: () => void;
  children: ReactNode;
}

interface CatcherState {
  failed: boolean;
}

/** React has no hook for catching a render error: a boundary is a class. */
class Catcher extends Component<CatcherProps, CatcherState> {
  override state: CatcherState = { failed: false };

  static getDerivedStateFromError(): CatcherState {
    return { failed: true };
  }

  private readonly retry = (): void => {
    this.props.onRetry();
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

export interface CardBoundaryProps {
  item: CardItem;
  children: ReactNode;
}

/** Wraps the body of one card: the slot `LayoutGrid` calls `CardBoundary`. */
export function CardBoundary({ item, children }: CardBoundaryProps): ReactElement {
  const t = useTranslations('layouts.customize.card');
  const { registry, mode } = useLayoutScreen();
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Catcher
          onRetry={() => {
            // A type nobody registered has nothing to load again
            if (Object.hasOwn(registry, item.type)) registry[item.type]?.reset();
            reset();
          }}
          fallback={(retry) => (
            <div
              role="group"
              aria-label={cardName(item)}
              className="flex h-full min-h-30 rounded-lg border border-border bg-surface"
            >
              {mode === 'view' ? (
                <InlineError
                  title={t('failed')}
                  reason={t('failedReason')}
                  errorId={null}
                  retrying={false}
                  retryLabel={t('retry')}
                  onRetry={retry}
                />
              ) : (
                // The card is arranged and not used in customize mode: its body is inert, so no Retry is offered
                <div className="flex items-start gap-2 p-4">
                  <Icon icon={CircleX} className="mt-0.5 shrink-0 text-negative-text" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="type-body-strong text-foreground">{t('failed')}</p>
                    <p className="type-body text-foreground-secondary">{t('failedReason')}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        >
          {children}
        </Catcher>
      )}
    </QueryErrorResetBoundary>
  );
}
