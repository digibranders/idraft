import type { Seam } from './issue-source';
import type { LinksScope } from '@/lib/internal-links/types';

/**
 * The seam of the Monitoring session (spec 10.2). On this branch tracking is not available.
 * Owner: the Monitoring session. Replace the bodies, keep the signatures.
 */

export const TRACKING_AVAILABLE = false;

export interface TrackOutcome {
  added: number;
  alreadyTracked: number;
  notLive: number;
  overLimit: number;
  limit: number;
}

/** The url ids of the tracked pages. */
export const useTrackedPages: (scope: LinksScope) => Seam<ReadonlySet<string>> = () => ({ state: 'unavailable' });

export const useTrackPages: (scope: LinksScope) => {
  track: (urlIds: readonly string[]) => Promise<TrackOutcome>;
  pending: boolean;
} = () => ({ track: () => Promise.reject(new Error('Tracking is not available')), pending: false });
