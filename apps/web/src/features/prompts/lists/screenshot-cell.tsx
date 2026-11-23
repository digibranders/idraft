'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { AnswerDialog, type AnswerCitations } from './answer-dialog';
import type { LatestAnswer } from '../facts';
import { aiKey, CAPTURE_SCREENSHOT, isObservationId, observationQuery, type PromptScope } from '../prompt-queries';
import type { CitationListItem } from '@/components/app/evidence/citation-list';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { ApiProblem } from '@/lib/api/problem';
import type { CitationOut } from '@/lib/api/types';
import { EMPTY_VALUE, formatTableDate, formatUnitPrice } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

/** What a screenshot costs the project, once, whoever opens it afterwards (DataForSEO `/v3/serp/screenshot`). */
export const SCREENSHOT_PRICE_USD = 0.004;

/**
 * What the cell shows for an answer. `open`: a stored image, opened from a button with the day. `get`: none yet, and
 * the person may take one. `readOnly`: none yet and the person may not spend (a reader), or the API says one is stored
 * but sends no path. `expired`: none, and too late. `unsupported`: the platform has no page to photograph.
 */
export type ScreenshotView = 'open' | 'get' | 'readOnly' | 'expired' | 'unsupported';

export function screenshotViewOf(latest: LatestAnswer, canCapture: boolean): ScreenshotView {
  if (latest.screenshot_url !== null) return 'open';
  switch (latest.screenshot_state) {
    case 'capturable':
      return canCapture ? 'get' : 'readOnly';
    case 'expired':
      return 'expired';
    case 'unsupported':
      return 'unsupported';
    case 'available':
      return 'readOnly';
  }
}

export interface ScreenshotCellProps {
  /** The newest answer of the platform for the row, with the state of its screenshot. */
  latest: LatestAnswer;
  platform: { code: string; name: string };
  promptText: string;
  timeZone: string;
  /** The workspace and project, for the capture and for the cited pages the dialog lists. */
  project: PromptScope;
  /** The person may spend on a screenshot (`runs:trigger`). */
  canCapture: boolean;
}

/** The cited pages of an answer as the list draws them: the dialog does not offer "Show in answer". */
function citationItemsOf(citations: readonly CitationOut[]): CitationListItem[] {
  return citations.map((citation) => ({
    index: citation.citation_index,
    title: citation.title ?? citation.host,
    url: citation.url,
    rawUrl: citation.raw_url,
    host: citation.host,
    role: citation.domain_role,
    quote: null,
    flags: citation.flags,
    inAnswer: false,
  }));
}

/** Why the last press left no image, for the answer it was pressed on. `failed` is the only one that can be tried again. */
type Refusal = 'failed' | 'expired' | 'unsupported' | 'unavailable' | 'budget';

const REFUSALS: Readonly<Record<string, Exclude<Refusal, 'failed'>>> = {
  screenshot_expired: 'expired',
  screenshot_unsupported: 'unsupported',
  screenshots_unavailable: 'unavailable',
  budget_exceeded: 'budget',
};

/**
 * The Screenshot cell of one platform. One button holds its place through every state, so focus never lands on a
 * removed element: with a stored image it has the image icon and the day of the latest answer and opens the answer's
 * dialog; without one a person who may spend gets Get screenshot (one provider call, kept for everyone after it), which
 * is loading while the call runs and becomes Try again after a failure. A refusal turns it into a disabled button that
 * says why (Expired, n/a, Not available, Budget reached). A reader, an answer past the provider's window and a platform
 * without a page get a word (the column gives each its reason). What a press did belongs to the answer it was pressed
 * on: a newer answer in the row starts again. The dialog sits in the cell, so a click inside it never opens the row
 * behind it.
 */
