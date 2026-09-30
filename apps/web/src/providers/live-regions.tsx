import type { ReactNode } from 'react';

import { LIVE_REGION_ID } from '@/lib/a11y/announcer';

/**
 * The live regions `announce()` writes to (20-accessibility.md section 10.1). They are in the document
 * from the first render: a region added together with its first message is not announced by every screen
 * reader.
 *
 * `role="status"` and `role="alert"` already imply the matching `aria-live`. It is written out because
 * Base UI keeps elements with `aria-live` reachable while a modal is open and hides the rest, so a
 * message sent from a dialog would otherwise go unheard.
 */
export function LiveRegions(): ReactNode {
  return (
    <>
      <div id={LIVE_REGION_ID.polite} role="status" aria-live="polite" aria-atomic="true" className="sr-only" />
      <div id={LIVE_REGION_ID.assertive} role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" />
    </>
  );
}
