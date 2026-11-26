import type { MetricCell, WeekCells } from '@/lib/api/types';

/**
 * A weekly point as the readers take it: the API sends `visibility` on every point (the share of valid answers that
 * mention the brand or cite the site, pooled as `mentioned` and `cited` are; backend request 1), and the reader still
 * tolerates a body without it (an older read, a partial test body), which then has no weekly visibility: the Overview
 * trend card says "Not collected yet" and never draws another measure in its place.
 */
export type WeekWithVisibility = Omit<WeekCells, 'visibility'> & { visibility?: MetricCell | null | undefined };
