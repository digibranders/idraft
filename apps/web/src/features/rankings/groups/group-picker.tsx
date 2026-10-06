'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type Ref } from 'react';

import {
  canCreatePath,
  newGroupChoice,
  NO_GROUP_CHOICE,
  useGroupChoices,
  type GroupChoice,
  type GroupChoices,
} from './group-choices';
import { splitPath } from './group-paths';
import type { ProjectScope } from '../rankings-queries';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
import { Combobox } from '@/components/ui/combobox';
import { MultiSelect } from '@/components/ui/multi-select';

interface FieldProps {
  scope: ProjectScope;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onBlur?: (() => void) | undefined;
  id?: string | undefined;
  'aria-required'?: boolean | undefined;
}

const labelOf = (choice: GroupChoice, none: string): string => (choice.kind === 'none' ? none : choice.path);

/**
 * What an empty list says. Until the groups have loaded, or when they could not, it never says there are
 * none: a person would type a name that exists and make it a second time.
 */
function emptyText(
  groups: GroupChoices,
  query: string,
  t: ReturnType<typeof useTranslations<'rankings.groups'>>,
): string {
  if (groups.failed) return t('manage.loadFailed');
  if (!groups.ready) return t('loading');
  return query.trim() === '' ? t('noneYet') : t('empty', { query });
}

/** Several groups, from the project's or typed as a path to create on save. */
export function GroupPicker({
  scope,
  value,
  onValueChange,
  ...field
}: FieldProps & {
  value: readonly GroupChoice[];
  onValueChange: (value: readonly GroupChoice[]) => void;
}): ReactElement {
  const t = useTranslations('rankings.groups');
  const multiSelectHints = useMultiSelectHints();
  const groups = useGroupChoices(scope);
  return (
    <MultiSelect<GroupChoice>
      {...field}
      value={value}
      onValueChange={onValueChange}
      items={groups.choices}
      itemToString={(choice) => labelOf(choice, t('none'))}
      itemKey={(choice) => choice.key}
      creatable={{
        label: (query) => t('create', { path: query.trim() }),
        onCreate: (query) => newGroupChoice(query),
      }}
      // Text left in the field is a search, not a group: a group is made only by choosing its row or Enter
      commitOnBlur={false}
      placeholder={t('pickerPlaceholder')}
      emptyText={(query) => emptyText(groups, query, t)}
      chipsLabel={t('chips')}
      removeLabel={(label) => t('remove', { value: label })}
      {...multiSelectHints}
    />
  );
}

/**
 * One group or none, for "Move to group". The list is filtered here, so a typed path that names no group
 * can be offered first as "Create group".
 */
export function GroupSelect({
  scope,
  value,
  onValueChange,
  ...field
}: FieldProps & {
  value: GroupChoice | null;
  onValueChange: (value: GroupChoice | null) => void;
}): ReactElement {
  const t = useTranslations('rankings.groups');
  const groups = useGroupChoices(scope);
  const [query, setQuery] = useState('');
  const items = useMemo((): GroupChoice[] => {
    const typed = query.trim();
    // A path as the groups are named: "Blog / Guides" is "Blog/Guides", in any case
    const lowered = splitPath(typed).join('/').toLowerCase();
    const listed: GroupChoice[] = [NO_GROUP_CHOICE, ...groups.choices].filter(
      (choice) => typed === '' || labelOf(choice, t('none')).toLowerCase().includes(lowered),
    );
    const exact = groups.choices.some((choice) => choice.path.toLowerCase() === lowered);
    return typed !== '' && !exact && canCreatePath(typed) ? [newGroupChoice(typed), ...listed] : listed;
  }, [groups.choices, query, t]);
  return (
    <Combobox<GroupChoice>
      {...field}
      value={value}
      onValueChange={onValueChange}
      items={items}
      onQueryChange={setQuery}
      itemToString={(choice) => labelOf(choice, t('none'))}
      itemKey={(choice) => choice.key}
      renderItem={(choice) => {
        if (choice.kind === 'new') return t('create', { path: choice.path });
        if (choice.kind === 'none') {
          return (
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{t('none')}</span>
              <span className="type-meta">{t('noneHint')}</span>
            </span>
          );
        }
        return choice.path;
      }}
      placeholder={t('selectPlaceholder')}
      emptyText={(typed) => emptyText(groups, typed, t)}
      clearLabel={t('clear')}
      openLabel={t('open')}
    />
  );
}
