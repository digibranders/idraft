'use client';

/**
 * The Add number slot and the catalog it opens (docs/superpowers/plans/2026-11-13-ai-wp-16-layouts-customize.md,
 * T4, spec 5.3 and 7.2): a whole cell after the last number, and a popover that lists the numbers the screen offers,
 * SEO first, then the AI metrics with one choice for each engine. An AI number is always for one engine, so no AI
 * metric can be added without one.
 */
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { useLayoutScreen } from '../layout-provider';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover } from '@/components/ui/popover';
import {
  ENGINES,
  LIMITS,
  NUMBER_TYPES,
  canAddNumber,
  type EngineCode,
  type LayoutDocument,
  type NumberDefinition,
  type ScreenKey,
} from '@/lib/layouts';

interface ChoiceProps {
  /** The visible content of the chip. */
  children: ReactNode;
  /** What a screen reader hears; the chip's content is not enough when an engine's name stands for a metric. */
  label?: string | undefined;
  disabled: boolean;
  /** Names the note that says why the chip is off, when it is off because the number is shown. */
  shownNoteId: string | undefined;
  onChoose: () => void;
}

function Choice({ children, label, disabled, shownNoteId, onChoose }: ChoiceProps): ReactElement {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={disabled}
      {...(label === undefined ? {} : { 'aria-label': label })}
      {...(disabled && shownNoteId !== undefined ? { 'aria-describedby': shownNoteId } : {})}
      onClick={onChoose}
    >
      {children}
    </Button>
  );
}

interface CatalogProps {
  screen: ScreenKey;
  document: LayoutDocument;
  onChoose: (metric: string, engine?: EngineCode) => void;
}

/** The body of the popover. It reads the draft, so a number shown after the popover opened is already marked. */
function CatalogBody({ screen, document, onChoose }: CatalogProps): ReactElement {
  const t = useTranslations('layouts.customize.numbers');
  const id = useId();
  const seoId = `${id}-seo`;
  const aiId = `${id}-ai`;
  const shownId = `${id}-shown`;
  const left = LIMITS.numbers - (document.numbers ?? []).length;
  const offered = NUMBER_TYPES.filter((type) => type.screens.includes(screen));
  const seoTypes = offered.filter((type) => !type.perEngine);
  const aiTypes = offered.filter((type) => type.perEngine);
  const isShown = (type: NumberDefinition, engine?: EngineCode): boolean =>
    (document.numbers ?? []).some((number) => number.metric === type.metric && number.engine === engine);
  const noteOf = (type: NumberDefinition, engine?: EngineCode): string | undefined =>
    isShown(type, engine) ? shownId : undefined;

  return (
    <>
      <p className="type-meta">
        {left > 0 ? t('placesLeft', { left, limit: LIMITS.numbers }) : t('full', { limit: LIMITS.numbers })}
      </p>
      <span id={shownId} className="sr-only">
        {t('shown')}
      </span>
      <div role="group" aria-labelledby={seoId} className="flex flex-col gap-1.5">
        <p id={seoId} className="type-label">
          {t('seo')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {seoTypes.map((type) => (
            <Choice
              key={type.metric}
              disabled={!canAddNumber(document, type.metric)}
              shownNoteId={noteOf(type)}
              onChoose={() => {
                onChoose(type.metric);
              }}
            >
              {type.label}
            </Choice>
          ))}
        </div>
      </div>
      <div role="group" aria-labelledby={aiId} className="flex flex-col gap-2">
        <p id={aiId} className="type-label">
          {t('ai')}
        </p>
        {aiTypes.map((type) => (
          <div
            key={type.metric}
            role="group"
            aria-labelledby={`${id}-${type.metric}`}
            className="flex flex-col gap-1.5"
          >
            <p id={`${id}-${type.metric}`} className="type-body text-foreground">
              {type.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ENGINES.map((engine) => (
                <Choice
                  key={engine.code}
                  label={t('engineChoice', { number: type.label, engine: engine.label })}
                  disabled={!canAddNumber(document, type.metric, engine.code)}
                  shownNoteId={noteOf(type, engine.code)}
                  onChoose={() => {
                    onChoose(type.metric, engine.code);
                  }}
                >
                  <EngineLogo engine={engine.code} name={engine.label} />
                </Choice>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The Add number slot: a whole cell of the strip's grid (the strip draws it after the last number while there is
 * room, and counts it in its columns). Choosing a number adds it at the end, closes the popover without giving focus
 * back to the slot, and leaves focus to the handle of the new number, which the provider has asked for.
 */
export function AddNumberSlot(): ReactElement {
  const t = useTranslations('layouts.customize.numbers');
  const { screen, document, actions } = useLayoutScreen();
  const [open, setOpen] = useState(false);
  // Set when a number was added: focus belongs to it, not to the slot. Cleared on each open.
  const added = useRef(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) added.current = false;
        setOpen(next);
      }}
      title={t('catalogTitle')}
      align="end"
      className="w-80"
      finalFocus={() => {
        const restore = !added.current;
        added.current = false;
        return restore;
      }}
      trigger={
        <button
          type="button"
          data-add-number-slot=""
          aria-haspopup="dialog"
          className="relative flex min-h-metric-strip min-w-0 items-center justify-center gap-1.5 border-r border-b border-border-subtle px-4 py-3 type-body-strong whitespace-nowrap text-primary-text hover:bg-surface-hover focus-visible:focus-ring-inset data-popup-open:bg-surface-selected @5xl:px-5"
        >
          <Icon icon={Plus} />
          {t('add')}
        </button>
      }
    >
      <CatalogBody
        screen={screen}
        document={document}
        onChoose={(metric, engine) => {
          added.current = actions.addNumber(metric, engine) !== null;
          setOpen(false);
        }}
      />
    </Popover>
  );
}
