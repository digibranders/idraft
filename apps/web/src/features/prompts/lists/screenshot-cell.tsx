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

/**
 * The Screenshot cell of one platform. With a stored image it is an outlined button with the image icon and the day of
 * the latest answer, which opens the answer's dialog. Without one a person who may spend gets a Get screenshot button
 * (one provider call, kept for everyone after it); it is loading while the call runs and says so when it fails, with
 * the same button to try again. A reader, an answer past the provider's window and a platform without a page get a
 * word (the column gives each its reason). The dialog sits in the cell, so a click inside it never opens the row behind it.
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
  const [taken, setTaken] = useState<{ url: string; truncated: boolean } | null>(null);
  const [lateExpired, setLateExpired] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = taken?.url ?? latest.screenshot_url;
  const view = url !== null ? 'open' : lateExpired ? 'expired' : screenshotViewOf(latest, canCapture);
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
    setFailed(false);
    if (!isObservationId(latest.observation_id)) {
      setFailed(true);
      return;
    }
    try {
      const answer = await capture.mutateAsync({
        params: {
          path: {
            workspace_id: project.workspaceId,
            project_id: project.projectId,
            observation_id: Number(latest.observation_id),
          },
          query: { observed_at: latest.observed_at },
        },
      });
      setTaken({ url: answer.data.url, truncated: answer.data.truncated });
      setOpen(true);
    } catch (error) {
      if (error instanceof ApiProblem && error.code === 'screenshot_expired') setLateExpired(true);
      else setFailed(true);
    } finally {
      // The row now has a stored image, or is past the window: the summary says which
      void queryClient.invalidateQueries({ queryKey: aiKey(project) });
    }
  };

  if (view === 'get') {
    const label = t('getLabel', { platform: platform.name, prompt: promptText });
    return (
      <>
        <Tooltip content={t(failed ? 'failed' : 'getTip', { price: formatUnitPrice(SCREENSHOT_PRICE_USD) })}>
          <Button
            size="sm"
            className="h-6 px-1.5"
            icon={failed ? TriangleAlert : Image}
            aria-label={failed ? t('retryLabel', { platform: platform.name, prompt: promptText }) : label}
            loading={capture.isPending}
            {...CELL_CONTROL}
            onClick={() => void take()}
          >
            <span className="type-body font-normal">{t(failed ? 'retry' : 'get')}</span>
          </Button>
        </Tooltip>
        {failed ? (
          <span role="alert" className="sr-only">
            {t('failed')}
          </span>
        ) : null}
      </>
    );
  }
  if (view !== 'open') {
    return <span className="text-foreground-tertiary">{view === 'expired' ? t('expired') : EMPTY_VALUE}</span>;
  }
  return (
    <>
      <Button
        size="sm"
        className="h-6 px-1.5"
        icon={Image}
        aria-label={t('openLabel', { platform: platform.name, prompt: promptText })}
        aria-haspopup="dialog"
        {...CELL_CONTROL}
        onClick={() => setOpen(true)}
      >
        <span className="num type-body font-normal">{formatTableDate(latest.observed_at, timeZone)}</span>
      </Button>
      <AnswerDialog
        open={open}
        onOpenChange={setOpen}
        platform={platform}
        promptText={promptText}
        observedAt={latest.observed_at}
        screenshotUrl={url ?? ''}
        truncated={taken?.truncated ?? false}
        citations={citationState}
        timeZone={timeZone}
      />
    </>
  );
}
