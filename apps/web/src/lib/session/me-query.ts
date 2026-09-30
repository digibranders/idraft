import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';

/**
 * `/me` as the client asks for it. The `[workspace]` layout seeds the cache under this key on the server,
 * so this module has no `'use client'`: the server calls it too.
 */
export const meQuery = (): ApiQueryOptions<'/api/v1/me'> => apiQuery('/api/v1/me');
