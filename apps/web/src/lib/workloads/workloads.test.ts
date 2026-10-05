import { describe, expect, it } from 'vitest';

import { isCostWorkload, WORKLOAD_KEYS } from './workloads';
import messages from '../../../messages/en.json';
import { costWorkloadValues } from '@/lib/api/schema';

describe('workloads', () => {
  it('names a message for every workload, in camelCase as the catalog keys are', () => {
    expect(Object.keys(WORKLOAD_KEYS).sort()).toEqual([...costWorkloadValues].sort());
    expect(Object.values(WORKLOAD_KEYS).sort()).toEqual(Object.keys(messages.workloads).sort());
  });

  it('knows which workload codes it has names for', () => {
    expect(isCostWorkload('seo_rank')).toBe(true);
    expect(isCostWorkload('toString')).toBe(false);
    expect(isCostWorkload('something_new')).toBe(false);
  });
});
