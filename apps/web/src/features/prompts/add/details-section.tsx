'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactElement } from 'react';
import { useWatch, type Control } from 'react-hook-form';

import {
  BRANDED_CHOICES,
  FUNNEL_STAGES,
  IMPORTANCES,
  INTENTS,
  PROMPT_TYPES,
  DEFAULT_IMPORTANCE,
  type AddValues,
  type BrandedChoice,
  type FunnelStage,
  type Importance,
  type Intent,
  type PromptType,
  type PromptTypeChoice,
} from './add-values';
import { FormField } from '@/components/app/forms/form-field';
import { Button } from '@/components/ui/button';
import { RadioGroup } from '@/components/ui/radio-group';
import { Select } from '@/components/ui/select';

/** The catalog key of each prompt type: keys are camelCase, the API's values are snake case. */
const TYPE_KEY = {
  question: 'question',
  comparison: 'comparison',
  recommendation: 'recommendation',
  how_to: 'howTo',
  definition: 'definition',
  local: 'local',
  transactional: 'transactional',
  other: 'other',
} as const satisfies Record<PromptType, string>;

type DetailsTranslate = ReturnType<typeof useTranslations<'prompts.add.details'>>;
type DetailsValues = Pick<AddValues, 'prompt_type' | 'intent' | 'funnel_stage' | 'importance' | 'branded'>;

/** What a closed section says: the type always, then each detail the person changed. */
export function detailsSummary(values: DetailsValues, t: DetailsTranslate): string {
  return [
    values.prompt_type === 'auto'
      ? t('summary.typeAuto')
      : t('summary.type', { value: t(`types.${TYPE_KEY[values.prompt_type]}`) }),
    ...(values.intent === 'unknown' ? [] : [t('summary.intent', { value: t(`intents.${values.intent}`) })]),
    ...(values.funnel_stage === 'unknown' ? [] : [t('summary.stage', { value: t(`stages.${values.funnel_stage}`) })]),
    ...(values.importance === DEFAULT_IMPORTANCE
      ? []
      : [t('summary.importance', { value: t(`importances.level${values.importance}`) })]),
    ...(values.branded === 'auto' ? [] : [t(`summary.${values.branded}`)]),
  ].join(', ');
}

/**
 * Type, intent, stage, importance and branded (prompt-dialogs 4.3), closed under a line that says what they are
 * set to. Every field stays in the form while the section is closed, so the discard question and the add see
 * them. "Set from wording" and "Set from brand names" send nothing: the server rules decide.
 */
export function DetailsSection({ control }: { control: Control<AddValues> }): ReactElement {
  const t = useTranslations('prompts.add.details');
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const values = useWatch({ control });
  const summary = detailsSummary(
    {
      prompt_type: values.prompt_type ?? 'auto',
      intent: values.intent ?? 'unknown',
      funnel_stage: values.funnel_stage ?? 'unknown',
      importance: values.importance ?? DEFAULT_IMPORTANCE,
      branded: values.branded ?? 'auto',
    },
    t,
  );
  const typeOptions = [
    { value: 'auto' as PromptTypeChoice, label: t('typeAuto') },
    ...PROMPT_TYPES.map((value) => ({ value: value as PromptTypeChoice, label: t(`types.${TYPE_KEY[value]}`) })),
  ];
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="ghost"
        size="sm"
        icon={open ? ChevronDown : ChevronRight}
        aria-expanded={open}
        aria-controls={regionId}
        className="self-start"
        onClick={() => setOpen(!open)}
      >
        {t('title')}
        <span className="type-meta text-foreground-secondary">{summary}</span>
      </Button>
      <div id={regionId} hidden={!open} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={control}
            name="prompt_type"
            label={t('type')}
            render={(field) => (
              <Select<PromptTypeChoice>
                {...field.controlProps}
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('type')}
                options={typeOptions}
              />
            )}
          />
          <FormField
            control={control}
            name="intent"
            label={t('intent')}
            render={(field) => (
              <Select<Intent>
                {...field.controlProps}
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('intent')}
                options={INTENTS.map((value) => ({ value, label: t(`intents.${value}`) }))}
              />
            )}
          />
          <FormField
            control={control}
            name="funnel_stage"
            label={t('stage')}
            render={(field) => (
              <Select<FunnelStage>
                {...field.controlProps}
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('stage')}
                options={FUNNEL_STAGES.map((value) => ({ value, label: t(`stages.${value}`) }))}
              />
            )}
          />
          <FormField
            control={control}
            name="importance"
            label={t('importance')}
            render={(field) => (
              <Select<Importance>
                {...field.controlProps}
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t('importance')}
                options={IMPORTANCES.map((value) => ({ value, label: t(`importances.level${value}`) }))}
              />
            )}
          />
        </div>
        <FormField
          control={control}
          name="branded"
          label={t('branded')}
          kind="group"
          render={(field) => (
            <RadioGroup<BrandedChoice>
              legend={field.label}
              name={field.controlProps.name}
              value={field.value}
              onValueChange={field.onChange}
              options={BRANDED_CHOICES.map((value) => ({ value, label: t(`brandedChoices.${value}`) }))}
            />
          )}
        />
      </div>
    </div>
  );
}
