import { hashOf } from './rank-history';
import { changeOf } from './rank-state';
import { worldChecks, type WorldChecksInput } from './serp-world';

export const TOP_BUCKETS = [3, 10, 20, 100] as const;
export const DEBOUNCE_CHECKS = 2 as const;

export interface EventCheck {
  snapshotId?: string | null;
  observedAt: string;
  rank: number | null;
  depth: number;
  path: string | null;
  ownedFeatures: readonly string[];
  aio: 'absent' | 'present_not_cited' | 'present_cited' | 'not_loaded' | 'unknown';
  aioCited: boolean | null;
  competitors: ReadonlyMap<string, number | null>;
}

export interface WorldEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  snapshotId: string | null;
  fromRank: number | null;
  toRank: number | null;
  fromPath: string | null;
  toPath: string | null;
  otherEntityId: string | null;
  featureType: string | null;
}

interface EventDraft {
  eventType: string;
  fromRank?: number | null;
  toRank?: number | null;
  fromPath?: string | null;
  toPath?: string | null;
  otherEntityId?: string | null;
  featureType?: string | null;
}

function withinDepth(rank: number | null, depth: number): number | null {
  return rank !== null && rank <= depth ? rank : null;
}

function isAhead(rank: number | null, other: number | null): boolean {
  return rank !== null && (other === null || rank < other);
}

/**
 * Pure port of own_events and overtake_events from backend/src/idraft/ranks/events.py.
 * Evaluates events in deterministic chronological order across checks.
 */
