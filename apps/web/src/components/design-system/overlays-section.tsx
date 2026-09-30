'use client';

import { Archive, ChevronDown, Copy, Ellipsis, ExternalLink, Menu as MenuIcon, Tag, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader, type DialogSize } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import { Popover } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

interface Location {
  id: string;
  name: string;
  kind: 'Countries' | 'Cities';
}
const LOCATIONS: readonly Location[] = [
  { id: 'de', name: 'Germany', kind: 'Countries' },
  { id: 'nl', name: 'Netherlands', kind: 'Countries' },
  { id: 'us', name: 'United States', kind: 'Countries' },
  { id: 'ber', name: 'Berlin', kind: 'Cities' },
  { id: 'bos', name: 'Boston', kind: 'Cities' },
  { id: 'ams', name: 'Amsterdam', kind: 'Cities' },
];
interface Project {
  id: string;
  name: string;
  workspace: string;
}
const PROJECTS: readonly Project[] = [
  { id: 'fynix', name: 'fynix.digital', workspace: 'Digibranders' },
  { id: 'cleanstart', name: 'cleanstart.com', workspace: 'Digibranders' },
  { id: 'eventus', name: 'eventussecurity.com', workspace: 'Digibranders' },
  { id: 'oyechats', name: 'oyechats.com', workspace: 'Digibranders' },
  { id: 'firstfold', name: 'firstfold.io', workspace: 'Digibranders' },
];
const COLUMNS = [
  'Keyword',
  'Rank',
  'Change',
  'Search volume',
  'URL',
  'Location',
  'Device',
  'Tags',
  'Last checked',
  'Intent',
  'Difficulty',
  'Traffic share',
];
const DISCARD = {
  title: 'Discard unsaved changes?',
  description: 'Your changes to this competitor will be lost.',
  keepEditingLabel: 'Keep editing',
  discardLabel: 'Discard changes',
};
type Section = 'overview' | 'serp' | 'competitors';
type Mode = 'rank' | 'visibility';

function DialogDemo({ size, long = false }: { size: DialogSize; long?: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [match, setMatch] = useState<'registrable' | 'host' | 'prefix' | null>('registrable');
  const close = (next: boolean): void => {
    setOpen(next);
    if (!next) setName('');
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>{long ? 'Long body' : `Size ${size}`}</Button>
      <Dialog open={open} onOpenChange={close} size={size} dirty={name !== ''} discard={DISCARD}>
        <DialogHeader
          title="Add competitor"
          description="Tracked for SEO rank and AI share of voice."
          closeLabel="Close"
        />
        <DialogBody>
          <Field width="long">
            <FieldLabel>Name</FieldLabel>
            <Input value={name} onValueChange={setName} placeholder="HubSpot" />
            <FieldDescription>Type something, then press Escape: the dialog asks before it closes.</FieldDescription>
          </Field>
          <Field width="medium">
            <FieldLabel>Domain match</FieldLabel>
            <Select
              value={match}
              onValueChange={setMatch}
              placeholder="Select a match"
              options={[
                { value: 'registrable', label: 'Registrable domain' },
                { value: 'host', label: 'Exact host' },
                { value: 'prefix', label: 'URL prefix' },
              ]}
            />
            <FieldDescription>A list opened inside a dialog comes out above it.</FieldDescription>
          </Field>
          {long
            ? COLUMNS.concat(COLUMNS).map((column, index) => (
                <Field key={`${column}-${String(index)}`} width="long">
                  <FieldLabel>{column}</FieldLabel>
                  <Input />
                </Field>
              ))
            : null}
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button>Cancel</Button>
            </DialogClose>
          }
          primary={
            <Button
              variant="primary"
              onClick={() => {
                close(false);
                toast({ type: 'success', title: `Competitor added: ${name === '' ? 'HubSpot' : name}` });
              }}
            >
              Add competitor
            </Button>
          }
        />
      </Dialog>
    </>
  );
}

