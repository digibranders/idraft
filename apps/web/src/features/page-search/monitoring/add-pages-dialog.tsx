'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type ReactElement } from 'react';

import { suggestionsQuery, trackedIdsQuery, useTrackPages } from '../queries';
import type { SearchScope, TrackPagesAnswer } from '../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsPanel } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger } from '@/lib/format';
import { reasonOf } from '@/lib/internal-links/problem-reason';

/** The most addresses one check takes (spec 10.2). */
const MAX_LINES = 500;
const DEFAULT_LIMIT = 200;

type Source = 'paste' | 'suggested';
type Outcome = TrackPagesAnswer['data'][number];
type BadgeTone = 'positive' | 'neutral' | 'negative';

/** The words of each outcome, and the tone it deserves: ok is good news, already tracked is neutral, a refusal is not. */
const OUTCOME_KEY = {
  ok: 'ok',
  added: 'added',
  already_tracked: 'alreadyTracked',
  invalid_url: 'invalidUrl',
  wrong_host: 'wrongHost',
  not_crawled: 'notCrawled',
  over_limit: 'overLimit',
} as const satisfies Record<Outcome['outcome'], string>;
const OUTCOME_TONE: Readonly<Record<Outcome['outcome'], BadgeTone>> = {
  ok: 'positive',
  added: 'positive',
  already_tracked: 'neutral',
  invalid_url: 'negative',
  wrong_host: 'negative',
  not_crawled: 'negative',
  over_limit: 'negative',
};

/** One address per line, blank lines dropped, at most 500. */
const allLinesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
const linesOf = (text: string): string[] => allLinesOf(text).slice(0, MAX_LINES);

export interface AddPagesDialogProps {
  scope: SearchScope;
  /** The project's website, named in the hint and in the wrong-host outcome; null when the project has none. */
  host: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The number of pages that began to be tracked. */
  onAdded: (count: number) => void;
}

/**
 * Add pages (spec 10.2): paste addresses and check them first (a dry run, so nothing is written), or tick pages
 * Search Console shows most. Only the lines the check found are added.
 */