export function ScreenshotCell({
  latest,
  platform,
  promptText,
  timeZone,
  project,
  canCapture,
}: ScreenshotCellProps): ReactElement {
  const t = useTranslations('prompts.lists.shot');
  const queryClient = useQueryClient();
  const capture = useMutation(CAPTURE_SCREENSHOT);
  const [open, setOpen] = useState(false);
  const [taken, setTaken] = useState<{ observationId: string; url: string; truncated: boolean } | null>(null);
  const [refusal, setRefusal] = useState<{ observationId: string; kind: Refusal } | null>(null);
  const mine = taken?.observationId === latest.observation_id ? taken : null;
  const refused = refusal?.observationId === latest.observation_id ? refusal.kind : null;
  const url = mine?.url ?? latest.screenshot_url;
  const view = url !== null ? 'open' : screenshotViewOf(latest, canCapture);
  const citations = useQuery({
    ...observationQuery(project, latest.observation_id, latest.observed_at),
    enabled: open && url !== null,
  });
  const citationState: AnswerCitations = citations.isError
    ? { status: 'failed' }
    : citations.data === undefined
      ? { status: 'loading' }
      : { status: 'ready', items: citationItemsOf(citations.data.data.citations) };

  const take = async (): Promise<void> => {
    const observationId = latest.observation_id;
    const fail = (kind: Refusal): void => setRefusal({ observationId, kind });
    setRefusal(null);
    if (!isObservationId(observationId)) {
      fail('failed');
      return;
    }
    try {
      const answer = await capture.mutateAsync({
        params: {
          path: {
            workspace_id: project.workspaceId,
            project_id: project.projectId,
            observation_id: Number(observationId),
          },
          query: { observed_at: latest.observed_at },
        },
      });
      setTaken({ observationId, url: answer.data.url, truncated: answer.data.truncated });
      setOpen(true);
    } catch (error) {
      fail((error instanceof ApiProblem ? REFUSALS[error.code] : undefined) ?? 'failed');
    } finally {
      // The row now has a stored image, or is past the window: the summary says which
      void queryClient.invalidateQueries({ queryKey: aiKey(project) });
    }
  };

  const showsButton = view === 'open' || view === 'get' || (refused !== null && refused !== 'failed');
  if (!showsButton) {
    return <span className="text-foreground-tertiary">{view === 'expired' ? t('expired') : EMPTY_VALUE}</span>;
  }
  const settled = view === 'open' ? null : refused === 'failed' || refused === null ? null : refused;
  const failed = view !== 'open' && refused === 'failed';
  const words = {
    expired: { text: t('expired'), tip: t('expiredTip') },
    unsupported: { text: EMPTY_VALUE, tip: t('unsupportedTip') },
    unavailable: { text: t('unavailable'), tip: t('unavailableTip') },
    budget: { text: t('budget'), tip: t('budgetTip') },
  } as const;
  const tip =
    view === 'open'
      ? undefined
      : settled !== null
        ? words[settled].tip
        : t(failed ? 'failed' : 'getTip', { price: formatUnitPrice(SCREENSHOT_PRICE_USD) });
  const name =
    view === 'open'
      ? t('openLabel', { platform: platform.name, prompt: promptText })
      : settled !== null
        ? words[settled].text
        : failed
          ? t('retryLabel', { platform: platform.name, prompt: promptText })
          : t('getLabel', { platform: platform.name, prompt: promptText });
  return (
    <>
      <Tooltip content={tip ?? ''} disabled={tip === undefined}>
        <Button
          size="sm"
          className="h-6 px-1.5"
          icon={view === 'open' ? Image : settled === null && !failed ? Image : TriangleAlert}
          aria-label={name}
          aria-haspopup={view === 'open' ? 'dialog' : undefined}
          loading={capture.isPending}
          // A refusal leaves nothing to press, but the button the person pressed stays, so focus has somewhere to be
          disabled={settled !== null}
          focusableWhenDisabled
          {...CELL_CONTROL}
          onClick={view === 'open' ? () => setOpen(true) : settled !== null ? undefined : () => void take()}
        >
          {view === 'open' ? (
            <span className="num type-body font-normal">{formatTableDate(latest.observed_at, timeZone)}</span>
          ) : (
            <span className="type-body font-normal">
              {settled !== null ? words[settled].text : failed ? t('retry') : t('get')}
            </span>
          )}
        </Button>
      </Tooltip>
      {failed || settled !== null ? (
        <span role="alert" className="sr-only">
          {settled !== null ? words[settled].tip : t('failed')}
        </span>
      ) : null}
      {view === 'open' ? (
        <AnswerDialog
          open={open}
          onOpenChange={setOpen}
          platform={platform}
          promptText={promptText}
          observedAt={latest.observed_at}
          screenshotUrl={url ?? ''}
          truncated={mine?.truncated ?? false}
          citations={citationState}
          timeZone={timeZone}
        />
      ) : null}
    </>
  );
}
