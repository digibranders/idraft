'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';

import { COMPETITOR_LIMIT, refreshEntities, type ProjectEntity, type ProjectScope } from './entity-queries';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Fieldset, GroupError } from '@/components/ui/field';
import { FormAlert } from '@/components/ui/form-alert';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { apiMutation } from '@/lib/api/query';

const CHANGE = apiMutation('patch', '/api/v1/workspaces/{workspace_id}/projects/{project_id}/entities/{entity_id}');

export interface TrackingDialogProps {
  scope: ProjectScope;
  /** The role whose tracking changes; the dialog is closed while it is `null`. */
  entity: ProjectEntity | null;
  onClose: () => void;
}

/** "Change tracking": whether the entity counts in SEO rankings, in AI visibility, or both. */
export function TrackingDialog({ entity, ...props }: TrackingDialogProps): ReactNode {
  return entity === null ? null : <TrackingForm key={entity.entity.entity_id} entity={entity} {...props} />;
}

function TrackingForm({ scope, entity, onClose }: TrackingDialogProps & { entity: ProjectEntity }): ReactNode {
  const t = useTranslations('entitySettings.tracking');
  const dialog = useTranslations('entitySettings.dialog');
  const common = useTranslations('common');
  const queryClient = useQueryClient();
  const change = useMutation(CHANGE);
  const [trackSeo, setTrackSeo] = useState(entity.track_seo);
  const [trackAi, setTrackAi] = useState(entity.track_ai);
  const [alert, setAlert] = useState<string | null>(null);
  const name = entity.entity.canonical_name;
  const errorId = useId();
  const none = !trackSeo && !trackAi;

  const submit = async (): Promise<void> => {
    if (none || change.isPending) return;
    setAlert(null);
    try {
      await change.mutateAsync({
        params: {
          path: { workspace_id: scope.workspaceId, project_id: scope.projectId, entity_id: entity.entity.entity_id },
        },
        body: { track_seo: trackSeo, track_ai: trackAi },
      });
    } catch (error) {
      setAlert(
        isApiProblem(error, 'competitor_limit')
          ? t('competitorLimit', { limit: COMPETITOR_LIMIT })
          : t('failed', { name }),
      );
      return;
    }
    refreshEntities(queryClient, scope, entity.entity.entity_id);
    toast({ type: 'success', title: t('saved', { name }) });
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !change.isPending) onClose();
      }}
      size="sm"
    >
      <form
        noValidate
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogHeader title={t('title', { name })} description={t('description')} closeLabel={common('close')} />
        <DialogBody>
          {alert === null ? null : <FormAlert message={alert} />}
          <Fieldset legend={dialog('track')} aria-describedby={none ? errorId : undefined}>
            <Checkbox checked={trackSeo} onCheckedChange={setTrackSeo} label={dialog('trackSeo')} />
            <Checkbox checked={trackAi} onCheckedChange={setTrackAi} label={dialog('trackAi')} />
            {none ? <GroupError id={errorId} message={dialog('trackRequired')} /> : null}
          </Fieldset>
        </DialogBody>
        <DialogFooter
          secondary={
            <DialogClose>
              <Button type="button" variant="secondary">
                {common('cancel')}
              </Button>
            </DialogClose>
          }
          primary={
            <Button type="submit" variant="primary" loading={change.isPending}>
              {common('save')}
            </Button>
          }
        />
      </form>
    </Dialog>
  );
}
