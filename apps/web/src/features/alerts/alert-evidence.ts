import type { AlertEvent } from '@/lib/api/types';

/** The answers of one run that mention the subject, out of the valid ones. */
export interface MentionCount {
  mentioning: number;
  valid: number;
}

/** What an alert's evidence says, once checked: the API leaves `evidence` as a free record. */
export type Evidence =
  | {
      kind: 'mention';
      /** The platform code the answers came from, when the evidence has it. */
      platform: string | null;
      before: MentionCount;
      after: MentionCount;
      /** The competitor the counts are about; `null` when they are about your brand. */
      competitor: string | null;
    }
  | { kind: 'rank'; from: number; to: number; positions: number };

type Record_ = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Record_ => typeof value === 'object' && value !== null;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

function countOf(value: unknown): MentionCount | null {
  if (!isRecord(value) || !isCount(value.mentioning) || !isCount(value.valid)) return null;
  return { mentioning: value.mentioning, valid: value.valid };
}

/** The evidence of an alert, or `null` when it does not have the shape its kind promises. */
export function readEvidence(event: Pick<AlertEvent, 'event_kind' | 'evidence'>): Evidence | null {
  const { evidence } = event;
  if (event.event_kind === 'rank_drop') {
    const { from_rank: from, to_rank: to, positions_lost: lost } = evidence;
    return isCount(from) && isCount(to) && isCount(lost) ? { kind: 'rank', from, to, positions: lost } : null;
  }
  const before = countOf(evidence.before);
  const after = countOf(evidence.after);
  if (before === null || after === null) return null;
  const { engine_code: code, competitor } = evidence;
  return {
    kind: 'mention',
    platform: typeof code === 'string' ? code : null,
    before,
    after,
    competitor: isRecord(competitor) && typeof competitor.name === 'string' ? competitor.name : null,
  };
}
