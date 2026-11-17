import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PromptDrawerHost } from './prompt-drawer-host';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { PromptOrderContext } from '@/lib/inspector/prompt-order';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { FIXTURE_PROMPTS } from '@/mocks/prompt-fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

// jsdom has no canvas: the History tab's chart is a frame here
vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const [first, second] = FIXTURE_PROMPTS.get(fynix.project_id) ?? [];
if (first === undefined || second === undefined) throw new Error('The fixture prompts are missing');

// Function declarations are hoisted, so the narrowing above does not reach them: keep what they read in constants
const PROJECT_ID = fynix.project_id;
const FIRST_ID = first.prompt_id;
const inspectOf = (target: string): string => `inspect=${encodeURIComponent(target)}`;

function setup(searchParams: string, order: readonly string[] = [FIRST_ID]) {
  return renderWithProviders(
    <PermissionProvider membership={membershipFactory('viewer')}>
      <PromptOrderContext.Provider value={order}>
        <InspectorLayout
          inspector={
            <PromptDrawerHost
              workspaceId={MOCK_WORKSPACE.workspace_id}
              projectId={PROJECT_ID}
              timeZone="Europe/Berlin"
            />
          }
        >
          <main />
        </InspectorLayout>
      </PromptOrderContext.Provider>
    </PermissionProvider>,
    { searchParams },
  );
}

beforeEach(() => {
  stubWideScreen();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('viewer').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

afterEach(() => restoreWideScreen());

describe('the prompt inspector on another page', () => {
  it('opens the prompt the address names, with its place in the order the page gave', async () => {
    setup(inspectOf(`prompt:${first.prompt_id}`));
    const inspector = await screen.findByRole('complementary', { name: first.text });
    expect(within(inspector).getByText('1 of 1')).toBeVisible();
  });

  it('steps through the order the page gave', async () => {
    const { user } = setup(inspectOf(`prompt:${first.prompt_id}`), [first.prompt_id, second.prompt_id]);
    const inspector = await screen.findByRole('complementary', { name: first.text });
    expect(within(inspector).getByText('1 of 2')).toBeVisible();
    await user.keyboard('j');
    expect(await screen.findByRole('complementary', { name: second.text })).toBeVisible();
  });

  it('shows nothing when the address names another kind of record', () => {
    setup(inspectOf('cited-page:1'));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('shows nothing when the address names no record', () => {
    setup('');
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
