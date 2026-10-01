'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { refreshEntities, type EntityDetail, type EntityDomain, type ProjectScope } from './entity-queries';
import { SCOPE_KEY } from './labels';
import { DomainInput } from '@/components/app/forms/domain-input';
import { Banner } from '@/components/app/status/banner';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';
import { domainMessageKey, normalizeDomain } from '@/lib/domains/normalize';

const ADD = apiMutation('post', '/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains');
const REMOVE = apiMutation(
  'delete',
  '/api/v1/workspaces/{workspace_id}/entities/{entity_id}/domains/{entity_domain_id}',
);

type MatchScope = EntityDomain['match_scope'];
const SCOPES: readonly MatchScope[] = ['registrable', 'host', 'path_prefix'];

/** How a rule reads in a list: the host, with the path for a path rule. */
const ruleText = (rule: EntityDomain): string =>
  rule.match_scope === 'registrable'
    ? rule.domain.registrable_domain
    : rule.path_prefix === null
      ? rule.domain.host
      : `${rule.domain.host}${rule.path_prefix}`;

export interface EntityDomainsSectionProps {
  scope: ProjectScope;
  entity: EntityDetail;
  canWrite: boolean;
}

/**
 * The domains that count as the entity's site (20 section 5.19.6): each with how much of the web it claims,
 * the whole registrable domain, one host, or one path. Another entity claiming the same domain at the same
 * level in a shared project is a warning, not an error: the own brand wins the tie.
 */
