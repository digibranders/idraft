'use client';

/**
 * One card's own error boundary (spec section 8, WB-LAY-38): a card that throws, fails to load its code or whose
 * data fails shows its error state in its own place, and every other card goes on. Retry asks the registry for a
 * fresh load (React.lazy remembers a failure for good), clears the query errors the card's data left, and renders
 * the card again. In view mode the error state is the card's body; in customize mode (inert body) it is the frame's
 * notice, fed by `card-failures`.
 */
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Component, type ReactElement, type ReactNode } from 'react';

import { useLayoutScreen } from '../layout-provider';
import { ReportCardFailure, useCardFailures } from './card-failures';
import { InlineError } from '@/components/app/status/inline-error';
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
  const failures = useCardFailures();
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <Catcher
          onRetry={() => {
            // A type nobody registered has nothing to load again
            if (Object.hasOwn(registry, item.type)) registry[item.type]?.reset();
            reset();
          }}
          fallback={(retry) =>
            // In customize mode the body is inert: the failure goes to the frame's notice, which is not
            mode === 'customize' && failures !== null ? (
              <ReportCardFailure failures={failures} id={item.id} retry={retry} />
            ) : (
              <div
                role="group"
                aria-label={cardName(item)}
                className="flex h-full min-h-30 rounded-lg border border-border bg-surface"
              >
                <InlineError
                  title={t('failed')}
                  reason={t('failedReason')}
                  errorId={null}
                  retrying={false}
                  retryLabel={t('retry')}
                  onRetry={retry}
                />
              </div>
            )
          }
        >
          {children}
        </Catcher>
      )}
    </QueryErrorResetBoundary>
  );
}
