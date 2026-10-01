'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactNode } from 'react';

import {
  COMPETITOR_LIMIT,
  nextCompetitorColor,
  refreshEntities,
  seoCompetitors,
  type ProjectEntity,
  type ProjectRole,
  type ProjectScope,
  wordAlias,
} from './entity-queries';
import { DomainInput } from '@/components/app/forms/domain-input';
import { Banner } from '@/components/app/status/banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel, Fieldset, GroupError } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation, apiQuery } from '@/lib/api/query';
import { domainMessageKey, normalizeDomain } from '@/lib/domains/normalize';
import { otherNames } from '@/lib/entities/aliases';
import { textLength } from '@/lib/text/length';

const CREATE = apiMutation('post', '/api/v1/workspaces/{workspace_id}/entities');
const ATTACH = apiMutation('post', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities');
/** The API's limit on a canonical name. */
const MAX_NAME_LENGTH = 200;

type AddedRole = Exclude<ProjectRole, 'own'>;

export interface EntityDialogProps {
  scope: ProjectScope;
  /** The role the new entity gets; the dialog is closed while it is `null`. */
  role: AddedRole | null;
  /** The project's current entities, for the competitor count and the next free color. */
  entities: readonly ProjectEntity[];
  workspaceSlug: string;
  projectSlug: string;
  onClose: () => void;
}

/**
 * "Add competitor" and "Watch an entity" (10-forms.md section 25.2): the site, a name suggested from it,
 * what to track and the other names answers use. The entity is created in the workspace, then given its
 * role in this project; if the second step fails, trying again only gives the role.
 */
export function EntityDialog({ role, ...props }: EntityDialogProps): ReactNode {
  return role === null ? null : <EntityForm role={role} {...props} />;
}

/** "Hubspot" from "hubspot.com": the first label of the host, as a starting point the person corrects. */
function nameFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? '';
  return label === '' ? '' : `${label.charAt(0).toLocaleUpperCase()}${label.slice(1)}`;
}

