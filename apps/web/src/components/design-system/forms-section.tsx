'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, Globe, LayoutGrid, List, Monitor, Smartphone, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { DomainInput } from '@/components/app/forms/domain-input';
import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { ErrorSummary } from '@/components/ui/error-summary';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { InputGroup } from '@/components/ui/input-group';
import { MultiSelect } from '@/components/ui/multi-select';
import { OtpField } from '@/components/ui/otp-field';
import { PasswordInput } from '@/components/ui/password-input';
import { RadioGroup } from '@/components/ui/radio-group';
import { ReadOnlyField, ReadOnlyList } from '@/components/ui/read-only-field';
import { SaveBar } from '@/components/ui/save-bar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { SettingRow } from '@/components/ui/setting-row';
import { Switch } from '@/components/ui/switch';
import { Tag } from '@/components/ui/tag';
import { Textarea } from '@/components/ui/textarea';

type Workload = 'rank' | 'ai' | 'audit' | 'backlinks' | 'content';
type Device = 'desktop' | 'mobile' | 'both';
type Action = 'pause' | 'notify';
type View = 'table' | 'cards';

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
const TAG_SUGGESTIONS: readonly string[] = ['brand', 'comparison', 'pricing', 'q4-launch', 'support'];
const PROMPT =
  'Which CRM should a ten-person agency choose if it wants email sequences, a shared inbox and reporting on closed deals, and how do HubSpot, Pipedrive and Zoho compare on price for the first year?';
const WORKLOADS = [
  { value: 'rank', label: 'Rank checks', group: 'Collection' },
  { value: 'ai', label: 'AI visibility', group: 'Collection', description: 'Prompts asked of each engine' },
  { value: 'audit', label: 'Site audit', group: 'Analysis' },
  { value: 'content', label: 'Content briefs', group: 'Analysis' },
  { value: 'backlinks', label: 'Backlinks', group: 'Analysis', disabled: true },
] as const;

const ProjectSchema = z.object({
  name: z.string().min(1, { error: 'Enter a project name' }).max(40, { error: 'Use 40 characters at most' }),
  slug: z
    .string()
    .min(3, { error: 'Use 3 to 40 lower-case letters, digits or hyphens' })
    .regex(/^[a-z0-9-]+$/, { error: 'Use 3 to 40 lower-case letters, digits or hyphens' }),
  device: z.enum(['desktop', 'mobile', 'both']),
  notify: z.boolean(),
});
type ProjectValues = z.infer<typeof ProjectSchema>;
const SAVED: ProjectValues = { name: 'Fynix', slug: 'fynix', device: 'desktop', notify: true };

