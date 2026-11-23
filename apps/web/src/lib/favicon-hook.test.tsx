import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { FaviconWorkspaceContext, useFaviconUrl } from './favicon';

const WORKSPACE = '0198a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';

describe('useFaviconUrl', () => {
  const inWorkspace = ({ children }: Readonly<{ children: ReactNode }>): ReactNode => (
    <FaviconWorkspaceContext value={WORKSPACE}>{children}</FaviconWorkspaceContext>
  );

  it('asks the route of the workspace being shown', () => {
    const { result } = renderHook(() => useFaviconUrl('hubspot.com'), { wrapper: inWorkspace });
    expect(result.current).toBe(`/api/v1/workspaces/${WORKSPACE}/favicons/hubspot.com`);
  });

  it('has no address for no host, or outside a workspace page', () => {
    expect(renderHook(() => useFaviconUrl(null), { wrapper: inWorkspace }).result.current).toBeNull();
    expect(renderHook(() => useFaviconUrl('hubspot.com')).result.current).toBeNull();
  });
});
