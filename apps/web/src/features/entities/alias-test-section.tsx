'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

import { countsOf, segmentsOf, type AliasTestResult } from './alias-test-segments';
import type { ProjectScope } from './entity-queries';
import { METHOD_KEY } from './labels';
import { EvidenceHighlight, type EntityColorIndex } from '@/components/app/evidence/evidence-highlight';
import { Badge } from '@/components/ui/badge';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { announce } from '@/lib/a11y/announcer';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { formatDecimal, formatInteger } from '@/lib/format/number';

const TEST = apiMutation('post', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/alias-test');
/** The request is sent once typing has paused this long (20 section 5.19.6). */
const TEST_DELAY_MS = 300;
/** The API takes at most 100 KB of text (`413 payload_too_large`). */
const MAX_BYTES = 100 * 1024;
const COUNTER_FROM = MAX_BYTES * 0.8;

type Mention = AliasTestResult['mentions'][number];
type Method = Mention['spans'][number]['match_method'];

const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

const colorOf = (value: number | null): EntityColorIndex | null =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 ? value : null;

/**
 * "Test against a sample answer" (20 section 5.19.6): text pasted here is matched on the server against
 * the project's saved entities and aliases, nothing is stored, and the result shows which spans count,
 * which are uncertain, and what a negative alias dropped.
 */
export function AliasTestSection({
  scope,
  version,
}: {
  scope: ProjectScope;
  /** The project's `entity_config_version`: a change to its entities asks again for the same text. */
  version: number | undefined;
}): ReactNode {
  const t = useTranslations('entitySettings.aliasTest');
  const test = useMutation(TEST);
  const [text, setText] = useState('');
  const settled = useDebouncedValue(text, TEST_DELAY_MS);
  // The last answer, with the text it answers: an answer to an older text is never shown
  const [outcome, setOutcome] = useState<
    | { text: string; version: number | undefined; result: AliasTestResult; problem: null }
    | { text: string; version: number | undefined; result: null; problem: string }
    | null
  >(null);
  const bytes = bytesOf(text);
  const tooLarge = bytes > MAX_BYTES;
  const { mutateAsync } = test;

  useEffect(() => {
    if (settled.trim() === '' || bytesOf(settled) > MAX_BYTES) return undefined;
    // An answer to an older text never replaces the answer to the newer one
    let current = true;
    mutateAsync({
      params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
      body: { text: settled, markdown: null },
    }).then(
      (response) => {
        if (current) setOutcome({ text: settled, version, result: response.data, problem: null });
      },
      (error: unknown) => {
        if (!current) return;
        const problem = isApiProblem(error, 'payload_too_large')
          ? t('tooLarge')
          : isApiProblem(error, 'too_many_matches')
            ? t('tooManyMatches')
            : t('failed');
        setOutcome({ text: settled, version, result: null, problem });
      },
    );
    return () => {
      current = false;
    };
  }, [settled, version, scope.workspaceId, scope.projectId, mutateAsync, t]);

  // What the panel shows: nothing for an empty text, the limit for a text over it, a wait while typing or
  // asking, then the answer or what went wrong, for exactly the text in the field
  const empty = text.trim() === '';
  // An answer is for one text and one version of the project's entities
  const current = outcome !== null && outcome.text === text && outcome.version === version && !empty ? outcome : null;
  const shown = current !== null && current.result !== null ? { text: current.text, result: current.result } : null;
  const problem = tooLarge ? t('tooLarge') : (current?.problem ?? null);
  const waiting = !empty && !tooLarge && current === null;
  const counts = shown === null ? null : countsOf(shown.result);
  const summary = counts === null ? null : t('summary', counts);
  // The counts are read out when they change, as a screen reader would not otherwise hear the result
  useEffect(() => {
    if (summary !== null) announce(summary);
  }, [summary]);

  const methodLabel = (method: Method): string => t(`methods.${METHOD_KEY[method]}`);
  return (
    <section aria-labelledby="alias-test-title" className="flex flex-col gap-4">
      <div>
        <h3 id="alias-test-title" className="type-subsection-title">
          {t('title')}
        </h3>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      <Field invalid={tooLarge} className="max-w-form">
        <FieldLabel>{t('sample')}</FieldLabel>
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('placeholder')}
          counter={
            bytes >= COUNTER_FROM ? t('counter', { used: formatInteger(bytes), max: formatInteger(MAX_BYTES) }) : null
          }
          counterOver={tooLarge}
        />
        <FieldDescription>{t('sampleHint')}</FieldDescription>
      </Field>
      {problem === null ? null : <FormAlert message={problem} />}
      {waiting ? (
        <p className="flex items-center gap-2 type-body text-foreground-secondary" aria-busy="true">
          <Spinner size="sm" />
          {t('testing')}
        </p>
      ) : null}
      {summary === null ? null : (
        <div className="flex max-w-form flex-col gap-3">
          <p className="type-body text-foreground-secondary">{summary}</p>
          {shown === null ? null : (
            <>
              <p className="max-w-reading rounded-lg border border-border bg-surface p-4 type-prose whitespace-pre-wrap">
                {segmentsOf(shown.text, shown.result.mentions).map((segment) =>
                  segment.kind === 'text' ? (
                    <span key={segment.start}>{segment.text}</span>
                  ) : (
                    <EvidenceHighlight
                      key={segment.start}
                      entity={{
                        name: segment.mention.entity.canonical_name,
                        own: segment.mention.entity.role === 'own',
                        colorIndex: colorOf(segment.mention.entity.color_index),
                      }}
                      matchLabel={methodLabel(segment.span.match_method)}
                      confidence={segment.span.score}
                      certainty={segment.span.status === 'accepted' ? 'certain' : 'uncertain'}
                    >
                      {segment.text}
                    </EvidenceHighlight>
                  ),
                )}
              </p>
              {shown.result.mentions.length === 0 ? null : (
                <ul aria-label={t('mentions')} className="flex flex-col rounded-lg border border-border bg-surface">
                  {shown.result.mentions.map((mention) => (
                    <li
                      key={mention.entity.entity_id}
                      className="flex h-row items-center gap-3 border-t border-border-subtle px-4 first:border-t-0"
                    >
                      <span className="min-w-0 flex-1 truncate type-body">{mention.entity.canonical_name}</span>
                      <span className="hidden type-meta sm:inline">
                        {methodLabel(
                          (mention.spans.find((span) => span.status !== 'discarded') ?? mention.spans[0])
                            ?.match_method ?? 'alias_word',
                        )}
                      </span>
                      <span className="num type-meta">
                        {t('spans', { count: mention.spans.filter((span) => span.status !== 'discarded').length })}
                      </span>
                      <span className="num type-meta">{formatDecimal(mention.confidence, 2)}</span>
                      <Badge
                        tone={
                          mention.status === 'accepted'
                            ? 'positive'
                            : mention.status === 'uncertain'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(`status.${mention.status}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {shown.result.skipped_alias_ids.length === 0 ? null : (
                <p className="type-meta">{t('skipped', { count: shown.result.skipped_alias_ids.length })}</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
