import { describe, expect, it } from 'vitest';

import { faviconUrl } from './favicon';

const WORKSPACE = '0198a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';

describe('faviconUrl', () => {
  it("is the API's own route for the workspace, on the app's origin, so no domain leaves for a third party", () => {
    expect(faviconUrl('eventussecurity.com', WORKSPACE)).toBe(
      `/api/v1/workspaces/${WORKSPACE}/favicons/eventussecurity.com`,
    );
  });

  it('encodes the host, so it can never add a path or a query', () => {
    expect(faviconUrl('a.com/../x?y=1', WORKSPACE)).toBe(
      `/api/v1/workspaces/${WORKSPACE}/favicons/a.com%2F..%2Fx%3Fy%3D1`,
    );
  });

  it('has no address with no workspace to ask in', () => {
    expect(faviconUrl('eventussecurity.com', null)).toBeNull();
  });
});
