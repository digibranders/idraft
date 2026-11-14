import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createRef, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { CardFrame, type CardFrameProps } from './card-frame';
import { LayoutProvider, useLayoutScreen } from './layout-provider';
import { defineCards } from './registry';
import type { CardItem } from '@/lib/layouts';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

const WORKSPACE = MOCK_WORKSPACE.workspace_id;
const ITEM: CardItem = { id: 'rank-distribution', type: 'seo.rank_distribution', width: 'third' };
const REGISTRY = defineCards({});

function CustomizeButton(): ReactElement {
  const { actions, canCustomize } = useLayoutScreen();
  return (
    <button type="button" disabled={!canCustomize} onClick={actions.enter}>
      Customize
    </button>
  );
}

function Shell({ frame }: { frame: ReactNode }): ReactElement {
  return (
    <PermissionProvider membership={membershipFactory('admin')}>
      <LayoutProvider
        screen="overview"
        workspaceId={WORKSPACE}
        capabilities={{ channels: ['seo', 'ai'], permissions: [], integrations: [] }}
        registry={REGISTRY}
      >
        <CustomizeButton />
        {frame}
      </LayoutProvider>
    </PermissionProvider>
  );
}

function mount(frame: ReactNode): ProvidedRender {
  server.use(
    http.get(mswPath(`/api/v1/workspaces/${WORKSPACE}/layouts/overview`), () =>
      HttpResponse.json(
        {
          data: {
            screen: 'overview',
            source: 'builtin',
            document: null,
            team_default_exists: false,
            team_document: null,
            updated_at: null,
            updated_by: null,
          },
        },
        { headers: { etag: '"e1"' } },
      ),
    ),
  );
  return renderWithProviders(<Shell frame={frame} />);
}

function frameWith(props: Partial<CardFrameProps> = {}): ReactElement {
  return (
    <CardFrame
      item={ITEM}
      handle={
        <button type="button" data-part="handle">
          Reorder
        </button>
      }
      tools={
        <button type="button" data-part="more">
          More
        </button>
      }
      edge={<i data-testid="edge" />}
      {...props}
    >
      <a href="#inside">Inside link</a>
    </CardFrame>
  );
}

async function customize({ user }: ProvidedRender): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Customize', hidden: false }));
}

const rootOf = (): HTMLElement => {
  const root = document.querySelector<HTMLElement>('[data-layout-card]');
  if (root === null) throw new Error('no frame');
  return root;
};

describe('CardFrame in view mode', () => {
  it('is the card id on the root, with the body as it is and no controls', async () => {
    mount(frameWith());
    await screen.findByRole('button', { name: 'Customize' });
    expect(rootOf()).toHaveAttribute('data-layout-card', 'rank-distribution');
    expect(screen.getByRole('link', { name: 'Inside link' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inside link' }).closest('[inert]')).toBeNull();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reorder' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('edge')).not.toBeInTheDocument();
    expect(rootOf()).not.toHaveClass('outline-dashed');
  });

  it('hands its root to a ref and takes the span class of the grid', async () => {
    const ref = createRef<HTMLDivElement>();
    mount(
      <CardFrame ref={ref} item={ITEM} className="col-span-12 xl:col-span-4">
        <p>Body</p>
      </CardFrame>,
    );
    await screen.findByRole('button', { name: 'Customize' });
    expect(ref.current).toBe(rootOf());
    expect(rootOf()).toHaveClass('col-span-12', 'xl:col-span-4');
  });
});

describe('CardFrame in customize mode', () => {
  it('names the controls as a group after the card, shows the edge and puts the body out of reach', async () => {
    const view = mount(frameWith());
    await customize(view);
    const group = screen.getByRole('group', { name: 'Rank distribution card' });
    expect(within(group).getByRole('button', { name: 'Reorder' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'More' })).toBeInTheDocument();
    expect(screen.getByTestId('edge')).toBeInTheDocument();
    expect(screen.getByText('Inside link').closest('[inert]')).not.toBeNull();
    expect(rootOf()).toHaveClass(
      'rounded-lg',
      'p-1',
      'outline-1',
      'outline-dashed',
      'outline-border-strong',
      'bg-surface-subtle',
    );
  });

  it('keeps the notice outside the inert body, where it can be read and its links used', async () => {
    const view = mount(frameWith({ notice: <a href="#fix">Fix it</a> }));
    await customize(view);
    expect(screen.getByRole('link', { name: 'Fix it' }).closest('[inert]')).toBeNull();
    expect(screen.getByText('Inside link').closest('[inert]')).not.toBeNull();
    expect(rootOf()).toContainElement(screen.getByRole('link', { name: 'Fix it' }));
  });

  it('shows the drag state: half opacity while dragged, a ring when picked up, neither when idle', async () => {
    const view = mount(frameWith({ dragState: 'idle' }));
    await customize(view);
    expect(rootOf()).not.toHaveClass('opacity-50');
    expect(rootOf()).not.toHaveClass('ring-2');

    view.rerender(<Shell frame={frameWith({ dragState: 'dragging' })} />);
    expect(rootOf()).toHaveClass('opacity-50');

    view.rerender(<Shell frame={frameWith({ dragState: 'picked' })} />);
    expect(rootOf()).toHaveClass('ring-2', 'ring-primary');
    expect(rootOf()).not.toHaveClass('opacity-50');
  });

  it('has no accessibility violations', async () => {
    const view = mount(frameWith());
    await customize(view);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});
