import { useQuery } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Upload } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AddMenuEntry } from './add-menu-entries';
import { useAddPrompts } from './use-add-prompts';
import { EmptyState } from '@/components/app/status/empty-state';
import type { MenuItemDef } from '@/components/ui/menu';
import { enginesQuery, type PromptScope } from '../prompt-queries';
import type { PromptsProject } from '../prompts-screen';
import type { Role } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { MOCK_TERMS } from '@/mocks/entity-fixtures';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE: PromptScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const PROJECT: PromptsProject = {
  id: fynix.project_id,
  slug: fynix.slug,
  name: fynix.name,
  timeZone: fynix.timezone,
  defaultLanguage: 'en',
  defaultCountryIso: 'DE',
};
const termId = (name: string): string => {
  const term = MOCK_TERMS.find((candidate) => candidate.name === name);
  if (term === undefined) throw new Error(`The topic fixture ${name} is missing`);
  return term.term_id;
};
const SEO = termId('SEO');
const CONTENT_MARKETING = termId('Content Marketing');

const importCsv = (onSelect: () => void): AddMenuEntry => ({
  id: 'import-csv',
  permission: 'prompts:write',
  item: () => ({ id: 'import-csv', label: 'Import CSV', icon: Upload, onSelect }),
});

const entryOf = (item: MenuItemDef): AddMenuEntry => ({ id: item.id, permission: 'prompts:write', item: () => item });

interface HostProps {
  canWrite?: boolean;
  /** `false`: the engines have not answered, so the hook is told they are not known. */
  enginesKnown?: boolean;
  menuEntries?: readonly AddMenuEntry[];
}

/** What the prompts screen does with the hook: the header, the empty state, a topic's own button, the dialog. */
function Host({ canWrite = true, enginesKnown = true, menuEntries }: HostProps): ReactElement {
  const engines = useQuery(enginesQuery(SCOPE));
  const enabled = engines.data?.data.filter((engine) => engine.is_enabled);
  const [note, setNote] = useState('');
  const add = useAddPrompts({
    scope: SCOPE,
    project: PROJECT,
    engines: enginesKnown ? enabled : undefined,
    canWrite,
    existing: [],
    ...(menuEntries === undefined ? {} : { menuEntries }),
  });
  return (
    <>
      <div role="group" aria-label="Header">
        {add.entry}
      </div>
      <div role="group" aria-label="Empty">
        <EmptyState
          title="No prompts yet"
          reason="Add the questions your buyers ask."
          headingLevel={2}
          primaryAction={add.emptyActions.primary}
          secondaryAction={add.emptyActions.secondary}
        />
      </div>
      <button type="button" onClick={() => add.openAdd(SEO)}>
        Topic menu
      </button>
      <button type="button" onClick={() => add.openAdd(CONTENT_MARKETING)}>
        Topic drawer
      </button>
      <p>{add.canAdd ? 'can add' : 'cannot add'}</p>
      {/* The engines query has answered, whatever the hook was told: a gate asserted before this proves nothing */}
      <p>{engines.data === undefined ? 'engines pending' : 'engines loaded'}</p>
      <input aria-label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      {add.dialog}
    </>
  );
}

function as(role: Role, props: HostProps = {}): ReactElement {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  return (
    <PermissionProvider membership={membershipFactory(role)}>
      <Host canWrite={role === 'editor' || role === 'admin' || role === 'owner'} {...props} />
    </PermissionProvider>
  );
}

const header = (): HTMLElement => screen.getByRole('group', { name: 'Header' });
const empty = (): HTMLElement => screen.getByRole('group', { name: 'Empty' });
const addDialog = (): Promise<HTMLElement> => screen.findByRole('dialog', { name: 'Add prompts' });
/** The engines query has answered: a gate asserted before this is closed for the wrong reason. */
const enginesLoaded = (): Promise<HTMLElement> => screen.findByText('engines loaded');
/** N is left alone: nothing took it, so the browser still has it, and no dialog opened. */
const nIsFree = (): void => {
  expect(fireEvent.keyDown(document.body, { key: 'n' })).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
};