function LiveForm(): ReactNode {
  const form = useForm<ProjectValues>({
    resolver: zodResolver(ProjectSchema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    defaultValues: SAVED,
  });
  const changed = Object.keys(form.formState.dirtyFields).length;
  return (
    <form
      noValidate
      className="flex w-full max-w-form flex-col rounded-lg border border-border"
      onSubmit={(event) => void form.handleSubmit((values) => form.reset(values))(event)}
    >
      <div className="flex flex-col gap-4 p-4">
        <FormField
          control={form.control}
          name="name"
          label="Project name"
          width="medium"
          description="Shown in the project switcher"
          render={(field) => <Input {...field.controlProps} value={field.value} onValueChange={field.onChange} />}
        />
        <FormField
          control={form.control}
          name="slug"
          label="Slug"
          width="medium"
          render={(field) => <Input {...field.controlProps} value={field.value} onValueChange={field.onChange} />}
        />
        <FormField
          control={form.control}
          name="device"
          label="Device"
          kind="group"
          render={(field) => (
            <SegmentedControl
              semantics="radio"
              label={field.label}
              value={field.value}
              onValueChange={field.onChange}
              focusRef={field.ref}
              aria-required={field.required}
              items={[
                { value: 'desktop', label: 'Desktop' },
                { value: 'mobile', label: 'Mobile' },
                { value: 'both', label: 'Both' },
              ]}
            />
          )}
        />
        <FormField
          control={form.control}
          name="notify"
          label="Notifications"
          kind="group"
          render={(field) => (
            <Checkbox
              ref={field.ref}
              checked={field.value}
              onCheckedChange={field.onChange}
              label="Email me when a rank check fails"
            />
          )}
        />
      </div>
      <SaveBar
        visible={form.formState.isDirty}
        summary={changed === 1 ? '1 unsaved change' : `${String(changed)} unsaved changes`}
        onDiscard={() => form.reset()}
        discardLabel="Discard"
        saveLabel="Save changes"
        className="rounded-b-lg px-4"
      />
    </form>
  );
}

export function FormsSection(): ReactNode {
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [view, setView] = useState<View>('table');
  const [action, setAction] = useState<Action | null>('pause');
  const [cardAction, setCardAction] = useState<Action | null>('notify');
  const [track, setTrack] = useState(true);
  const [digest, setDigest] = useState(true);
  const [favicons, setFavicons] = useState(false);
  const [code, setCode] = useState('');
  const [location, setLocation] = useState<Location | null>(null);
  const [project, setProject] = useState<Project | null>(PROJECTS[0] ?? null);
  const [domain, setDomain] = useState('https://www.hubspot.com/products/crm');
  const [tags, setTags] = useState<readonly string[]>(['pricing', 'q4-launch']);
  const [chosenTags, setChosenTags] = useState<readonly string[]>(['brand']);
  const [aliases, setAliases] = useState<readonly string[]>(['HubSpot CRM']);
  return (
    <>
      <SpecimenGroup title="Field" note="10 section 2. Label, control, then helper text or error, 6 px apart.">
        <SpecimenRow label="Helper, optional, error, disabled">
          <Field width="medium">
            <FieldLabel>Project name</FieldLabel>
            <Input defaultValue="Fynix" />
            <FieldDescription>Shown in the project switcher</FieldDescription>
          </Field>
          <Field width="medium">
            <FieldLabel optional="(optional)">Job title</FieldLabel>
            <Input placeholder="Head of SEO" />
          </Field>
          <Field width="medium" invalid>
            <FieldLabel>Domain</FieldLabel>
            <Input defaultValue="https://fynix" />
            <FieldError message="Enter a domain, for example example.com" />
          </Field>
          <Field width="medium" disabled>
            <FieldLabel>Language</FieldLabel>
            <Input defaultValue="English" />
            <FieldDescription>Choose a location first</FieldDescription>
          </Field>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Input" note="10 section 4. No hover change; the ring marks focus.">
        <SpecimenRow label="sm, md, lg">
          <Input aria-label="Small" size="sm" placeholder="32 px" className="sm:w-40" />
          <Input aria-label="Medium" placeholder="36 px" className="sm:w-40" />
          <Input aria-label="Large" size="lg" placeholder="40 px" className="sm:w-40" />
        </SpecimenRow>
        <SpecimenRow label="Input group">
          <InputGroup prefix="$" suffix="per month" className="sm:w-60">
            <Input aria-label="Monthly limit" variant="bare" defaultValue="250.00" className="num" />
          </InputGroup>
          <InputGroup
            leadingIcon={Globe}
            trailing={<IconButton icon={X} label="Clear" size="icon-xs" />}
            className="sm:w-60"
          >
            <Input aria-label="Domain" variant="bare" defaultValue="fynix.digital" />
          </InputGroup>
        </SpecimenRow>
        <SpecimenRow label="Password">
          <Field width="medium">
            <FieldLabel>Password</FieldLabel>
            <PasswordInput autoComplete="new-password" showLabel="Show password" hideLabel="Hide password" />
          </Field>
          <Field width="medium" invalid>
            <FieldLabel>New password</FieldLabel>
            <PasswordInput autoComplete="new-password" showLabel="Show password" hideLabel="Hide password" size="lg" />
            <FieldError message="Use at least 12 characters" />
          </Field>
        </SpecimenRow>
        <SpecimenRow label="Textarea, counter over the limit">
          <Field width="long">
            <FieldLabel>Sample answer</FieldLabel>
            <Textarea placeholder="Paste an answer from an AI engine" />
          </Field>
          <Field width="long" invalid>
            <FieldLabel>Prompt</FieldLabel>
            <Textarea defaultValue={PROMPT} counter="712 of 700" counterOver />
            <FieldError message="Use 700 characters at most" />
          </Field>
        </SpecimenRow>
        <SpecimenRow label="Domain with its preview">
          <Field width="long">
            <FieldLabel>Domain</FieldLabel>
            <DomainInput value={domain} onValueChange={setDomain} description="The competitor's site" />
          </Field>
        </SpecimenRow>
        <SpecimenRow label="One-time code">
          <Field>
            <FieldLabel>Authentication code</FieldLabel>
            <OtpField value={code} onValueChange={setCode} />
            <FieldDescription>The 6 digits from your authenticator app</FieldDescription>
          </Field>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Select" note="10 section 6.2. Opens below the trigger.">
        <SpecimenRow label="Placeholder, chosen, sm, disabled">
          <Field width="medium">
            <FieldLabel>Workload</FieldLabel>
            <Select value={workload} onValueChange={setWorkload} placeholder="Select a workload" options={WORKLOADS} />
          </Field>
          <Field width="medium">
            <FieldLabel>Workload</FieldLabel>
            <Select
              value="ai"
              onValueChange={setWorkload}
              placeholder="Select a workload"
              options={WORKLOADS}
              size="sm"
            />
          </Field>
          <Field width="medium" disabled>
            <FieldLabel>Workload</FieldLabel>
            <Select value="rank" onValueChange={setWorkload} placeholder="Select a workload" options={WORKLOADS} />
          </Field>
        </SpecimenRow>
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

      <SpecimenGroup
        title="Tag and multi-select"
        note="14 section 2, 10 section 6.4. Chips inside the field; Backspace in the empty field removes the last one."
      >
        <SpecimenRow label="Tags, read-only and removable">
          <Tag label="Brand" />
          {tags.map((tag) => (
            <Tag
              key={tag}
              label={tag}
              onRemove={() => setTags(tags.filter((kept) => kept !== tag))}
              removeLabel={`Remove ${tag}`}
            />
          ))}
        </SpecimenRow>
        <SpecimenRow label="Suggestions, free values">
          <Field width="long">
            <FieldLabel>Tags</FieldLabel>
            <MultiSelect
              value={chosenTags}
              onValueChange={setChosenTags}
              items={TAG_SUGGESTIONS}
              itemToString={(tag) => tag}
              itemKey={(tag) => tag}
              placeholder="pricing"
              emptyText={(query) => `No tags match "${query}"`}
              chipsLabel="Chosen tags"
              removeLabel={(tag) => `Remove ${tag}`}
              chipsHint={(count) =>
                `${String(count)} chosen. From the start of the field, press Left Arrow to reach them.`
              }
              chipHint="Press Backspace or Delete to remove"
            />
          </Field>
          <Field width="long">
            <FieldLabel>Aliases</FieldLabel>
            <MultiSelect
              value={aliases}
              onValueChange={setAliases}
              items={[]}
              itemToString={(alias) => alias}
              itemKey={(alias) => alias.toLocaleLowerCase()}
              creatable={{ label: (query) => `Add "${query}"`, onCreate: (query) => query }}
              placeholder="HubSpot CRM"
              emptyText={() => 'Type a name and press Enter'}
              chipsLabel="Aliases"
              removeLabel={(alias) => `Remove ${alias}`}
              chipsHint={(count) =>
                `${String(count)} aliases. From the start of the field, press Left Arrow to reach them.`
              }
              chipHint="Press Backspace or Delete to remove"
            />
            <FieldDescription>Other names AI answers use for this brand</FieldDescription>
          </Field>
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Checkbox" note="09 section 8.1. A boolean saved with its form.">
        <SpecimenRow label="Checked, unchecked, mixed, disabled">
          <Checkbox checked={track} onCheckedChange={setTrack} label="Track AI visibility" />
          <Checkbox checked={false} label="Both devices" description="Adds two tracked keywords for each keyword" />
          <Checkbox checked="indeterminate" label="Select all" />
          <Checkbox checked label="Desktop" disabled />
          <Checkbox checked={false} label="Mobile" disabled />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Radio group" note="10 section 7. Cards when each option needs a sentence.">
        <SpecimenRow label="List, cards">
          <RadioGroup
            legend="At the hard limit"
            value={action}
            onValueChange={setAction}
            options={[
              { value: 'pause', label: 'Pause collection' },
              { value: 'notify', label: 'Notify only' },
            ]}
          />
          <RadioGroup
            className="w-full sm:w-90"
            legend="At the hard limit"
            presentation="cards"
            value={cardAction}
            onValueChange={setCardAction}
            options={[
              { value: 'pause', label: 'Pause collection', description: 'No checks run until the next month starts.' },
              { value: 'notify', label: 'Notify only', description: 'Checks keep running and may exceed the limit.' },
            ]}
          />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup
        title="Segmented control"
        note="09 section 6. A radio group; the chosen segment is tinted and heavier."
      >
        <SpecimenRow label="Form value (md), view option (sm)">
          <SegmentedControl
            semantics="radio"
            label="Device"
            value={device}
            onValueChange={setDevice}
            items={[
              { value: 'desktop', label: 'Desktop', icon: Monitor },
              { value: 'mobile', label: 'Mobile', icon: Smartphone },
              { value: 'both', label: 'Both' },
            ]}
          />
          <SegmentedControl
            semantics="view"
            label="View"
            size="sm"
            value={view}
            onValueChange={setView}
            items={[
              { value: 'table', label: 'Table', icon: List, count: '986' },
              { value: 'cards', label: 'Cards', icon: LayoutGrid },
            ]}
          />
        </SpecimenRow>
      </SpecimenGroup>

      <SpecimenGroup title="Switch and setting row" note="09 section 8.3. Saves the moment it flips.">
        <div className="flex w-full max-w-form flex-col divide-y divide-border-subtle">
          <SettingRow
            label="Weekly digest"
            description="A summary of rank and visibility changes every Monday"
            control={<Switch checked={digest} onCheckedChange={setDigest} />}
          />
          <SettingRow
            label="Show favicons"
            control={<Switch checked={favicons} onCheckedChange={setFavicons} />}
            error="Could not turn on favicons. Try again."
          />
          <SettingRow label="Pause collection" description="Saving" control={<Switch checked busy />} />
          <SettingRow label="Beta reports" control={<Switch checked={false} disabled />} />
        </div>
      </SpecimenGroup>

      <SpecimenGroup title="Read-only field" note="10 section 20. Selectable, not a tab stop.">
        <ReadOnlyList className="w-full max-w-form">
          <ReadOnlyField label="Workspace ID" value="ws_01J9ZK4T2M8Q" font="mono" />
          <ReadOnlyField
            label="Keyword"
            value="crm pricing"
            reason="The keyword text cannot change. Add a new keyword instead."
          />
        </ReadOnlyList>
      </SpecimenGroup>

      <SpecimenGroup title="Form alert and error summary" note="10 sections 18 and 23.">
        <div className="flex w-full max-w-form flex-col gap-3">
          <FormAlert message="This adds 240 keywords, but only 96 are left in your plan. Remove 144 keywords or archive unused ones." />
          <FormAlert tone="warning" message="Saving restarts today's checks for this project." />
          <ErrorSummary
            title="Fix 2 fields to save"
            errors={[
              { fieldId: 'ds-limit', label: 'Monthly limit', message: 'Enter an amount from $1.00 to $100,000.00' },
              { fieldId: 'ds-soft', label: 'Soft limit', message: 'Enter a percentage from 1 to 100' },
            ]}
          />
          <div className="flex gap-3">
            <Input id="ds-limit" aria-label="Monthly limit" className="sm:w-40" />
            <Input id="ds-soft" aria-label="Soft limit" className="sm:w-40" />
          </div>
        </div>
      </SpecimenGroup>

      <SpecimenGroup
        title="Form with a save bar"
        note="10 sections 13.2 and 18. Change a field to see the bar; submit empty to see the errors."
      >
        <LiveForm />
        <div>
          <Button size="sm" variant="ghost" disabled>
            The bar is sticky at the bottom of a settings page
          </Button>
        </div>
      </SpecimenGroup>
    </>
  );
}
