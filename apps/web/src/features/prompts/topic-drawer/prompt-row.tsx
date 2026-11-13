import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * One prompt in a list of the topic drawer: its text as the button that opens the prompt inspector, the Branded badge,
 * and a meta line (what the list says about it) under both. The drawer's lists of prompts share it, so a prompt looks
 * the same on the Overview, on the Prompts tab and filtered to an engine.
 */
export function PromptRow({
  text,
  isBranded,
  onOpen,
  meta,
  change,
}: {
  text: string;
  isBranded: boolean;
  onOpen: () => void;
  meta: ReactNode;
  /** How the prompt's Mention rate moved (WP-19), drawn at the end of the meta line; leave it out where there is none. */
  change?: ReactNode;
}): ReactElement {
  const words = useTranslations('prompts');
  const separator = useTranslations('inspector')('separator');
  return (
    <li className="flex flex-col gap-0.5 border-t border-border-subtle py-2 first:border-t-0 first:pt-0 last:pb-0">
      <span className="flex items-start gap-2">
        <Button variant="link" className="max-w-full min-w-0 shrink justify-start" onClick={onOpen}>
          <span className="line-clamp-2 text-left whitespace-normal">{text}</span>
        </Button>
        {isBranded ? <Badge>{words('branded')}</Badge> : null}
      </span>
      <p className="flex flex-wrap items-center gap-x-1.5 type-meta text-foreground-tertiary">
        {meta}
        {change === undefined ? null : (
          <>
            <span aria-hidden="true">{separator}</span>
            {change}
          </>
        )}
      </p>
    </li>
  );
}