export function AddPagesDialog({ scope, host, open, onOpenChange, onAdded }: AddPagesDialogProps): ReactElement {
  const t = useTranslations('monitoring.add');
  const common = useTranslations('common');
  const track = useTrackPages(scope);
  const area = useRef<HTMLTextAreaElement>(null);
  const [source, setSource] = useState<Source>('paste');
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<readonly Outcome[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<string | null>(null);

  const tracked = useQuery({ ...trackedIdsQuery(scope), enabled: open });
  const trackedIds = useMemo(() => new Set(tracked.data?.data), [tracked.data]);
  const limit = tracked.data?.meta.limit ?? DEFAULT_LIMIT;
  const suggestions = useQuery({ ...suggestionsQuery(scope), enabled: open && source === 'suggested' });
  const offered = useMemo(
    () => suggestions.data?.data.filter((row) => !trackedIds.has(row.url_id)) ?? [],
    [suggestions.data, trackedIds],
  );

  const ready = useMemo(() => (checked ?? []).filter((one) => one.outcome === 'ok'), [checked]);
  const count = source === 'paste' ? ready.length : picked.size;
  const room = Math.max(limit - trackedIds.size, 0);
  const pastedLines = allLinesOf(text).length;
  const loadFailed = suggestions.isError || tracked.isError;
  const retryLoad = (): void => {
    if (tracked.isError) void tracked.refetch();
    if (suggestions.isError) void suggestions.refetch();
  };

  const reset = (): void => {
    setSource('paste');
    setText('');
    setChecked(null);
    setPicked(new Set());
    setFailure(null);
    track.reset();
  };
  const handleOpenChange = (next: boolean): void => {
    // The request finishes first, so its answer is not lost
    if (!next && track.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  };
  const problem = (lead: string, error: unknown): string =>
    [lead, isApiProblem(error) ? reasonOf(error) : ''].filter((part) => part !== '').join(' ');

  const edit = (next: string): void => {
    setText(next);
    setChecked(null);
    setFailure(null);
  };
  const check = (): void => {
    setFailure(null);
    track.mutate(
      { urls: linesOf(text), dryRun: true },
      {
        onSuccess: (answer) => setChecked(answer.data),
        onError: (error) => setFailure(problem(t('checkFailed'), error)),
      },
    );
  };
  const submit = (): void => {
    if (count === 0 || track.isPending) return;
    setFailure(null);
    track.mutate(source === 'paste' ? { urls: ready.map((one) => one.input) } : { urlIds: [...picked] }, {
      onSuccess: (answer) => {
        const added = answer.meta.added;
        toast({ type: 'success', title: t('added', { count: added }), description: t('addedDetail') });
        reset();
        onOpenChange(false);
        onAdded(added);
      },
      onError: (error) => setFailure(problem(t('failed'), error)),
    });
  };
  const toggle = (urlId: string, on: boolean): void =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(urlId);
      else next.delete(urlId);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} size="md" initialFocus={source === 'paste' ? area : undefined}>
      <DialogHeader title={t('title')} closeLabel={common('close')} />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        {count > room ? <FormAlert tone="warning" message={t('overRoom', { room, limit })} /> : null}
        <Tabs
          variant="underline"
          label={t('title')}
          value={source}
          onValueChange={(next) => {
            setSource(next);
            setFailure(null);
          }}
          items={[
            { value: 'paste', label: t('tabs.paste') },
            { value: 'suggested', label: t('tabs.suggested') },
          ]}
        >
          <TabsPanel value="paste" className="flex flex-col gap-3 pt-4">
            <Field>
              <FieldLabel>{t('urlsLabel')}</FieldLabel>
              <Textarea
                ref={area}
                value={text}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => edit(event.target.value)}
              />
              <FieldDescription>{host === null ? t('urlsHintNoHost') : t('urlsHint', { host })}</FieldDescription>
            </Field>
            {pastedLines > MAX_LINES ? (
              <FormAlert tone="warning" message={t('tooManyLines', { max: MAX_LINES, count: pastedLines })} />
            ) : null}
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={linesOf(text).length === 0}
                loading={track.isPending && checked === null}
                onClick={check}
              >
                {t('check')}
              </Button>
            </div>
            {checked === null ? null : (
              <ul className="flex flex-col rounded-md border border-border px-3">
                {checked.map((one, index) => (
                  <li
                    key={`${String(index)}-${one.input}`}
                    className="flex min-h-9 flex-wrap items-center gap-2 border-t border-border-subtle py-1.5 first:border-t-0"
                  >
                    <span className="min-w-0 flex-1 truncate type-body text-foreground">{one.path ?? one.input}</span>
                    <Badge tone={OUTCOME_TONE[one.outcome]}>
                      {t(
                        one.outcome === 'ok' && one.clicks_28d === null
                          ? 'outcome.okNoClicks'
                          : one.outcome === 'wrong_host' && host === null
                            ? 'outcome.wrongHostNoHost'
                            : `outcome.${OUTCOME_KEY[one.outcome]}`,
                        { clicks: formatInteger(one.clicks_28d ?? 0), host: host ?? '', limit },
                      )}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </TabsPanel>
          <TabsPanel value="suggested" className="flex flex-col gap-3 pt-4">
            <p className="type-body text-foreground-secondary">{t('suggestedIntro')}</p>
            {loadFailed ? (
              <>
                <FormAlert message={t('suggestionsFailed')} />
                <div>
                  <Button variant="secondary" size="sm" onClick={retryLoad}>
                    {common('retry')}
                  </Button>
                </div>
              </>
            ) : suggestions.data === undefined || tracked.data === undefined ? (
              <Skeleton shape="text-12" widthPct={64} />
            ) : offered.length === 0 ? (
              <p className="type-body text-foreground">{t('allTracked')}</p>
            ) : (
              <ul className="flex flex-col">
                {offered.map((row) => (
                  <li key={row.url_id}>
                    <Checkbox
                      checked={picked.has(row.url_id)}
                      onCheckedChange={(on) => toggle(row.url_id, on)}
                      label={
                        <>
                          <span>{row.path}</span>
                          {row.title === null ? null : (
                            <span className="ml-2 text-foreground-secondary">{row.title}</span>
                          )}
                        </>
                      }
                      description={t('suggestedStats', {
                        clicks: formatInteger(row.clicks_28d),
                        impressions: formatInteger(row.impressions_28d),
                      })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </TabsPanel>
        </Tabs>
      </DialogBody>
      <DialogFooter
        start={
          <span className="type-meta text-foreground-secondary">{t('count', { tracked: trackedIds.size, limit })}</span>
        }
        primary={
          <Button
            variant="primary"
            disabled={count === 0 || count > room}
            loading={track.isPending && (source === 'suggested' || checked !== null)}
            onClick={submit}
          >
            {t('submit', { count })}
          </Button>
        }
        secondary={
          <DialogClose>
            <Button type="button" variant="secondary" disabled={track.isPending}>
              {common('cancel')}
            </Button>
          </DialogClose>
        }
      />
    </Dialog>
  );
}