export function OverlaysSection(): ReactNode {
  const [intervals, setIntervals] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [confirm, setConfirm] = useState<'plain' | 'typed' | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [location, setLocation] = useState<Location | null>(null);
  const [project, setProject] = useState<Project | null>(PROJECTS[0] ?? null);
  const [section, setSection] = useState<Section>('overview');
  const [mode, setMode] = useState<Mode>('rank');
  const [shown, setShown] = useState<readonly string[]>(COLUMNS.slice(0, 5));
  return (
    <>
      <SpecimenGroup
        title="Popover"
        note="16 section 5.1. Not modal; 280 to 360 px; the body scrolls, the footer stays."
      >
        <SpecimenRow label="List with footer, text">
          <Popover
            trigger={
              <Button>
                Columns <Icon icon={ChevronDown} size="sm" className="text-foreground-muted" />
              </Button>
            }
            title="Columns"
            footer={
              <Button size="sm" variant="ghost" onClick={() => setShown(COLUMNS.slice(0, 5))}>
                Reset
              </Button>
            }
          >
            <div className="flex flex-col gap-1">
              {COLUMNS.map((column) => (
                <Checkbox
                  key={column}
                  label={column}
                  checked={shown.includes(column)}
                  onCheckedChange={(checked) =>
                    setShown(checked ? [...shown, column] : shown.filter((entry) => entry !== column))
                  }
                />
              ))}
            </div>
          </Popover>
          <Popover
            trigger={<Button variant="ghost">How visibility is measured</Button>}
            padding="text"
            width="max"
            aria-label="How visibility is measured"
          >
            <p className="type-prose">
              Visibility is the share of tracked keywords for which the site appears in the top 10, weighted by search
              volume.
            </p>
          </Popover>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Menu" note="09 section 10. Commands and single choices; destructive items last.">
        <SpecimenRow label="Row actions, options">
          <Menu
            trigger={<IconButton icon={Ellipsis} label="More actions" />}
            items={[
              { id: 'open', label: 'Open in new tab', icon: ExternalLink, group: 'Keyword' },
              { id: 'check', label: 'Check now', icon: Tag, group: 'Keyword', disabledReason: '20 of 20 used today' },
              {
                id: 'tag',
                label: 'Add tag',
                icon: Tag,
                group: 'Keyword',
                kind: 'submenu',
                items: [
                  { id: 'crm', label: 'crm' },
                  { id: 'pricing', label: 'pricing' },
                ],
              },
              { id: 'copy', label: 'Copy keyword', icon: Copy, shortcut: ['mod', 'c'] },
              {
                id: 'archive',
                label: 'Archive',
                icon: Archive,
                onSelect: () =>
                  toast({
                    type: 'success',
                    title: '1 keyword archived',
                    action: { label: 'Undo', onAction: () => undefined },
                  }),
              },
              { id: 'delete', label: 'Delete', icon: Trash2, tone: 'destructive', onSelect: () => setConfirm('plain') },
            ]}
          />
          <Menu
            trigger={
              <Button>
                View options <Icon icon={ChevronDown} size="sm" className="text-foreground-muted" />
              </Button>
            }
            items={[
              {
                id: 'intervals',
                label: 'Show intervals',
                kind: 'checkbox',
                checked: intervals,
                onSelect: () => setIntervals(!intervals),
              },
              {
                id: 'light',
                label: 'Light',
                kind: 'radio',
                group: 'Theme',
                checked: theme === 'light',
                onSelect: () => setTheme('light'),
              },
              {
                id: 'dark',
                label: 'Dark',
                kind: 'radio',
                group: 'Theme',
                checked: theme === 'dark',
                onSelect: () => setTheme('dark'),
              },
              {
                id: 'system',
                label: 'System',
                kind: 'radio',
                group: 'Theme',
                checked: theme === 'system',
                onSelect: () => setTheme('system'),
              },
            ]}
          />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Dialog" note="16 section 4. 400, 560 and 720 px; full screen below 640 px.">
        <SpecimenRow label="Sizes, a body that scrolls">
          <DialogDemo size="sm" />
          <DialogDemo size="md" />
          <DialogDemo size="lg" />
          <DialogDemo size="md" long />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Confirm dialog" note="16 section 4.5. Focus starts on Cancel; the scrim does nothing.">
        <SpecimenRow label="Plain, typed confirmation">
          <Button variant="destructive" onClick={() => setConfirm('plain')}>
            Delete 12 keywords
          </Button>
          <Button variant="destructive" onClick={() => setConfirm('typed')}>
            Delete project
          </Button>
          <ConfirmDialog
            open={confirm === 'plain'}
            onOpenChange={(open) => setConfirm(open ? 'plain' : null)}
            title="Delete 12 keywords?"
            description="Their rank history and SERP snapshots are deleted and alert rules stop matching them. Archive keeps the history instead."
            confirmLabel="Delete 12 keywords"
            cancelLabel="Cancel"
            onConfirm={() => new Promise<void>((resolve) => setTimeout(resolve, 900))}
          />
          <ConfirmDialog
            open={confirm === 'typed'}
            onOpenChange={(open) => setConfirm(open ? 'typed' : null)}
            title="Delete fynix.digital?"
            description="The project, its keywords, prompts and all history are deleted for every member. This cannot be undone."
            confirmLabel="Delete project"
            cancelLabel="Cancel"
            typedConfirmation={{
              expected: 'fynix',
              label: (
                <>
                  Type <span className="type-mono text-foreground">fynix</span> to confirm
                </>
              ),
            }}
            onConfirm={() => undefined}
          />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Drawer" note="19 section 3.1. The navigation below 1024 px: modal, from the left.">
        <SpecimenRow label="Navigation drawer">
          <IconButton icon={MenuIcon} label="Open navigation" size="icon" onClick={() => setDrawer(true)} />
          <Drawer open={drawer} onOpenChange={setDrawer} title="Navigation">
            <nav aria-label="Primary" className="flex flex-col gap-1 p-3">
              {['Overview', 'Keywords', 'Topics and prompts', 'Competitors', 'Settings'].map((item) => (
                <Button key={item} variant="ghost" className="justify-start" onClick={() => setDrawer(false)}>
                  {item}
                </Button>
              ))}
            </nav>
          </Drawer>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Toast" note="18 section 3. Three visible at most; errors and toasts with an action stay.">
        <SpecimenRow label="Success, info, error, action, progress">
          <Button size="sm" onClick={() => toast({ type: 'success', title: 'Competitor added: HubSpot' })}>
            Success
          </Button>
          <Button
            size="sm"
            onClick={() => toast({ type: 'info', title: 'Too many requests', description: 'Retrying in 12 seconds' })}
          >
            Info
          </Button>
          <Button
            size="sm"
            onClick={() =>
              toast({
                type: 'error',
                title: 'Import failed: file has no keyword column',
                description: 'Choose a file with a column named keyword, then import again.',
              })
            }
          >
            Error
          </Button>
          <Button
            size="sm"
            onClick={() =>
              toast({
                type: 'success',
                title: '12 keywords archived',
                action: { label: 'Undo', onAction: () => undefined },
              })
            }
          >
            With Undo
          </Button>
          <Button
            size="sm"
            onClick={() => {
              toast({ id: 'export', type: 'progress', title: 'Preparing export' });
              setTimeout(
                () =>
                  toast({
                    id: 'export',
                    type: 'success',
                    title: 'Export ready: rankings.csv',
                    action: { label: 'Download', onAction: () => undefined },
                  }),
                2500,
              );
            }}
          >
            Progress
          </Button>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Tabs" note="09 section 12. Underline for pages and inspectors, segmented inside panels.">
        <div className="flex w-full max-w-form flex-col gap-4">
          <Tabs
            variant="underline"
            label="Keyword sections"
            value={section}
            onValueChange={setSection}
            items={[
              { value: 'overview', label: 'Overview' },
              { value: 'serp', label: 'SERP history', count: '12' },
              { value: 'competitors', label: 'Competitors', count: '4' },
            ]}
          >
            <TabsPanel value="overview" className="pt-3 type-body">
              Rank over time
            </TabsPanel>
            <TabsPanel value="serp" className="pt-3 type-body">
              Twelve snapshots
            </TabsPanel>
            <TabsPanel value="competitors" className="pt-3 type-body">
              Four competitors
            </TabsPanel>
          </Tabs>
          <Tabs
            variant="segmented"
            label="Chart mode"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'rank', label: 'Rank' },
              { value: 'visibility', label: 'Visibility' },
            ]}
          >
            <TabsPanel value="rank" className="pt-3 type-body">
              Rank chart
            </TabsPanel>
            <TabsPanel value="visibility" className="pt-3 type-body">
              Visibility chart
            </TabsPanel>
          </Tabs>
        </div>
      </SpecimenGroup>

      <SpecimenGroup
        title="Combobox"
        note="10 section 6.3. A field with a list, or a button with the search inside the popup."
      >
        <SpecimenRow label="Field with groups, switcher">
          <Field width="long">
            <FieldLabel>Location</FieldLabel>
            <Combobox
              value={location}
              onValueChange={setLocation}
              items={LOCATIONS}
              itemToString={(item) => item.name}
              itemKey={(item) => item.id}
              groupOf={(item) => item.kind}
              emptyText={(query) => `No locations match "${query}"`}
              placeholder="Berlin"
              clearLabel="Clear"
              openLabel="Show locations"
            />
          </Field>
          <Combobox
            value={project}
            onValueChange={(next) => setProject(next ?? project)}
            items={PROJECTS}
            itemToString={(item) => item.name}
            itemKey={(item) => item.id}
            renderItem={(item) => (
              <span className="flex flex-col">
                <span>{item.name}</span>
                <span className="type-meta">{item.workspace}</span>
              </span>
            )}
            emptyText={(query) => `No projects match "${query}"`}
            placeholder="Search projects"
            clearLabel="Clear"
            openLabel="Show projects"
            trigger={
              <Button>
                {project?.name} <Icon icon={ChevronDown} size="sm" className="text-foreground-muted" />
              </Button>
            }
            triggerLabel={`Project: ${project?.name ?? ''}`}
            footer={
              <Button variant="ghost" size="sm" className="w-full justify-start">
                Create project
              </Button>
            }
          />
        </SpecimenRow>
      </SpecimenGroup>
    </>
  );
}
