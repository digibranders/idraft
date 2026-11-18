'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, type ReactElement } from 'react';

import { reasonOf } from '@/lib/internal-links/problem-reason';
import { ruleChanges, type DraftRule, type MatchType } from './rule-changes';
import { InlineError } from '@/components/app/status/inline-error';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormAlert } from '@/components/ui/form-alert';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { createRuleMutation, deleteRuleMutation, updateRuleMutation } from '@/lib/internal-links/mutations';
import { internalLinksKeys, tierRulePreviewQuery, tierRulesQuery } from '@/lib/internal-links/queries';
import { checkRuleValue, MAX_RULES, type RuleValueProblem } from '@/lib/internal-links/rule-value';
import type { LinksScope, PageTier, TierRuleView } from '@/lib/internal-links/types';

const MATCHES: readonly MatchType[] = ['exact', 'prefix', 'pattern'];
const PREVIEW_DELAY = 300;

const PROBLEM_KEY = {
  empty: 'pathRequired',
  starts_with_slash: 'pathSlash',
  too_long: 'pathTooLong',
  star_in_exact: 'starExact',
  star_in_prefix: 'starPrefix',
  too_many_stars: 'tooManyStars',
} as const satisfies Record<RuleValueProblem, string>;

/** The saved rules as one comparable text: a change by anyone else, in any field or in the order, changes it. */
const signature = (rules: readonly TierRuleView[]): string =>
  JSON.stringify(
    [...rules]
      .sort((a, b) => a.position - b.position)
      .map((rule) => [rule.rule_id, rule.match_type, rule.value, rule.tier.tier_id]),
  );

/** The draft with the rules it started from: the snapshot says what a save has to find unchanged. */
interface Draft {
  rows: DraftRule[];
  snapshot: readonly TierRuleView[];
}

/**
 * "Matches N pages" of one rule (decision W16). A count costs a request that reads the whole crawl, so it is asked
 * only for a rule the person edited, added, focused or asked about, 300 ms after they stop typing and only for a
 * path the API would accept; the others offer "Count pages". It counts against the saved rules, as the API does:
 * the draft's other rules are not in it. No sample paths: the API has none (gap G5).
 */
function RulePreview({
  scope,
  rule,
  position,
  counting,
  onCount,
}: {
  scope: LinksScope;
  rule: Pick<DraftRule, 'matchType' | 'value' | 'ruleId'>;
  position: number;
  counting: boolean;
  onCount: () => void;
}): ReactElement {
  const t = useTranslations('internalLinks.rules');
  const value = useDebouncedValue(rule.value.trim(), PREVIEW_DELAY);
  const askable = counting && checkRuleValue(rule.matchType, value) === null;
  const preview = useQuery({
    ...tierRulePreviewQuery(scope, { matchType: rule.matchType, value, position, ruleId: rule.ruleId }),
    enabled: askable,
  });
  if (!counting) {
    return (
      <Button variant="ghost" size="sm" aria-label={t('countLabel', { position })} onClick={onCount}>
        {t('count')}
      </Button>
    );
  }
  let text = t('enterPath');
  if (askable) {
    if (preview.isError) text = t('previewFailed');
    else if (preview.data === undefined) text = t('counting');
    else text = t('matches', { matching: preview.data.matching_pages, applied: preview.data.would_apply });
  }
  return <span className="num type-meta text-foreground-tertiary">{text}</span>;
}

