import type { MetricCell, WeekCells } from '@/lib/api/types';

/**
 * A weekly point that may carry AI visibility (the share of valid answers that mention the brand or cite the site).
 *
 * BACKEND REQUEST SHAPE. The generated client (`lib/api/schema.ts`) has no `visibility` on `WeekCells`. It is optional
 * here and means "the backend has not built it yet" when absent; the Overview trend card then says "Not collected
 * yet" and never draws another measure in its place. When the field is built it is the sum of the three outcome
 * counts of the week that are not "neither", pooled as `mentioned` and `cited` are
 * (`docs/ai-visibility/backend-requests-overview.md`, item 1).
 */
export type WeekWithVisibility = WeekCells & { visibility?: MetricCell | null | undefined };
