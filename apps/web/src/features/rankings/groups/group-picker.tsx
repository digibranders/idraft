'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type Ref } from 'react';

import { canCreatePath, newGroupChoice, NO_GROUP_CHOICE, useGroupChoices, type GroupChoice } from './group-choices';
import type { ProjectScope } from '../rankings-queries';
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
      placeholder={t('pickerPlaceholder')}
      emptyText={(query) => (query.trim() === '' ? t('noneYet') : t('empty', { query }))}
      chipsLabel={t('chips')}
      removeLabel={(label) => t('remove', { value: label })}
      chipsHint={(count) => t('chipsHint', { count })}
      chipHint={t('chipHint')}
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
    const lowered = typed.toLocaleLowerCase();
    const listed: GroupChoice[] = [NO_GROUP_CHOICE, ...groups.choices].filter(
      (choice) => typed === '' || labelOf(choice, t('none')).toLocaleLowerCase().includes(lowered),
    );
    const exact = groups.choices.some((choice) => choice.path.toLocaleLowerCase() === lowered);
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
      renderItem={(choice) => (choice.kind === 'new' ? t('create', { path: choice.path }) : labelOf(choice, t('none')))}
      placeholder={t('selectPlaceholder')}
      emptyText={(typed) => t('empty', { query: typed })}
      clearLabel={t('clear')}
      openLabel={t('open')}
    />
  );
}