/** The rules as plain text, for a member who may read them and not change them. */
function ReadOnlyRules({
  scope,
  rules,
  counted,
  onCount,
}: {
  scope: LinksScope;
  rules: readonly TierRuleView[];
  counted: ReadonlySet<string>;
  onCount: (key: string) => void;
}): ReactElement {
  const t = useTranslations('internalLinks.rules');
  if (rules.length === 0) return <p className="type-body text-foreground-secondary">{t('emptyReadOnly')}</p>;
  return (
    <ol aria-label={t('listLabel')} className="flex flex-col gap-3">
      {rules.map((rule) => (
        <li key={rule.rule_id} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-6 num type-label text-foreground-tertiary">{rule.position}</span>
            <span className="type-body text-foreground-secondary">{t(rule.match_type)}</span>
            <code className="type-table text-foreground">{rule.value}</code>
            <TierBadge tier={rule.tier} withName />
          </div>
          <div className="pl-8">
            <RulePreview
              scope={scope}
              rule={{ matchType: rule.match_type, value: rule.value, ruleId: rule.rule_id }}
              position={rule.position}
              counting={counted.has(rule.rule_id)}
              onCount={() => onCount(rule.rule_id)}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Tier rules (spec 5.2, mock `openRules`): ordered rows of match type, path and tier, saved together as the calls
 * `ruleChanges` works out (decision W15). The draft keeps the rules it started from. A save reads the rules again
 * first: if anyone changed them meanwhile, nothing is sent, the draft is dropped and the person is told, so a stale
 * draft never removes or overwrites a teammate's rule. A save that stops halfway says so, stays open and keeps the
 * draft; the rules it did save are read again, so saving once more sends only what is left. Without `canWrite` the
 * rules are read only.
 */
export function RulesDialog({
  open,
  onOpenChange,
  scope,
  tiers,
  canWrite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinksScope;
  tiers: readonly PageTier[];
  canWrite: boolean;
}): ReactElement {
  const t = useTranslations('internalLinks.rules');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const saved = useQuery({ ...tierRulesQuery(scope), enabled: open });
  const create = useMutation(createRuleMutation);
  const update = useMutation(updateRuleMutation);
  const remove = useMutation(deleteRuleMutation);
  const baseId = useId();
  const counter = useRef(0);
  // `null` until the person edits: the saved rules are shown as they are
  const [draftState, setDraftState] = useState<Draft | null>(null);
  const [counted, setCounted] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedRules = saved.data?.data;
  const base = useMemo(
    (): DraftRule[] =>
      (savedRules ?? []).map((rule) => ({
        key: rule.rule_id,
        ruleId: rule.rule_id,
        matchType: rule.match_type,
        value: rule.value,
        tierId: rule.tier.tier_id,
      })),
    [savedRules],
  );
  const rows = draftState?.rows ?? base;
  const known = useMemo(
    () => new Set((draftState?.snapshot ?? savedRules ?? []).map((rule) => rule.rule_id)),
    [draftState, savedRules],
  );
  const setDraft = (change: (current: DraftRule[]) => DraftRule[]): void =>
    setDraftState((current) => ({
      rows: change(current?.rows ?? base),
      snapshot: current?.snapshot ?? savedRules ?? [],
    }));
  const touch = (key: string): void =>
    setCounted((current) => (current.has(key) ? current : new Set(current).add(key)));
  const close = (next: boolean): void => {
    // A save under way finishes first: closing would hide a failure the person has to read
    if (!next && saving) return;
    if (!next) {
      setDraftState(null);
      setCounted(new Set());
      setErrors(new Map());
      setFailure(null);
    }
    onOpenChange(next);
  };
  const changes = savedRules === undefined ? null : ruleChanges(savedRules, rows, known);
  const dirty = changes !== null && changes.deletes.length + changes.patches.length + changes.creates.length > 0;
  const edit = (key: string, change: Partial<DraftRule>): void => {
    touch(key);
    setErrors((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
    setDraft((current) => current.map((rule) => (rule.key === key ? { ...rule, ...change } : rule)));
  };
  const move = (index: number, step: number): void =>
    setDraft((current) => {
      const next = [...current];
      const [rule] = next.splice(index, 1);
      if (rule !== undefined) next.splice(index + step, 0, rule);
      return next;
    });
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId };
  const addRule = (): void => {
    counter.current += 1;
    const key = `new-${String(counter.current)}`;
    touch(key);
    setDraft((current) => [
      ...current,
      { key, ruleId: null, matchType: 'prefix', value: '/', tierId: tiers[0]?.tier_id ?? '' },
    ]);
  };
  const refresh = (): void => {
    for (const queryKey of internalLinksKeys(scope)) void queryClient.invalidateQueries({ queryKey });
  };

  const save = async (): Promise<void> => {
    if (saving || changes === null || saved.isFetching) return;
    const problems = new Map<string, string>();
    for (const rule of rows) {
      const problem = checkRuleValue(rule.matchType, rule.value);
      if (problem !== null) problems.set(rule.key, t(PROBLEM_KEY[problem]));
    }
    setErrors(problems);
    if (problems.size > 0) {
      // The first path to fix takes focus, and the count is spoken: the messages beside the fields are not live
      const first = rows.find((rule) => problems.has(rule.key));
      if (first !== undefined) document.getElementById(`${baseId}-path-${first.key}`)?.focus();
      announce(t('invalidAnnounce', { count: problems.size }), { key: 'internal-links-rules' });
      return;
    }
    setSaving(true);
    setFailure(null);
    // The rules as they are now: if anyone changed them since the draft began, saving blind could undo their work
    const fresh = await saved.refetch();
    const current = fresh.data?.data;
    const snapshot = draftState?.snapshot ?? savedRules ?? [];
    if (current === undefined) {
      setFailure(t('loadFailedSave'));
      setSaving(false);
      return;
    }
    if (signature(current) !== signature(snapshot)) {
      setFailure(t('changedMeanwhile'));
      setDraftState(null);
      setCounted(new Set());
      setSaving(false);
      return;
    }
    const work = ruleChanges(current, rows, known);
    // The rules created so far by key: a second save must patch them, not create them again
    const created = new Map<string, string>();
    let step: { removing: true } | { position: number } = { removing: true };
    try {
      for (const ruleId of work.deletes) await remove.mutateAsync({ params: { path: { ...path, rule_id: ruleId } } });
      for (const patch of work.patches) {
        step = { position: patch.body.position ?? rows.findIndex((rule) => rule.ruleId === patch.ruleId) + 1 };
        await update.mutateAsync({ params: { path: { ...path, rule_id: patch.ruleId } }, body: patch.body });
      }
      const newRows = rows.filter((rule) => rule.ruleId === null);
      for (const [index, body] of work.creates.entries()) {
        step = { position: body.position };
        const answer = await create.mutateAsync({ params: { path }, body });
        const key = newRows[index]?.key;
        if (key !== undefined) created.set(key, answer.data.rule_id);
      }
      toast({ type: 'success', title: t('saved'), description: t('savedText', { count: rows.length }) });
      setSaving(false);
      close(false);
    } catch (error) {
      const lead = 'removing' in step ? t('failedRemove') : t('failed', { position: step.position });
      setFailure([lead, reasonOf(error), t('failedHint')].filter((part) => part !== '').join(' '));
      // What the failed save did is part of the rules now: the draft starts from them, so saving again sends the rest
      const again = await saved.refetch();
      setDraftState({
        rows: rows.map((rule) => {
          const ruleId = created.get(rule.key);
          return ruleId === undefined ? rule : { ...rule, ruleId };
        }),
        snapshot: again.data?.data ?? current,
      });
      setSaving(false);
    } finally {
      refresh();
    }
  };

  let body: ReactElement;
  if (saved.isPending) {
    body = (
      <div className="flex flex-col gap-2" role="status" aria-label={t('loading')}>
        <Skeleton shape="block" height="row" />
        <Skeleton shape="block" height="row" />
      </div>
    );
  } else if (saved.isError && savedRules === undefined) {
    body = (
      <InlineError
        title={t('loadFailed')}
        reason={t('loadFailedReason')}
        errorId={null}
        onRetry={() => void saved.refetch()}
        retrying={saved.isFetching}
        retryLabel={common('retry')}
      />
    );
  } else if (!canWrite) {
    body = <ReadOnlyRules scope={scope} rules={savedRules ?? []} counted={counted} onCount={touch} />;
  } else {
    body = (
      <>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-border-subtle bg-surface-subtle px-4 py-6 type-body text-foreground-secondary">
            {t('empty')}
          </p>
        ) : (
          <ol aria-label={t('listLabel')} className="flex flex-col gap-3">
            {rows.map((rule, index) => {
              const position = index + 1;
              const error = errors.get(rule.key);
              return (
                <li key={rule.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 num type-label text-foreground-tertiary">{position}</span>
                    <Select<MatchType>
                      aria-label={t('match', { position })}
                      value={rule.matchType}
                      onValueChange={(matchType) => edit(rule.key, { matchType })}
                      placeholder={t('exact')}
                      options={MATCHES.map((value) => ({ value, label: t(value) }))}
                      size="sm"
                      className="w-40"
                    />
                    <Input
                      id={`${baseId}-path-${rule.key}`}
                      aria-label={t('path', { position })}
                      aria-invalid={error === undefined ? undefined : true}
                      aria-describedby={error === undefined ? undefined : `${baseId}-${rule.key}`}
                      value={rule.value}
                      onValueChange={(value) => edit(rule.key, { value })}
                      onFocus={() => touch(rule.key)}
                      size="sm"
                      autoComplete="off"
                      spellCheck={false}
                      className="min-w-40 flex-1"
                    />
                    <Select<string>
                      aria-label={t('tier', { position })}
                      value={rule.tierId === '' ? null : rule.tierId}
                      onValueChange={(tierId) => edit(rule.key, { tierId })}
                      placeholder={t('chooseTier')}
                      options={tiers.map((tier) => ({ value: tier.tier_id, label: tier.label }))}
                      size="sm"
                      className="w-48"
                    />
                    <IconButton
                      icon={ChevronUp}
                      size="icon-sm"
                      label={t('up', { position })}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    />
                    <IconButton
                      icon={ChevronDown}
                      size="icon-sm"
                      label={t('down', { position })}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    />
                    <IconButton
                      icon={Trash2}
                      size="icon-sm"
                      label={t('delete', { position })}
                      onClick={() => setDraft((current) => current.filter((candidate) => candidate.key !== rule.key))}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pl-8">
                    {error === undefined ? null : (
                      <span id={`${baseId}-${rule.key}`} className="type-meta text-negative-text">
                        {error}
                      </span>
                    )}
                    <RulePreview
                      scope={scope}
                      rule={rule}
                      position={position}
                      counting={counted.has(rule.key)}
                      onCount={() => touch(rule.key)}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            disabled={tiers.length === 0 || rows.length >= MAX_RULES}
            onClick={addRule}
          >
            {t('add')}
          </Button>
          {rows.length >= MAX_RULES ? (
            <span className="type-meta text-foreground-secondary">{t('limit', { count: MAX_RULES })}</span>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      dirty={dirty}
      discard={{
        title: t('discardTitle'),
        description: t('discardText'),
        keepEditingLabel: t('keepEditing'),
        discardLabel: t('discard'),
      }}
    >
      <DialogHeader
        title={t('title')}
        description={canWrite ? t('description') : t('readOnly')}
        closeLabel={common('close')}
      />
      <DialogBody>
        {failure === null ? null : <FormAlert message={failure} />}
        {body}
      </DialogBody>
      <DialogFooter
        primary={
          canWrite ? (
            <Button
              variant="primary"
              loading={saving}
              disabled={!dirty || saved.isFetching}
              onClick={() => void save()}
            >
              {t('save')}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => close(false)}>
              {common('close')}
            </Button>
          )
        }
        secondary={
          canWrite ? (
            <DialogClose>
              <Button type="button" variant="secondary" disabled={saving}>
                {common('cancel')}
              </Button>
            </DialogClose>
          ) : undefined
        }
      />
    </Dialog>
  );
}
