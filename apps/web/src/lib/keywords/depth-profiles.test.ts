import { describe, expect, it } from 'vitest';

import { DEPTH_KEYS, OFFERED_DEPTH_PROFILES, type DepthProfile } from './depth-profiles';
import { pathsApiV1WorkspacesWorkspace_idProjectsProject_idTrackedKeywordsGetParametersQueryFilterDepth_profile_inAnyOf0Values as depthValues } from '@/lib/api/schema';
import messages from '../../../messages/en.json';

describe('depth profiles', () => {
  it('offers only the profiles that read the top 100: every check does (2026-11-04)', () => {
    const all: readonly DepthProfile[] = depthValues;
    expect([...OFFERED_DEPTH_PROFILES].sort()).toEqual(['full', 'weekly']);
    // Every offered profile is one the API names; the shallower ones stay named for the keywords that hold them
    for (const profile of OFFERED_DEPTH_PROFILES) expect(all).toContain(profile);
    expect(all).toEqual(expect.arrayContaining(['light', 'standard', 'deep', 'weekly_light']));
  });

  it('has one name in the catalog for every profile the API names, and no other', () => {
    expect(Object.keys(DEPTH_KEYS).sort()).toEqual([...depthValues].sort());
    expect(Object.values(DEPTH_KEYS).sort()).toEqual(Object.keys(messages.common.depths).sort());
  });
});
