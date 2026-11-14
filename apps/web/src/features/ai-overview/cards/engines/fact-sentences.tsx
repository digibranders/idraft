'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, type ReactElement, type ReactNode } from 'react';

import { engineLabel } from './engine-role';
import { factNumbers, type Fact } from './facts-model';
import { useCardDrill } from './use-card-seams';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { TextLink } from '@/components/ui/text-link';
import { formatDecimal, formatPercent, formatPointsDelta } from '@/lib/format';

/*
 * The words of the facts (CH-37): one ICU message of `aiOverview.engines.changeSummary` per fact kind, filled from
 * the fact's params. A fact is data (`facts-model.ts`) and holds no text; here the kind picks the message and the
 * link wraps the figure the message marks with `<figure>`.
 */

type Values = Record<string, string | number>;

/** What the message of a fact kind is filled with: counts as numbers (the message formats them), rates as text. */
function sentenceValues(fact: Fact, engineName: (code: string) => string): Values {
  switch (fact.kind) {
    case 'collection':
      return { ...fact.params, engine: engineName(fact.params.engine) };
    case 'engineChange': {
      const { engine, rate, before, delta, ...counts } = fact.params;
      return {
        ...counts,
        engine: engineName(engine),
        rate: formatPercent(rate),
        before: formatPercent(before),
        direction: delta >= 0 ? 'up' : 'down',
        points: formatDecimal(Math.abs(delta) * 100, 1),
      };
    }
    case 'gainedLost':
      return { ...fact.params, engine: engineName(fact.params.engine) };
    case 'withinVariation':
    case 'noPrevious':
    case 'newSources':
      return { ...fact.params };
  }
}

/** The keys of the "Numbers" cell of the Table view, one per fact kind. */
const NUMBERS_KEY = {
  collection: 'numbersCollection',
  engineChange: 'numbersEngineChange',
  withinVariation: 'numbersWithinVariation',
  noPrevious: 'numbersNoPrevious',
  gainedLost: 'numbersGainedLost',
  newSources: 'numbersNewSources',
} as const satisfies Record<Fact['kind'], string>;

function numbersValues(fact: Fact): Values {
  const numbers = factNumbers(fact);
  switch (fact.kind) {
    case 'collection':
      return { count: fact.params.notValid, of: fact.params.all, days: fact.params.days };
    case 'engineChange':
      return {
        ...fact.params,
        points: formatPointsDelta(numbers.changePoints === null ? null : numbers.changePoints / 100),
      };
    case 'withinVariation':
      return { count: fact.params.engines };
    case 'noPrevious':
      return { days: fact.params.days };
    case 'gainedLost':
      return { ...fact.params };
    case 'newSources':
      return { ...fact.params };
  }
}

/** One fact as a sentence, in text and with the link of its figure (`useCardDrill`); plain text where it gives none. */
export function FactSentence({ fact }: { fact: Fact }): ReactElement {
  const t = useTranslations('aiOverview.engines.changeSummary');
  const common = useTranslations('aiOverview.engines.common');
  const drill = useCardDrill();
  const href = fact.link === null ? null : drill(fact.link.destination, { engine: fact.link.engine });
  const engineName = (code: string): string => engineLabel(code) ?? common('unknownEngine');
  return (
    <>
      {t.rich(fact.kind, {
        ...sentenceValues(fact, engineName),
        figure: (chunks: ReactNode): ReactElement =>
          href === null ? (
            <span className="num">{chunks}</span>
          ) : (
            <TextLink variant="inline" render={<Link href={href} />}>
              <span className="num">{chunks}</span>
            </TextLink>
          ),
      })}
    </>
  );
}

/** The words a fact is made of, as plain text: the sentence, its numbers and its engine, for the summary, the Table view and the CSV. */
export function useFactText(): {
  sentence: (fact: Fact) => string;
  numbers: (fact: Fact) => string;
  engine: (fact: Fact) => string;
} {
  const t = useTranslations('aiOverview.engines.changeSummary');
  const common = useTranslations('aiOverview.engines.common');
  const engineName = useCallback((code: string): string => engineLabel(code) ?? common('unknownEngine'), [common]);
  const sentence = useCallback(
    (fact: Fact): string =>
      t.markup(fact.kind, {
        ...sentenceValues(fact, engineName),
        figure: (chunks: string): string => chunks,
      }),
    [t, engineName],
  );
  const numbers = useCallback((fact: Fact): string => t(NUMBERS_KEY[fact.kind], numbersValues(fact)), [t]);
  const engine = useCallback(
    (fact: Fact): string => ('engine' in fact.params ? engineName(fact.params.engine) : t('tableAllEngines')),
    [t, engineName],
  );
  return { sentence, numbers, engine };
}

const RULES = ['rulesOrder', 'rulesChange', 'rulesGained', 'rulesSources', 'rulesNever'] as const;

/** The "How this is written" button and the popover that lists the rules of the facts in plain words. */
export function HowThisIsWritten(): ReactElement {
  const t = useTranslations('aiOverview.engines.changeSummary');
  return (
    <Popover
      trigger={
        <Button size="sm" variant="ghost">
          {t('howWritten')}
        </Button>
      }
      title={t('rulesTitle')}
      padding="text"
    >
      <p className="type-body text-foreground-secondary">{t('rulesIntro')}</p>
      <ul className="flex list-disc flex-col gap-2 pl-4 type-body text-foreground">
        {RULES.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
    </Popover>
  );
}
