'use client';

import { createContext, use } from 'react';

export type CardStatusKind = 'loading' | 'ready' | 'refetching' | 'empty' | 'error';

export interface CardReadinessStore {
  subscribe(listener: () => void): () => void;
  statusOf(id: string): CardStatusKind | undefined;
  isNotReady(id: string): boolean;
  report(id: string, status: CardStatusKind): void;
}

export function createCardReadinessStore(): CardReadinessStore {
  const statuses = new Map<string, CardStatusKind>();
  const listeners = new Set<() => void>();
  const emit = (): void => {
    listeners.forEach((listener) => {
      listener();
    });
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    statusOf: (id) => statuses.get(id),
    isNotReady: (id) => statuses.get(id) === 'empty',
    report: (id, status) => {
      const prev = statuses.get(id);
      if (prev === status) return;
      statuses.set(id, status);
      emit();
    },
  };
}

export const CardReadinessContext = createContext<CardReadinessStore | null>(null);

export function useCardReadiness(): CardReadinessStore | null {
  return use(CardReadinessContext);
}

export const CardIdContext = createContext<string | null>(null);

export function useCurrentCardId(): string | null {
  return use(CardIdContext);
}
