import type { AioStateInfo, RankCell } from '@/lib/api/types';

/** What an AI Overview cell shows (12-tables.md section 6, `AIOverviewStatus`). Codes only: no English here. */
export type AioDisplay =
  | { kind: 'cited'; position: number | null }
  | { kind: 'notCited' }
  | { kind: 'absent' }
  | { kind: 'notLoaded' }
  | { kind: 'pending' }
  | { kind: 'unknown' };

export function aioDisplay(aio: AioStateInfo, current: RankCell['state']): AioDisplay {
  if (current === 'not_checked') return { kind: 'pending' };
  switch (aio.state) {
    case 'present_cited':
      return { kind: 'cited', position: aio.citation_position };
    case 'present_not_cited':
      return { kind: 'notCited' };
    case 'absent':
      return { kind: 'absent' };
    case 'not_loaded':
      return { kind: 'notLoaded' };
    case 'unknown':
      return { kind: 'unknown' };
  }
}
