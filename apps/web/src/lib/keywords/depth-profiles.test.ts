import { describe, expect, it } from 'vitest';

import { DEPTH_KEYS, OFFERED_DEPTH_PROFILES, type DepthProfile } from './depth-profiles';
import { pathsApiV1WorkspacesWorkspace_idProjectsProject_idTrackedKeywordsGetParametersQueryFilterDepth_profile_inAnyOf0Values as depthValues } from '@/lib/api/schema';
import messages from '../../../messages/en.json';

describe('depth profiles', () => {
  it('offers every profile the API names but the one a later step builds', () => {
    const all: readonly DepthProfile[] = depthValues;
    expect([...OFFERED_DEPTH_PROFILES].sort()).toEqual(all.filter((value) => value !== 'until_own_match_100').sort());
  });

  it('has one name in the catalog for every profile the API names, and no other', () => {
    expect(Object.keys(DEPTH_KEYS).sort()).toEqual([...depthValues].sort());
    expect(Object.values(DEPTH_KEYS).sort()).toEqual(Object.keys(messages.common.depths).sort());
  });
});
