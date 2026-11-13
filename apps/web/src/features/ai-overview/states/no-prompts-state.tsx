'use client';

import { MapPinOff, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { useOverview } from '../overview-context';
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
