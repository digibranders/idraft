import { describe, expect, it } from 'vitest';

import { OFFERED_DEPTH_PROFILES, type DepthProfile } from './depth-profiles';
import { pathsApiV1WorkspacesWorkspace_idProjectsProject_idTrackedKeywordsGetParametersQueryFilterDepth_profile_inAnyOf0Values as depthValues } from '@/lib/api/schema';

describe('depth profiles', () => {
  it('offers every profile the API names but the one a later step builds', () => {
    const all: readonly DepthProfile[] = depthValues;
    expect([...OFFERED_DEPTH_PROFILES].sort()).toEqual(all.filter((value) => value !== 'until_own_match_100').sort());
  });
});