function EntityForm({
  scope,
  role,
  entities,
  onClose,
}: Omit<EntityDialogProps, 'role'> & { role: AddedRole }): ReactNode {
  const t = useTranslations('entitySettings.dialog');
  const domains = useTranslations('common.domain');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const queryClient = useQueryClient();
  const create = useMutation(CREATE);
  const attach = useMutation(ATTACH);
  const domainInput = useRef<HTMLInputElement>(null);
  const trackErrorId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  // Once the SEO limit is reached, a new competitor starts as AI-only
  const [trackSeo, setTrackSeo] = useState(role === 'competitor' && seoCompetitors(entities) < COMPETITOR_LIMIT);
  const [trackAi, setTrackAi] = useState(true);
  const [aliases, setAliases] = useState<readonly string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  // Set once the entity exists, so another try gives the role without creating it twice
  const [createdId, setCreatedId] = useState<string | null>(null);

  const competitors = seoCompetitors(entities);
  const preview = normalizeDomain(domain);
  const localDomainError = preview.ok ? null : domains(domainMessageKey(preview.code));
  const trimmedName = name.trim();
  const localNameError =
    trimmedName === ''
      ? t('nameRequired')
      : textLength(trimmedName) > MAX_NAME_LENGTH
        ? t('nameTooLong', { max: MAX_NAME_LENGTH })
        : null;
  const trackError = !trackSeo && !trackAi ? t('trackRequired') : null;
  const shownDomainError = domainError ?? (submitted ? localDomainError : null);
  const shownNameError = nameError ?? (submitted ? localNameError : null);
  const busy = create.isPending || attach.isPending;
  const dirty = domain.trim() !== '' || trimmedName !== '' || aliases.length > 0;

  const changeDomain = (value: string): void => {
    setDomain(value);
    setDomainError(null);
    // The name follows the domain until the person writes one of their own
    if (!nameEdited) {
      const next = normalizeDomain(value);
      setName(next.ok ? nameFromDomain(next.display) : '');
    }
  };

  /** The id of the workspace entity with this name, found ignoring case, or `null`. */
  const findEntity = async (name: string): Promise<string | null> => {
    try {
      const found = await queryClient.fetchQuery({
        ...apiQuery('/api/v1/workspaces/{workspace_id}/entities', {
          params: { path: { workspace_id: scope.workspaceId }, query: { 'filter[q]': name } },
        }),
        // An entity created a moment ago, perhaps in another tab, has to be found
        staleTime: 0,
      });
      const lowered = name.toLocaleLowerCase();
      // Names are unique per type, so the one to offer is the brand of this name
      return (
        found.data.find(
          (entity) => entity.entity_type === 'brand' && entity.canonical_name.toLocaleLowerCase() === lowered,
        )?.entity_id ?? null
      );
    } catch {
      return null;
    }
  };

  const giveRole = async (entityId: string): Promise<void> => {
    await attach.mutateAsync({
      params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } },
      body: {
        entity_id: entityId,
        role,
        is_primary: false,
        track_seo: trackSeo,
        track_ai: trackAi,
        color_index: nextCompetitorColor(entities),
      },
    });
  };

  const submit = async (): Promise<void> => {
    setSubmitted(true);
    setDomainError(null);
    setNameError(null);
    if (createdId === null && localDomainError !== null) {
      domainInput.current?.focus();
      return;
    }
    if (createdId === null && localNameError !== null) {
      nameInput.current?.focus();
      return;
    }
    if (trackError !== null || busy) return;
    setAlert(null);
    let entityId = createdId;
    if (entityId === null) {
      try {
        const created = await create.mutateAsync({
          params: { path: { workspace_id: scope.workspaceId } },
          body: {
            entity_type: 'brand',
            is_ambiguous: false,
            canonical_name: trimmedName,
            domains: [{ domain: domain.trim(), match_scope: 'registrable' }],
            // The matcher finds the name itself; stored aliases are the other names
            aliases: otherNames(trimmedName, aliases).map(wordAlias),
          },
        });
        entityId = created.data.entity_id;
        setCreatedId(entityId);
      } catch (error) {
        if (isApiProblem(error, 'duplicate')) {
          // The workspace already has an entity of this name, perhaps one this project removed: offer it,
          // rather than a second entity with the same name
          const existing = await findEntity(trimmedName);
          if (existing !== null) {
            setCreatedId(existing);
            setAlert(t('existing', { name: trimmedName }));
            return;
          }
          setNameError(t('nameTaken'));
          nameInput.current?.focus();
          return;
        }
        // The API's canonicalizer has the last word on a domain (19 section 3.4, as built)
        const refused = isApiProblem(error, 'validation_failed')
          ? error.errors.find((item) => item.path.startsWith('domains'))
          : undefined;
        if (refused !== undefined) {
          setDomainError(domains(refused.code === 'domain_is_public_suffix' ? 'publicSuffix' : 'invalid'));
          domainInput.current?.focus();
          return;
        }
        setAlert(t('createFailed'));
        return;
      }
    }
    try {
      await giveRole(entityId);
    } catch (error) {
      refreshEntities(queryClient, scope);
      setAlert(
        isApiProblem(error, 'competitor_limit')
          ? t('competitorLimit', { limit: COMPETITOR_LIMIT })
          : isApiProblem(error, 'duplicate')
            ? t('alreadyAdded', { name: trimmedName })
            : t('attachFailed', { name: trimmedName }),
      );
      return;
    }
    refreshEntities(queryClient, scope);
    toast({
      type: 'success',
      title: t(role === 'competitor' ? 'addedCompetitor' : 'addedWatched', { name: trimmedName }),
    });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      size="md"
      dirty={dirty && createdId === null}
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
        <DialogHeader
          title={t(role === 'competitor' ? 'titleCompetitor' : 'titleWatched')}
          description={t(role === 'competitor' ? 'descriptionCompetitor' : 'descriptionWatched')}
          closeLabel={common('close')}
        />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Field invalid={shownDomainError !== null} disabled={createdId !== null}>
            <FieldLabel>{t('domain')}</FieldLabel>
            <DomainInput
              value={domain}
              onValueChange={changeDomain}
              invalid={shownDomainError !== null}
              description={t('domainHint')}
              disabled={createdId !== null}
              aria-required
              inputRef={domainInput}
            />
            {shownDomainError === null ? null : <FieldError message={shownDomainError} />}
          </Field>
          <Field invalid={shownNameError !== null} disabled={createdId !== null}>
            <FieldLabel>{t('name')}</FieldLabel>
            <Input
              ref={nameInput}
              autoComplete="off"
              aria-required
              value={name}
              disabled={createdId !== null}
              onValueChange={(value) => {
                setName(value);
                setNameEdited(true);
                setNameError(null);
              }}
            />
            {shownNameError === null ? null : <FieldError message={shownNameError} />}
          </Field>
          <Fieldset legend={t('track')} aria-describedby={submitted && trackError !== null ? trackErrorId : undefined}>
            <Checkbox checked={trackSeo} onCheckedChange={setTrackSeo} label={t('trackSeo')} />
            <Checkbox checked={trackAi} onCheckedChange={setTrackAi} label={t('trackAi')} />
            {submitted && trackError !== null ? <GroupError id={trackErrorId} message={trackError} /> : null}
          </Fieldset>
          <Field disabled={createdId !== null}>
            <FieldLabel optional={common('optional')}>{t('aliases')}</FieldLabel>
            <MultiSelect
              value={aliases}
              onValueChange={setAliases}
              items={[]}
              itemToString={(alias) => alias}
              itemKey={(alias) => alias.toLocaleLowerCase()}
              creatable={{ label: (query) => t('addAlias', { alias: query }), onCreate: (query) => query }}
              placeholder={t('aliasPlaceholder')}
              emptyText={() => t('aliasHelp')}
              chipsLabel={t('aliases')}
              removeLabel={(alias) => t('removeAlias', { alias })}
              chipsHint={(count) => t('aliasesHint', { count })}
              chipHint={t('aliasHint')}
              disabled={createdId !== null}
            />
            <FieldDescription>{t('aliasesDescription')}</FieldDescription>
          </Field>
          {role === 'competitor' ? (
            <Banner tone="info" placement="region" lead={t('sovLead')} message={t('sov')} />
          ) : null}
        </DialogBody>
        <DialogFooter
          start={
            role === 'competitor' ? (
              <span className="num type-meta">{t('count', { count: competitors, limit: COMPETITOR_LIMIT })}</span>
            ) : undefined
          }
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary" disabled={busy}>
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={busy}>
              {t(role === 'competitor' ? 'submitCompetitor' : 'submitWatched')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
