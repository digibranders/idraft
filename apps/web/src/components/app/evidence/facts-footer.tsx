'use client';

import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { CopyButton } from '@/components/app/cells/copy-button';
import { EMPTY_VALUE, formatDecimal, formatInteger } from '@/lib/format';

/** The characters of a SHA-256 the screen shows; a copy puts the whole value on the clipboard. */
const SHORT_HASH_LENGTH = 12;

/** The first 12 characters of a hash: enough to tell two apart by eye, the full value is one copy away. */
export const shortHash = (hash: string): string => hash.slice(0, SHORT_HASH_LENGTH);

/** A hash is there only when the API gave one: null, missing and empty all mean none, never a run of zeros. */
export const hasHash = (hash: string | null | undefined): hash is string => typeof hash === 'string' && hash !== '';

export type HashKind = 'answer' | 'raw';

/** A hash as its short form with a button that copies the full value. */
export function HashCopy({ kind, hash }: { kind: HashKind; hash: string }): ReactElement {
  const t = useTranslations('evidence.hash');
  return (
    <span className="group group/cell inline-flex items-center gap-1">
      <span className="type-mono text-foreground-secondary">{shortHash(hash)}</span>
      <CopyButton
        text={hash}
        label={t(kind === 'answer' ? 'copyAnswer' : 'copyRaw')}
        announcement={t(kind === 'answer' ? 'copiedAnswer' : 'copiedRaw')}
        placement="inline"
        inGrid={false}
      />
    </span>
  );
}

/** What the extractor read of an answer, as the footer shows it. */
export interface FactsFooterFacts {
  ownMentioned: boolean;
  ownDomainCited: boolean;
  /** The place of the brand among the tracked brands the answer names; `null` when it is not named. */
  ownMentionOrder: number | null;
  ownProminence: number | null;
  ownCitationCount: number;
  totalCitationCount: number;
  derivationId: number;
}

export interface FactsFooterProps {
  /** `null` while the answer has not been read yet: every fact then reads as unknown. */
  facts: FactsFooterFacts | null;
  answerSha256?: string | null | undefined;
  rawSha256?: string | null | undefined;
}

interface Row {
  id: string;
  label: string;
  value: ReactNode;
}

/**
 * The facts behind an answer's counts (23-application-patterns.md section 5.5, inventory 15.17): a quiet well with a
 * description list of what the extractor read, the derivation it came from, and the two hashes that identify the
 * answer text and the provider's raw reply. Only facts the API gives are listed; an unknown one is `n/a`, never 0,
 * and a hash the API has not is left out.
 */
export function FactsFooter({ facts, answerSha256, rawSha256 }: FactsFooterProps): ReactElement {
  const t = useTranslations('evidence.facts');
  const hash = useTranslations('evidence.hash');
  const yesNo = (value: boolean): string => t(value ? 'yes' : 'no');
  const rows: Row[] = [
    { id: 'mentioned', label: t('mentioned'), value: facts === null ? EMPTY_VALUE : yesNo(facts.ownMentioned) },
    { id: 'cited', label: t('cited'), value: facts === null ? EMPTY_VALUE : yesNo(facts.ownDomainCited) },
    { id: 'order', label: t('order'), value: <span className="num">{formatInteger(facts?.ownMentionOrder)}</span> },
    {
      id: 'prominence',
      label: t('prominence'),
      value: <span className="num">{formatDecimal(facts?.ownProminence, 3)}</span>,
    },
    {
      id: 'ownCitations',
      label: t('ownCitations'),
      value: <span className="num">{formatInteger(facts?.ownCitationCount)}</span>,
    },
    {
      id: 'totalCitations',
      label: t('totalCitations'),
      value: <span className="num">{formatInteger(facts?.totalCitationCount)}</span>,
    },
    {
      id: 'derivation',
      label: t('derivation'),
      value: facts === null ? EMPTY_VALUE : <span className="num">{String(facts.derivationId)}</span>,
    },
    ...(hasHash(answerSha256)
      ? [{ id: 'answerHash', label: hash('answer'), value: <HashCopy kind="answer" hash={answerSha256} /> }]
      : []),
    ...(hasHash(rawSha256)
      ? [{ id: 'rawHash', label: hash('raw'), value: <HashCopy kind="raw" hash={rawSha256} /> }]
      : []),
  ];
  return (
    <dl
      aria-label={t('label')}
      data-slot="facts-footer"
      className="grid grid-cols-5 gap-x-4 gap-y-2 rounded-md bg-surface-subtle p-3"
    >
      {rows.map((row) => (
        <div key={row.id} className="col-span-5 grid grid-cols-subgrid">
          <dt className="col-span-2 min-w-0 type-label wrap-anywhere">{row.label}</dt>
          <dd className="col-span-3 min-w-0 type-body wrap-anywhere text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