export function rankEventsOf(checks: readonly EventCheck[], trackedId: string): WorldEvent[] {
  if (checks.length === 0) return [];

  const events: WorldEvent[] = [];
  let previous: EventCheck | null = null;
  let consecutiveBeyond = 0;
  let lastRankedRank: number | null = null;

  for (let i = 0; i < checks.length; i += 1) {
    const cur = checks[i];
    if (cur === undefined) continue;

    if (previous === null) {
      if (cur.rank !== null) {
        lastRankedRank = cur.rank;
        consecutiveBeyond = 0;
      } else {
        consecutiveBeyond = 1;
      }
      previous = cur;
      continue;
    }

    const comparedDepth = Math.min(previous.depth, cur.depth);
    const beforeRank = withinDepth(previous.rank, comparedDepth);
    const nowRank = withinDepth(cur.rank, comparedDepth);

    const change = changeOf(
      { rank: previous.rank, depth: previous.depth, observedAt: previous.observedAt },
      { rank: cur.rank, depth: cur.depth, observedAt: cur.observedAt },
    );

    const prevConsecutiveBeyond = consecutiveBeyond;
    if (cur.rank !== null) {
      consecutiveBeyond = change.label === 'consistent_beyond' ? prevConsecutiveBeyond : 0;
    } else {
      const lookedDeepEnough = lastRankedRank === null || lastRankedRank <= cur.depth;
      consecutiveBeyond = lookedDeepEnough ? Math.min(prevConsecutiveBeyond + 1, 1000) : prevConsecutiveBeyond;
    }

    const drafts: EventDraft[] = [];

    // 1. Top events
    for (const bucket of TOP_BUCKETS) {
      if (bucket > comparedDepth) continue;
      const wasIn = beforeRank !== null && beforeRank <= bucket;
      const isIn = nowRank !== null && nowRank <= bucket;
      if (isIn && !wasIn) {
        drafts.push({ eventType: `entered_top_${String(bucket)}`, fromRank: beforeRank, toRank: nowRank });
      } else if (wasIn && !isIn) {
        drafts.push({ eventType: `lost_top_${String(bucket)}`, fromRank: beforeRank, toRank: nowRank });
      }
    }

    // 2. Ranking events
    if (cur.rank !== null) {
      if (change.label === 'new' && prevConsecutiveBeyond >= DEBOUNCE_CHECKS) {
        drafts.push({ eventType: 'new_ranking', fromRank: null, toRank: cur.rank });
      }
    } else {
      if (
        consecutiveBeyond === DEBOUNCE_CHECKS &&
        prevConsecutiveBeyond === DEBOUNCE_CHECKS - 1 &&
        lastRankedRank !== null
      ) {
        drafts.push({ eventType: 'lost_ranking', fromRank: lastRankedRank, toRank: null });
      }
    }

    // 3. Movement events
    if (change.label === 'numeric' && change.value !== null && change.value !== 0) {
      const eventType = change.value > 0 ? 'rank_gain' : 'rank_drop';
      drafts.push({
        eventType,
        fromRank: previous.rank,
        toRank: cur.rank,
        fromPath: previous.path,
        toPath: cur.path,
      });
    }

    const urlChanged = previous.path !== null && cur.path !== null && previous.path !== cur.path;
    if (urlChanged) {
      drafts.push({
        eventType: 'url_changed',
        fromRank: previous.rank,
        toRank: cur.rank,
        fromPath: previous.path,
        toPath: cur.path,
      });
    }

    // 4. Feature events
    const prevFeatures = new Set(previous.ownedFeatures);
    const curFeatures = new Set(cur.ownedFeatures);
    const gained = [...curFeatures].filter((f) => !prevFeatures.has(f)).sort();
    const lost = [...prevFeatures].filter((f) => !curFeatures.has(f)).sort();
    for (const featureType of gained) {
      drafts.push({ eventType: 'feature_gained', featureType });
    }
    for (const featureType of lost) {
      drafts.push({ eventType: 'feature_lost', featureType });
    }

    // 5. AIO events
    const wasAio = previous.aio === 'unknown' ? null : previous.aio !== 'absent';
    const nowAio = cur.aio === 'unknown' ? null : cur.aio !== 'absent';
    if (wasAio !== null && nowAio !== null && wasAio !== nowAio) {
      drafts.push({ eventType: nowAio ? 'aio_appeared' : 'aio_disappeared' });
    }

    const citedWas = previous.aioCited;
    const citedNow = cur.aioCited;
    if (citedWas !== null && citedNow !== null && citedWas !== citedNow) {
      drafts.push({ eventType: citedNow ? 'aio_citation_gained' : 'aio_citation_lost' });
    }

    // 6. Overtake events
    const ownPrev = withinDepth(previous.rank, comparedDepth);
    const ownCur = withinDepth(cur.rank, comparedDepth);
    if (ownPrev !== null || ownCur !== null) {
      const commonCompetitors = [...previous.competitors.keys()].filter((k) => cur.competitors.has(k)).sort();
      for (const compId of commonCompetitors) {
        const rivalPrev = withinDepth(previous.competitors.get(compId) ?? null, comparedDepth);
        const rivalCur = withinDepth(cur.competitors.get(compId) ?? null, comparedDepth);
        if (rivalPrev === null && rivalCur === null) continue;
        if (isAhead(rivalCur, ownCur) && !isAhead(rivalPrev, ownPrev)) {
          drafts.push({
            eventType: 'overtaken_by',
            fromRank: previous.rank,
            toRank: cur.rank,
            otherEntityId: compId,
          });
        } else if (isAhead(ownCur, rivalCur) && !isAhead(ownPrev, rivalPrev)) {
          drafts.push({
            eventType: 'overtook',
            fromRank: previous.rank,
            toRank: cur.rank,
            otherEntityId: compId,
          });
        }
      }
    }

    for (const draft of drafts) {
      const hashToken = `${trackedId}:${cur.observedAt}:${draft.eventType}:${draft.otherEntityId ?? draft.featureType ?? ''}`;
      const id = String(hashOf(hashToken) + 1);
      events.push({
        id,
        eventType: draft.eventType,
        occurredAt: cur.observedAt,
        snapshotId: cur.snapshotId ?? null,
        fromRank: draft.fromRank ?? null,
        toRank: draft.toRank ?? null,
        fromPath: draft.fromPath ?? null,
        toPath: draft.toPath ?? null,
        otherEntityId: draft.otherEntityId ?? null,
        featureType: draft.featureType ?? null,
      });
    }

    if (cur.rank !== null) {
      lastRankedRank = cur.rank;
    }
    previous = cur;
  }

  return events;
}

/**
 * Returns world events for a tracked keyword across its worldChecks.
 * Returned events are sorted oldest first.
 */
export function worldEvents(input: WorldChecksInput): WorldEvent[] {
  const checks = worldChecks(input);
  const goodChecks = checks.filter((c) => !c.failed && c.observedAt !== null);

  const eventChecks: EventCheck[] = goodChecks.map((c) => {
    const aioState = c.aio?.state ?? 'absent';
    const aioCited = aioState === 'present_cited' ? true : aioState === 'present_not_cited' ? false : null;
    const ownedFeatures: string[] = [];
    for (const f of c.features) {
      if (f.owned && f.type !== 'ai_overview') ownedFeatures.push(f.type);
    }
    return {
      snapshotId: c.snapshotId,
      observedAt: c.observedAt ?? '',
      rank: c.rank,
      depth: c.depth,
      path: c.path,
      ownedFeatures,
      aio: aioState,
      aioCited,
      competitors: c.competitorRanks,
    };
  });

  return rankEventsOf(eventChecks, input.trackedId);
}
