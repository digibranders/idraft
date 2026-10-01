import type { ReactElement, ReactNode } from 'react';

export interface InspectorFooterProps {
  /** Left-aligned: "Reset" while customizing cards. */
  start?: ReactNode;
  /** Before the primary button: "Cancel". */
  secondary?: ReactNode;
  /** The one primary button: "Save". */
  primary: ReactNode;
}

/**
 * The footer while a section is in edit mode (16-drawers-dialogs-popovers.md section 2.5): `surface`, a
 * hairline above, 36 px buttons on the right, one of them primary. Always-visible actions belong in the
 * header instead.
 */
export function InspectorFooter({ start, secondary, primary }: InspectorFooterProps): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle bg-surface px-5 py-3">
      {start === undefined ? null : <div className="flex items-center gap-2">{start}</div>}
      <div className="ml-auto flex items-center gap-2">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
