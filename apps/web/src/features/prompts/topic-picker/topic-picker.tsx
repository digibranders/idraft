'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type Ref } from 'react';

import {
  buildTopicChoices,
  createTarget,
  MAX_TOPIC_DEPTH,
  MAX_TOPIC_NAME,
  MAX_TOPIC_TERMS,
  newTopicChoice,
  nextTopicValue,
  selectionOf,
  splitTopicPath,
  type TopicChoice,
  type TopicProblem,
  type TopicSelection,
} from './topic-picker-model';
import { useMultiSelectHints } from '@/components/app/forms/use-multi-select-hints';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import { announce } from '@/lib/a11y/announcer';
import { canWriteSharedTaxonomy, useCan, useMembership } from '@/lib/permissions';
import { useVocabularies, type TaxonomyScope } from '@/lib/keywords/taxonomy-reads';

export interface TopicPickerProps {
  scope: TaxonomyScope;
  /** What the form holds: terms that exist and paths to make when it is saved (`useEnsureTopics`). */
  value: readonly TopicSelection[];
  onValueChange: (value: readonly TopicSelection[]) => void;
  /** The text field's id, so the form's label can name it. */
  id?: string | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onBlur?: (() => void) | undefined;
  'aria-required'?: boolean | undefined;
}

const itemToString = (choice: TopicChoice): string => choice.label;
const itemKey = (choice: TopicChoice): string => choice.key;

/**
 * The topics and tags of a prompt: a `MultiSelect` over the terms of the vocabularies the project sees, the
 * topics first (a child shows its parents in its path) and the tags after them as "Vocabulary: term". The
 * list is flat because the primitive is: depth shows in the path, not in indentation or `aria-level`, and the
 * chip says "CRM / Startups". A typed name or path can be made when the person may write taxonomy; it is held
 * as a new topic and made only when the form is saved. A prompt takes at most 20 terms and one of a
 * single-valued vocabulary's.
 */
export function TopicPicker({ scope, value, onValueChange, ...field }: TopicPickerProps): ReactElement {
  const t = useTranslations('prompts.add.topicPicker');
  const common = useTranslations('common');
  const hints = useMultiSelectHints();
  const vocabularies = useVocabularies(scope);
  const membership = useMembership();
  const canWrite = useCan('taxonomy:write');
  const [problem, setProblem] = useState<TopicProblem | null>(null);

  const choices = useMemo(
    () => buildTopicChoices(vocabularies.loaded, (vocabulary, path) => t('tagLabel', { vocabulary, path })),
    [vocabularies.loaded, t],
  );
  const target = useMemo(
    () =>
      createTarget(vocabularies.loaded, scope.projectId, {
        canWrite,
        canWriteShared: canWriteSharedTaxonomy(membership),
      }),
    [vocabularies.loaded, scope.projectId, canWrite, membership],
  );
  const newLabel = (path: string): string => t('newLabel', { path });

  // The form's value as choices; a term not known yet (loading, or its vocabulary failed) stays in the value
  const unresolved: TopicSelection[] = [];
  const chosen: TopicChoice[] = [];
  const unknownMayLoad = vocabularies.pending || vocabularies.error;
  for (const selection of value) {
    if (selection.kind === 'existing') {
      const choice = choices.find((entry) => entry.termId === selection.termId);
      if (choice !== undefined) chosen.push(choice);
      else if (unknownMayLoad) unresolved.push(selection);
    } else {
      const vocabulary = vocabularies.loaded.find((entry) => entry.vocabulary.vocabulary_id === selection.vocabularyId);
      chosen.push(
        newTopicChoice(
          selection.path,
          vocabulary?.vocabulary ?? { vocabulary_id: selection.vocabularyId, name: '', is_single_valued: false },
          newLabel,
        ),
      );
    }
  }

  const problemText = (entry: TopicProblem): string => {
    switch (entry.code) {
      case 'tooMany':
        return t('tooMany', { max: MAX_TOPIC_TERMS });
      case 'single':
        return t('single', { vocabulary: entry.vocabulary });
      case 'pathEmpty':
        return t('pathEmpty');
      case 'pathTooLong':
        return t('pathTooLong', { max: MAX_TOPIC_NAME });
      case 'pathTooDeep':
        return t('pathTooDeep', { max: MAX_TOPIC_DEPTH });
    }
  };

  const change = (next: readonly TopicChoice[]): void => {
    const result = nextTopicValue(chosen, next, choices);
    setProblem(result.problem);
    if (result.problem !== null) announce(problemText(result.problem), { key: 'topic-picker' });
    onValueChange([...unresolved, ...result.value.map(selectionOf)]);
  };

  const loadedNone = vocabularies.loaded.length === 0;
  const failed = vocabularies.error;
  useEffect(() => {
    if (failed)
      announce(loadedNone ? t('loadFailed') : t('partial'), { key: 'topic-picker-load', politeness: 'assertive' });
  }, [failed, loadedNone, t]);

  // Never says there are none while the topics load or could not be read: a person would type one that exists
  const emptyText = (query: string): string => {
    if (failed && loadedNone) return t('loadFailed');
    if (query.trim() !== '') {
      return target === null ? t('noMatchReadOnly', { query: query.trim() }) : t('noMatch', { query: query.trim() });
    }
    if (choices.length > 0) return t('allChosen');
    return target === null ? t('noneYetReadOnly') : t('noneYet');
  };

  const loading = vocabularies.pending && loadedNone && !failed;
  return (
    <div className="flex flex-col gap-1.5">
      <MultiSelect<TopicChoice>
        {...field}
        {...hints}
        value={chosen}
        onValueChange={change}
        items={choices}
        itemToString={itemToString}
        itemKey={itemKey}
        creatable={
          target === null
            ? undefined
            : {
                // The typed text as typed: the list keeps only rows that contain it, so "CRM/Startups" must stay in the row
                label: (query) =>
                  splitTopicPath(query).length > 1
                    ? t('createPath', { path: query.trim() })
                    : t('create', { name: query.trim() }),
                onCreate: (query) => newTopicChoice(query, target, newLabel),
              }
        }
        // Text left in the field is a search, not a topic: a topic is held only by choosing its row or Enter
        commitOnBlur={false}
        placeholder={loading ? t('loading') : t('placeholder')}
        emptyText={emptyText}
        chipsLabel={t('chips')}
        removeLabel={(label) => t('remove', { value: label })}
        disabled={loading}
      />
      {failed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="type-meta text-negative-text">{loadedNone ? t('loadFailed') : t('partial')}</p>
          <Button variant="ghost" size="sm" onClick={vocabularies.retry}>
            {common('retry')}
          </Button>
        </div>
      ) : null}
      {problem === null ? null : (
        // Choosing a second term of a single-valued vocabulary explains itself; the other problems refuse
        <p
          className={problem.code === 'single' ? 'type-meta text-foreground-secondary' : 'type-meta text-negative-text'}
        >
          {problemText(problem)}
        </p>
      )}
      <p className="type-meta text-foreground-secondary">{t('hint')}</p>
    </div>
  );
}
