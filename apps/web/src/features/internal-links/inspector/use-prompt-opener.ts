import { useCallback, useState } from 'react';

import { DEFAULT_INSPECTOR_TAB, type useInspector } from '@/components/app/inspector/use-inspector';

/** Controls returned to host screens so the page drawer's AI tab can open the shared prompt inspector. */
export interface PromptOpener {
  order: readonly string[];
  openPrompt: (promptId: string, order?: readonly string[]) => void;
}

/**
 * Opens `?inspect=prompt:<id>` from inside a host whose own inspector shows pages, clearing any `itab` key left by
 * the page drawer so the prompt inspector always lands on its default Overview tab.
 */
export function usePromptOpener(inspector: ReturnType<typeof useInspector>): PromptOpener {
  const { open } = inspector;
  const [order, setOrder] = useState<readonly string[]>([]);
  const openPrompt = useCallback(
    (promptId: string, nextOrder?: readonly string[]) => {
      if (nextOrder !== undefined) setOrder(nextOrder);
      open({ type: 'prompt', id: promptId }, { tab: DEFAULT_INSPECTOR_TAB });
    },
    [open],
  );
  return { order, openPrompt };
}
