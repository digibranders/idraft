'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { engineLabel } from './engine-role';
import { TrendFrame, type TrendGate } from './trend-frame';
import { engineGate } from './trend-model';
import { useCardData } from './use-card-data';
import { LinkButton } from '@/components/ui/link-button';
import type { CardProps } from '@/features/layouts';
import { ENGINES } from '@/lib/layouts/catalog';
import { projectPath } from '@/lib/routes/paths';

/** The name of the downloaded file, without its extension. */
const fileNameOf = (code: string): string => `mention-rate-trend-${code}`;

/** The engine of the card's option; ChatGPT, the catalog's default, for a value that is no engine. */
const engineOf = (value: string | undefined): (typeof ENGINES)[number]['code'] =>
  ENGINES.find((engine) => engine.code === value)?.code ?? 'chatgpt_web';

/**
 * Mention rate trend (WB-OV-05): the mention rate of one engine, week by week, in one chart. An engine that is off
 * in the project, or outside the page's engine filter, says so instead of drawing nothing.
 */
export default function MentionTrendCard({ item, options, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.engines.trend');
  const common = useTranslations('aiOverview.engines.common');
  const code = engineOf(options.engine);
  const data = useCardData({ previous: 'optional', include: ['series'], subscribed: live });
  const { canManageEngines, workspaceSlug, project, scope } = data;
  const projects = data.engines.data;
  const state = projects === undefined ? 'asked' : engineGate(code, projects, scope.engines);
  const engine = engineLabel(code) ?? common('unknownEngine');

  let gate: TrendGate | null = null;
  if (state === 'off') {
    gate = {
      title: t('engineOffTitle', { engine }),
      reason: canManageEngines ? t('engineOffReason') : common('askAdmin'),
      action: canManageEngines ? (
        <LinkButton size="sm" render={<Link href={projectPath(workspaceSlug, project.slug, '/settings/engines')} />}>
          {common('toEngines')}
        </LinkButton>
      ) : undefined,
    };
  } else if (state === 'outsideFilter') {
    gate = { title: t('engineFilteredTitle', { engine }), reason: t('engineFilteredReason') };
  }
  return (
    <TrendFrame
      itemId={item.id}
      data={data}
      engines={state === 'asked' && data.asked.includes(code) ? [code] : []}
      metric="mention"
      switchable={false}
      height={180}
      gate={gate}
      fileName={fileNameOf(code)}
    />
  );
}
