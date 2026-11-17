'use client';

import { useCallback, useRef, useState, type ReactElement, type ReactNode } from 'react';

import { CompetitorInspector, type CompetitorTab } from './competitor-inspector';
import { freshView, type PromptView } from './model/prompt-lists';
import { useOverview } from '../overview-context';
import { OpenCompetitorContext, type OpenCompetitor } from './open-competitor';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { DEFAULT_INSPECTOR_TAB, useInspector } from '@/components/app/inspector/use-inspector';

/**
 * Gives the Overview its competitor drawer (OV-DRW-01 to OV-DRW-08). The state is the address's: `inspect=competitor:<id>`
 * and `itab=<tab>`, so a link, Back and Forward open and close it like the other inspectors. The cards open it through
 * `useOpenCompetitor`; the drawer docks beside the page, lays over it or is a sheet by the width (`InspectorLayout`).
 * What a person narrowed the Prompts tab to is not in the address: each opening starts from its own view.
 */
export function CompetitorDrawerHost({ children }: { children: ReactNode }): ReactElement {
  const inspector = useInspector();
  const { project } = useOverview();
  const [view, setView] = useState<PromptView>(freshView());
  // The element that opened the drawer, which takes focus back when it closes
  const opener = useRef<HTMLElement | null>(null);
  const { open: openInspector, close: closeInspector } = inspector;

  const open = useCallback<OpenCompetitor>(
    (id, element, options) => {
      opener.current = element;
      // The gap card says "equal" for the prompts the model calls "close"
      setView(freshView(options?.lead === 'equal' ? 'close' : options?.lead));
      openInspector(
        { type: 'competitor', id },
        { tab: options?.lead === undefined ? DEFAULT_INSPECTOR_TAB : 'prompts' },
      );
    },
    [openInspector],
  );
  const close = useCallback((): void => {
    const target = opener.current;
    opener.current = null;
    closeInspector();
    setView(freshView());
    // After the drawer is gone, and only while the opener is still on screen
    window.requestAnimationFrame(() => {
      if (target?.isConnected === true) target.focus({ preventScroll: true });
    });
  }, [closeInspector]);
  const step = useCallback(
    (id: string): void => {
      // Another competitor keeps the lead being read and drops the narrowing, which belongs to the one before
      setView((current) => ({ lead: current.lead, absent: false, group: null }));
      openInspector({ type: 'competitor', id });
    },
    [openInspector],
  );
  const target = inspector.target;
  const drawer =
    target?.type === 'competitor' ? (
      <CompetitorInspector
        // Another project's competitor is another drawer. Stepping to another competitor of the project keeps this one,
        // and with it the focus on Next or Previous
        key={project.id}
        id={target.id}
        tab={inspector.tab}
        onTabChange={(tab: CompetitorTab) => inspector.setTab(tab)}
        onClose={close}
        onStep={step}
        view={view}
        onViewChange={setView}
      />
    ) : null;
  return (
    <OpenCompetitorContext value={open}>
      <InspectorLayout inspector={drawer}>{children}</InspectorLayout>
    </OpenCompetitorContext>
  );
}