describe('useAddPrompts: N', () => {
  it('opens the dialog from the page and does nothing while typing in a field', async () => {
    const { user } = renderWithProviders(as('editor'));
    await within(header()).findByRole('button', { name: 'Add prompts' });
    await user.click(screen.getByRole('textbox', { name: 'Note' }));
    await user.keyboard('n');
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('n');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(document.body);
    await user.keyboard('n');
    expect(await addDialog()).toBeInTheDocument();
  });

  it('does nothing for a viewer once the engines are known, and before the engines are known', async () => {
    const viewer = renderWithProviders(as('viewer'));
    await enginesLoaded();
    expect(screen.getByText('cannot add')).toBeInTheDocument();
    nIsFree();
    viewer.unmount();

    // The engines answered, but the hook has not been told: the role is not what keeps N off here
    renderWithProviders(as('editor', { enginesKnown: false }));
    await enginesLoaded();
    expect(screen.getByText('cannot add')).toBeInTheDocument();
    nIsFree();
  });

  it('takes N for an editor once the engines are known', async () => {
    renderWithProviders(as('editor'));
    await enginesLoaded();
    await within(header()).findByRole('button', { name: 'Add prompts' });
    expect(fireEvent.keyDown(document.body, { key: 'n' })).toBe(false);
    expect(await addDialog()).toBeInTheDocument();
  });

  it('leaves Shift+N to the import', async () => {
    const { user } = renderWithProviders(as('editor'));
    await within(header()).findByRole('button', { name: 'Add prompts' });
    // A browser reports the upper-case letter for Shift+N
    await user.keyboard('{Shift>}N{/Shift}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('useAddPrompts: the header entry', () => {
  it('is a plain button without alternatives and a split button when the registry has one', async () => {
    const plain = renderWithProviders(as('editor'));
    const button = await within(header()).findByRole('button', { name: 'Add prompts' });
    expect(within(header()).queryByRole('group', { name: 'Add prompts options' })).toBeNull();
    expect(within(header()).getAllByRole('button')).toEqual([button]);
    plain.unmount();

    const onSelect = vi.fn();
    const split = renderWithProviders(as('editor', { menuEntries: [importCsv(onSelect)] }));
    const group = await within(header()).findByRole('group', { name: 'Add prompts options' });
    await split.user.click(within(group).getByRole('button', { name: 'More ways to add prompts' }));
    await split.user.click(await screen.findByRole('menuitem', { name: 'Import CSV' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
    await split.user.click(within(group).getByRole('button', { name: 'Add prompts' }));
    expect(await addDialog()).toBeInTheDocument();
  });

  it('is drawn for no one without prompts:write, and for no one before the engines are known', async () => {
    const viewer = renderWithProviders(as('viewer', { menuEntries: [importCsv(vi.fn())] }));
    await enginesLoaded();
    expect(within(header()).queryByRole('button')).toBeNull();
    viewer.unmount();
    renderWithProviders(as('editor', { enginesKnown: false }));
    await enginesLoaded();
    expect(within(header()).queryByRole('button')).toBeNull();
  });

  it('keeps the label as the accessible name of the icon button below 640 px', async () => {
    renderWithProviders(as('editor'));
    const button = await within(header()).findByRole('button', { name: 'Add prompts' });
    const label = within(button).getByText('Add prompts');
    // sr-only is the label below 640 px (the `sm` breakpoint), shown from it
    expect(label).toHaveClass('sr-only', 'sm:not-sr-only');
  });
});

describe('useAddPrompts: openAdd', () => {
  it('opens the dialog with the topic chosen, from a topic row menu and from the topic drawer', async () => {
    const { user } = renderWithProviders(as('editor'));
    await within(header()).findByRole('button', { name: 'Add prompts' });
    await user.click(screen.getByRole('button', { name: 'Topic menu' }));
    let dialog = await addDialog();
    // The topic is a chip of the topic picker
    expect(await within(dialog).findByText('SEO')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // A new topic is a new form
    await user.click(screen.getByRole('button', { name: 'Topic drawer' }));
    dialog = await addDialog();
    expect(await within(dialog).findByText('Content Marketing')).toBeInTheDocument();
  });

  it('starts the header add with no topic', async () => {
    const { user } = renderWithProviders(as('editor'));
    await user.click(await within(header()).findByRole('button', { name: 'Add prompts' }));
    const dialog = await addDialog();
    // No chip: the picker is an empty field
    expect(within(dialog).getByRole('combobox', { name: /^Topic/ })).toHaveValue('');
    expect(within(dialog).queryByText('SEO')).toBeNull();
    expect(within(dialog).queryByText('Content Marketing')).toBeNull();
  });
});

describe('useAddPrompts: the empty state', () => {
  it('offers Add prompts to an editor, with the registry alternatives beside it, and text only to a viewer', async () => {
    const onSelect = vi.fn();
    const editor = renderWithProviders(as('editor', { menuEntries: [importCsv(onSelect)] }));
    const add = await within(empty()).findByRole('button', { name: 'Add prompts' });
    await editor.user.click(within(empty()).getByRole('button', { name: 'Import CSV' }));
    expect(onSelect).toHaveBeenCalledOnce();
    await editor.user.click(add);
    expect(await addDialog()).toBeInTheDocument();
    editor.unmount();

    renderWithProviders(as('viewer', { menuEntries: [importCsv(vi.fn())] }));
    await enginesLoaded();
    expect(within(empty()).getByRole('heading', { name: 'No prompts yet' })).toBeInTheDocument();
    expect(within(empty()).queryByRole('button')).toBeNull();
  });

  it('offers nothing before the engines are known', async () => {
    renderWithProviders(as('editor', { enginesKnown: false, menuEntries: [importCsv(vi.fn())] }));
    await enginesLoaded();
    expect(within(empty()).queryByRole('button')).toBeNull();
  });

  it('opens a registry link as a link, and does not leave a dead button for it', async () => {
    const link: MenuItemDef = { id: 'import-csv', label: 'Import CSV', kind: 'link', link: <a href="/import" /> };
    renderWithProviders(as('editor', { menuEntries: [entryOf(link)] }));
    await within(empty()).findByRole('button', { name: 'Add prompts' });
    expect(within(empty()).getByRole('link', { name: 'Import CSV' })).toHaveAttribute('href', '/import');
    expect(within(empty()).queryByRole('button', { name: 'Import CSV' })).toBeNull();
  });

  it('says why an alternative is off, reachable by keyboard, and does not run it', async () => {
    const onSelect = vi.fn();
    const off: MenuItemDef = {
      id: 'generate',
      label: 'Generate from keywords',
      disabledReason: 'Choose a keyword list first',
      onSelect,
    };
    const { user } = renderWithProviders(as('editor', { menuEntries: [entryOf(off)] }));
    await within(empty()).findByRole('button', { name: 'Add prompts' });
    const button = within(empty()).getByRole('button', { name: 'Generate from keywords' });
    // The header's split button has two stops and the empty state's Add prompts one before it
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(button).toHaveFocus();
    expect(button).toHaveAccessibleDescription('Choose a keyword list first');
    await user.hover(button);
    await waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip"]')).toHaveTextContent('Choose a keyword list first'),
    );
    await user.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does nothing when openAdd is called by a role that cannot add, or before the engines are known', async () => {
    const viewer = renderWithProviders(as('viewer'));
    await enginesLoaded();
    await viewer.user.click(screen.getByRole('button', { name: 'Topic menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    viewer.unmount();

    const waiting = renderWithProviders(as('editor', { enginesKnown: false }));
    await enginesLoaded();
    await waiting.user.click(screen.getByRole('button', { name: 'Topic menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('useAddPrompts: accessibility', () => {
  it('has no axe violations in the header, the empty state and the open dialog', async () => {
    const { user, container } = renderWithProviders(as('editor', { menuEntries: [importCsv(vi.fn())] }));
    await within(header()).findByRole('group', { name: 'Add prompts options' });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(empty()).getByRole('button', { name: 'Add prompts' }));
    await addDialog();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
