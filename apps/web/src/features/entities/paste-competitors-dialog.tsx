'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, type ReactNode } from 'react';

import {
  COMPETITOR_LIMIT,
  refreshEntities,
  seoCompetitors,
  type ProjectEntity,
  type ProjectScope,
} from './entity-queries';
import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel, Fieldset, GroupError } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { domainMessageKey } from '@/lib/domains/normalize';
import { nextCompetitorColor } from '@/lib/entities/colors';
import { readCompetitorList, type PasteProblem, type PastedRow } from '@/lib/entities/paste-list';
import { attachEntityMutation, createEntityMutation, findBrandId } from '@/lib/entities/project-entities';

type FailReason = 'domain' | 'nameTaken' | 'create' | 'attach' | 'alreadyAdded' | 'limit';

interface Outcome {
  row: PastedRow;
  /** `null` when the competitor was added. */
  failed: FailReason | null;
}

export interface PasteCompetitorsProps {
  scope: ProjectScope;
  /** The project's current entities: the sites it already has, the SEO count and the colors taken. */
  entities: readonly ProjectEntity[];
  /** Back to adding one competitor. */
  onBack: () => void;
  onClose: () => void;
}

/**
 * "Add competitors": a list pasted one for each line, read and checked as it is typed, then added one after the other
 * through the same two steps as one competitor (create the brand in the workspace, give it its role in the project). A
 * line that fails does not stop the others; the summary says which failed and why, and they can be pasted again.
 */
