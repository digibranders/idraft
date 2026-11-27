'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { PageSearchPanel } from '../panel/page-search-panel';
import type { TrackedPageRow } from '../types';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorFooter } from '@/components/app/inspector/inspector-footer';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { copyText } from '@/lib/dom/clipboard';

const NEW_WINDOW = ['_blank', 'noopener'] as const;

export interface MonitoringInspectorProps {
  row: TrackedPageRow;
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  timeZone: string;
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
}

/** The shared inspector with the page's search detail in it, until the Pages drawer shell takes the row (spec 11). */
export function MonitoringInspector({
  row,
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
  timeZone,
  positionText,
  navigation,
  onStep,
  onClose,
}: MonitoringInspectorProps): ReactElement {
  const t = useTranslations('monitoring.inspector');
  const common = useTranslations('common');
  const copyUrl = (): void => {
    void copyText(row.url).then((copied) =>
      toast(copied ? { type: 'success', title: t('copied') } : { type: 'error', title: common('copy.failed') }),
    );
  };
  return (
    <Inspector
      type="page"
      header={{
        title: row.path,
        typeLabel: t('typeLabel'),
        typeNoun: t('typeNoun'),
        positionText,
        navigation,
        ...(row.title === null
          ? {}
          : { freshness: <span className="type-meta text-foreground-secondary">{row.title}</span> }),
      }}
      backLabel={t('back')}
      onClose={onClose}
      onStep={onStep}
      footer={
        <InspectorFooter
          start={
            <Button variant="secondary" size="sm" icon={Copy} onClick={copyUrl}>
              {t('copyUrl')}
            </Button>
          }
          primary={
            <Button variant="secondary" icon={ExternalLink} onClick={() => window.open(row.url, ...NEW_WINDOW)}>
              {t('visit')}
            </Button>
          }
        />
      }
    >
      <InspectorBody>
        <PageSearchPanel
          workspaceId={workspaceId}
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          urlId={row.url_id}
          statusCode={null}
          timeZone={timeZone}
        />
      </InspectorBody>
    </Inspector>
  );
}
