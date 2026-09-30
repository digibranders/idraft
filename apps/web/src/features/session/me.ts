'use client';

import { useSuspenseQuery } from '@tanstack/react-query';

import { meQuery } from './me-query';
import type { Me } from '@/lib/api/types';

/**
 * The signed-in person, their session and their memberships. Only below the `[workspace]` layout, which
 * puts the answer in the cache, so this reads it without a request (and refetches when it goes stale).
 * Anywhere else it would ask on the server with the browser's client, which throws.
 */
export function useMe(): Me {
  return useSuspenseQuery(meQuery()).data.data;
}
