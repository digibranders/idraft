import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorklistChips } from './worklist-chips';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { pageFlags, type FlaggedPage } from '@/lib/internal-links/page-flags';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { renderWithProviders } from '@/test/render';

const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };

const chips = (variants: number | null, onShowVariants = vi.fn()): ReturnType<typeof vi.fn> => {
  renderWithProviders(
    <PermissionProvider membership={membershipFactory('editor')}>
      <WorklistChips
        scope={SCOPE}
        run={null}
        linksAvailable
        current={null}
        onPick={vi.fn()}
        onPickEdges={vi.fn()}
        variants={variants}
        onShowVariants={onShowVariants}
      />
    </PermissionProvider>,
  );
  return onShowVariants;
};

describe('parameter variants', () => {
  it('shows the count beside the page total and opens the list of them', () => {
    const open = chips(148);
    fireEvent.click(screen.getByRole('button', { name: '148 parameter variants' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([[0], [null]])('shows nothing when the count is %s', (variants) => {
    chips(variants);
    expect(screen.queryByText(/parameter variant/)).toBeNull();
  });

  it('flags a variant row in neutral, not as a problem', () => {
    const page: FlaggedPage = {
      flags: ['variant'],
      broken_outlinks: 0,
      redirect_outlinks: 0,
      linking_pages: 1,
      is_indexable: false,
      status_code: 200,
      tier: null,
    };
    expect(pageFlags(page, 'all')).toEqual([{ key: 'variant', tone: 'neutral' }]);
  });
});