export function EntityDomainsSection({ scope, entity, canWrite }: EntityDomainsSectionProps): ReactNode {
  const t = useTranslations('entitySettings.domains');
  const domainCopy = useTranslations('common.domain');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const add = useMutation(ADD);
  const remove = useMutation(REMOVE);
  const domainInput = useRef<HTMLInputElement>(null);
  const pathInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [domain, setDomain] = useState('');
  const [matchScope, setMatchScope] = useState<MatchScope>('registrable');
  const [pathPrefix, setPathPrefix] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EntityDomain | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Once the row is gone with its button, focus goes to the section's heading; on Cancel it goes back
  const [removed, setRemoved] = useState(false);

  const scopeOptions = SCOPES.map((value) => ({
    value,
    label: t(`scopes.${SCOPE_KEY[value]}`),
    description: t(`scopeHints.${SCOPE_KEY[value]}`),
  }));

  const submit = async (): Promise<void> => {
    if (add.isPending) return;
    const preview = normalizeDomain(domain, { keepWww: matchScope !== 'registrable' });
    const path = pathPrefix.trim();
    const localPathError =
      matchScope !== 'path_prefix' ? null : path === '' || !path.startsWith('/') ? t('pathRequired') : null;
    setDomainError(preview.ok ? null : domainCopy(domainMessageKey(preview.code)));
    setPathError(localPathError);
    if (!preview.ok) {
      domainInput.current?.focus();
      return;
    }
    if (localPathError !== null) {
      pathInput.current?.focus();
      return;
    }
    setConflict(null);
    try {
      const added = await add.mutateAsync({
        params: { path: { workspace_id: scope.workspaceId, entity_id: entity.entity_id } },
        body: {
          domain: domain.trim(),
          match_scope: matchScope,
          path_prefix: matchScope === 'path_prefix' ? path : null,
        },
      });
      refreshEntities(queryClient, scope);
      setDomain('');
      setPathPrefix('');
      if (added.meta.warnings.includes('domain_role_conflict')) setConflict(ruleText(added.data));
      toast({ type: 'success', title: t('added', { domain: ruleText(added.data) }) });
    } catch (error) {
      if (isApiProblem(error, 'duplicate')) {
        setDomainError(t('duplicate', { name: entity.canonical_name }));
      } else if (isApiProblem(error, 'validation_failed')) {
        const codes = error.errors.map((item) => item.code);
        if (codes.includes('invalid_path_prefix') || codes.includes('path_prefix_mismatch')) {
          setPathError(t('pathInvalid'));
          pathInput.current?.focus();
          return;
        }
        setDomainError(domainCopy(codes.includes('domain_is_public_suffix') ? 'publicSuffix' : 'invalid'));
      } else {
        setDomainError(t('addFailed'));
      }
      domainInput.current?.focus();
    }
  };

  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    setRemoveError(null);
    try {
      await remove.mutateAsync({
        params: {
          path: {
            workspace_id: scope.workspaceId,
            entity_id: entity.entity_id,
            entity_domain_id: removing.entity_domain_id,
          },
        },
      });
    } catch (error) {
      if (!isApiProblem(error, 'not_found')) {
        setRemoveError(t('removeFailed', { domain: ruleText(removing) }));
        throw error;
      }
    }
    setRemoved(true);
    refreshEntities(queryClient, scope);
    toast({ type: 'success', title: t('removed', { domain: ruleText(removing) }) });
  };

  return (
    <section aria-labelledby="entity-domains-title" className="flex flex-col gap-4">
      <div>
        <h3 id="entity-domains-title" ref={heading} tabIndex={-1} className="type-subsection-title outline-none">
          {t('title')}
        </h3>
        <p className="mt-1 type-meta">{t('description')}</p>
      </div>
      {conflict === null ? null : (
        <Banner
          tone="warning"
          placement="region"
          lead={t('conflictLead')}
          message={t('conflict', { domain: conflict })}
        />
      )}
      {entity.domains.length === 0 ? (
        <p className="type-body text-foreground-secondary">{t('empty')}</p>
      ) : (
        <ul aria-labelledby="entity-domains-title" className="flex flex-col rounded-lg border border-border bg-surface">
          {entity.domains.map((rule) => (
            <li
              key={rule.entity_domain_id}
              className="flex h-row items-center gap-3 border-t border-border-subtle px-4 first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate type-body">{ruleText(rule)}</span>
              <span className="type-meta">{t(`scopes.${SCOPE_KEY[rule.match_scope]}`)}</span>
              {canWrite ? (
                <IconButton
                  icon={X}
                  size="icon-sm"
                  label={t('remove', { domain: ruleText(rule) })}
                  onClick={() => {
                    setRemoved(false);
                    setRemoving(rule);
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? (
        <form
          noValidate
          aria-label={t('addTitle')}
          className="flex max-w-form flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Field invalid={domainError !== null} width="long">
              <FieldLabel>{t('domain')}</FieldLabel>
              <DomainInput
                value={domain}
                onValueChange={(value) => {
                  setDomain(value);
                  setDomainError(null);
                }}
                invalid={domainError !== null}
                scope={matchScope === 'registrable' ? 'domain' : 'host'}
                inputRef={domainInput}
              />
              {domainError === null ? null : <FieldError message={domainError} />}
            </Field>
            <Field width="medium">
              <FieldLabel>{t('scope')}</FieldLabel>
              <Select<MatchScope>
                value={matchScope}
                onValueChange={(value) => {
                  setMatchScope(value);
                  setPathError(null);
                }}
                placeholder={t('scope')}
                options={scopeOptions}
              />
            </Field>
          </div>
          {matchScope === 'path_prefix' ? (
            <Field invalid={pathError !== null} width="medium">
              <FieldLabel>{t('path')}</FieldLabel>
              <Input
                ref={pathInput}
                value={pathPrefix}
                placeholder={t('pathPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                onValueChange={(value) => {
                  setPathPrefix(value);
                  setPathError(null);
                }}
              />
              {pathError === null ? null : <FieldError message={pathError} />}
            </Field>
          ) : null}
          <Button type="submit" className="self-start" loading={add.isPending}>
            {t('add')}
          </Button>
        </form>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveError(null);
          }
        }}
        finalFocus={removed ? heading : undefined}
        title={t('removeTitle', { domain: removing === null ? '' : ruleText(removing), name: entity.canonical_name })}
        description={t('removeDescription', { name: entity.canonical_name })}
        confirmLabel={t('removeConfirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmRemove}
        error={removeError}
      />
    </section>
  );
}
