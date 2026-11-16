'use client';

import { FolderOpen, MapPinOff, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useOverview } from '../overview-context';
import { canResetScope, RESET_PATCH } from '../scope/scope-model';
import { useTopicTree } from '../scope/use-topic-tree';
import { EmptyState } from '@/components/app/status/empty-state';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { useCountries } from '@/lib/locations/countries';
import { projectPath } from '@/lib/routes/paths';

function PromptsLink(): ReactElement {
  const t = useTranslations('aiOverview.empty');
  const { workspaceSlug, project } = useOverview();
  return (
    <TextLink render={<Link href={projectPath(workspaceSlug, project.slug, '/ai/prompts')} />}>
      {t('toPrompts')}
    </TextLink>
  );
}

/**
 * The body of a project that has an engine on and no prompt to ask (spec 3.6): nothing to count, so it says why and
 * opens the page where prompts are added.
 */
export function NoPromptsState(): ReactElement {
  const t = useTranslations('aiOverview.empty');
  return (
    <EmptyState
      icon={MessageSquare}
      title={t('noPromptsTitle')}
      reason={t('noPromptsReason')}
      headingLevel={2}
      secondaryAction={<PromptsLink />}
    />
  );
}

/**
 * The body when the country in the scope has no prompt: the scope bar stays, so the choice can be changed, and Clear
 * location puts the page back to every market.
 */
export function NoCountryPromptsState({ country }: { country: string }): ReactElement {
  const t = useTranslations('aiOverview.empty');
  const { setScope } = useOverview();
  const { countries } = useCountries();
  const name = useMemo(
    () => countries.find((entry) => entry.country_iso === country)?.name ?? country,
    [countries, country],
  );
  return (
    <EmptyState
      icon={MapPinOff}
      title={t('noCountryTitle', { country: name })}
      reason={t('noCountryReason')}
      headingLevel={2}
      primaryAction={
        <Button variant="secondary" onClick={() => setScope({ country: null })}>
          {t('clearCountry')}
        </Button>
      }
      secondaryAction={<PromptsLink />}
    />
  );
}

/**
 * The body when the group in the scope has no prompt that is counted: the scope bar stays, so another group can be
 * chosen, and Show all groups puts the page back to every group. A group the vocabulary does not hold (a link's)
 * is named by its id, which is all there is to name it by.
 */
export function NoGroupPromptsState({ topic }: { topic: string }): ReactElement {
  const t = useTranslations('aiOverview.shell.emptyGroup');
  const tShell = useTranslations('aiOverview.shell');
  const { scope, setScope } = useOverview();
  const { tree } = useTopicTree();
  // A group the vocabulary does not hold (deleted, or in a link) or has not yet sent is named neutrally, never by its id
  const group = tree.find((term) => term.termId === topic)?.path ?? tShell('groupUnknown');
  // A platform or another filter narrows the scope too: put all of it back, not the group alone
  const narrowed = canResetScope({ ...scope, topic: null });
  return (
    <EmptyState
      icon={FolderOpen}
      title={t('title')}
      reason={t('reason', { group })}
      headingLevel={2}
      primaryAction={
        <Button variant="secondary" onClick={() => setScope(narrowed ? RESET_PATCH : { topic: null })}>
          {narrowed ? tShell('resetScope') : t('clear')}
        </Button>
      }
      secondaryAction={<PromptsLink />}
    />
  );
}