export function PasteCompetitors({ scope, entities, onBack, onClose }: PasteCompetitorsProps): ReactNode {
  const t = useTranslations('entitySettings.dialog.paste');
  const single = useTranslations('entitySettings.dialog');
  const domains = useTranslations('common.domain');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const create = useMutation(createEntityMutation);
  const attach = useMutation(attachEntityMutation);
  const trackErrorId = useId();
  const [text, setText] = useState('');
  const [trackSeo, setTrackSeo] = useState(true);
  const [trackAi, setTrackAi] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [outcomes, setOutcomes] = useState<readonly Outcome[] | null>(null);

  const taken = useMemo(
    () => new Set(entities.flatMap((entity) => entity.domains.map((domain) => domain.domain.host.toLowerCase()))),
    [entities],
  );
  const reading = useMemo(() => readCompetitorList(text, taken), [text, taken]);
  const freeSlots = Math.max(0, COMPETITOR_LIMIT - seoCompetitors(entities));
  const overSeo = trackSeo && reading.rows.length > freeSlots;
  const trackError = !trackSeo && !trackAi ? single('trackRequired') : null;

  const problemText = (problem: PasteProblem): string =>
    problem.kind === 'domain' ? domains(domainMessageKey(problem.code)) : t(`problem.${problem.kind}`);

  const addOne = async (row: PastedRow, seo: boolean, used: { color_index: number | null }[]): Promise<Outcome> => {
    let entityId: string;
    try {
      const created = await create.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId } },
        body: {
          entity_type: 'brand',
          is_ambiguous: false,
          canonical_name: row.name,
          domains: [{ domain: row.display, match_scope: 'host' }],
          aliases: [],
        },
      });
      entityId = created.data.entity_id;
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        // A brand of this name is already in the workspace, perhaps one this project removed: give it the role
        const existing = await findBrandId(queryClient, scope.workspaceId, row.name).catch(() => null);
        if (existing === null) return { row, failed: 'nameTaken' };
        entityId = existing;
      } else if (
        isApiProblem(error, 'validation_failed') &&
        error.errors.some((item) => item.path.startsWith('domains'))
      ) {
        return { row, failed: 'domain' };
      } else {
        return { row, failed: 'create' };
      }
    }
    const color = nextCompetitorColor(used);
    try {
      await attach.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
        body: {
          entity_id: entityId,
          role: 'competitor',
          is_primary: false,
          track_seo: seo,
          track_ai: trackAi,
          color_index: color,
        },
      });
    } catch (error) {
      if (isApiProblem(error, 'competitor_limit')) return { row, failed: 'limit' };
      return { row, failed: isApiProblem(error, 'duplicate') ? 'alreadyAdded' : 'attach' };
    }
    used.push({ color_index: color });
    return { row, failed: null };
  };

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    if (trackError !== null || reading.rows.length === 0 || adding) return;
    setAdding(true);
    // The colors the project holds, growing as each competitor takes one
    const used = entities.map((entity) => ({ color_index: entity.color_index }));
    const done: Outcome[] = [];
    for (const [index, row] of reading.rows.entries()) {
      // The SEO limit is the project's: the competitors past its free places are tracked in AI visibility only
      done.push(await addOne(row, trackSeo && index < freeSlots, used));
    }
    refreshEntities(queryClient, scope);
    setAdding(false);
    const added = done.filter((outcome) => outcome.failed === null).length;
    if (added === done.length) {
      toast({ type: 'success', title: t('added', { count: added }) });
      onClose();
      return;
    }
    setOutcomes(done);
  };

  /** Back to the list with the lines that failed, to fix and add again. */
  const retryFailed = (): void => {
    setText(
      (outcomes ?? [])
        .filter((outcome) => outcome.failed !== null)
        .map((outcome) => outcome.row.text)
        .join('\n'),
    );
    setOutcomes(null);
    setSubmitted(false);
  };

  const count = reading.rows.length;
  if (outcomes !== null) {
    const added = outcomes.filter((outcome) => outcome.failed === null).length;
    const failed = outcomes.filter((outcome) => outcome.failed !== null);
    return (
      <Dialog open onOpenChange={(next) => !next && onClose()} size="md">
        <DialogHeader
          title={t('resultTitle')}
          description={t('resultSummary', { added, failed: failed.length })}
          closeLabel={common('close')}
        />
        <DialogBody>
          <ul aria-label={t('failedList')} className="flex flex-col gap-1 type-body">
            {failed.map((outcome) => (
              <li key={outcome.row.line}>
                <span className="type-body-strong">{outcome.row.display}</span>
                {': '}
                {outcome.failed === null ? null : t(`fail.${outcome.failed}`, { limit: COMPETITOR_LIMIT })}
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter
          secondary={
            <Button type="button" variant="secondary" onClick={onClose}>
              {common('close')}
            </Button>
          }
          primary={
            <Button type="button" variant="primary" onClick={retryFailed}>
              {t('retry')}
            </Button>
          }
        />
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !adding) onClose();
      }}
      size="md"
      dirty={text.trim() !== ''}
      discard={{
        title: discard('title'),
        description: t('discardDescription'),
        keepEditingLabel: discard('keepEditing'),
        discardLabel: discard('discard'),
      }}
    >
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogHeader title={t('title')} description={t('description')} closeLabel={common('close')} />
        <DialogBody>
          <Field disabled={adding}>
            <FieldLabel>{t('list')}</FieldLabel>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder={t('placeholder')}
              submitOnModEnter
            />
            <FieldDescription>{t('hint')}</FieldDescription>
          </Field>
          {reading.issues.length === 0 ? null : (
            <ul aria-label={t('issuesList')} className="flex flex-col gap-1 type-meta text-foreground-secondary">
              {reading.issues.map((issue) => (
                <li key={issue.line}>
                  {t('issue', { line: issue.line, text: issue.text, reason: problemText(issue.problem) })}
                </li>
              ))}
            </ul>
          )}
          <Fieldset
            legend={single('track')}
            aria-describedby={submitted && trackError !== null ? trackErrorId : undefined}
          >
            <Checkbox checked={trackSeo} onCheckedChange={setTrackSeo} label={single('trackSeo')} disabled={adding} />
            <Checkbox checked={trackAi} onCheckedChange={setTrackAi} label={single('trackAi')} disabled={adding} />
            {submitted && trackError !== null ? <GroupError id={trackErrorId} message={trackError} /> : null}
          </Fieldset>
          {overSeo ? (
            <Banner
              tone="info"
              placement="region"
              message={t('seoOver', { free: freeSlots, limit: COMPETITOR_LIMIT })}
            />
          ) : null}
          <Banner tone="info" placement="region" lead={single('sovLead')} message={t('sov')} />
        </DialogBody>
        <DialogFooter
          start={
            <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={adding}>
              {t('addOne')}
            </Button>
          }
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary" disabled={adding}>
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={adding} disabled={count === 0}>
              {t('submit', { count })}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
