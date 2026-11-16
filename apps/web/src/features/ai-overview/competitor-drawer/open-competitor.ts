'use client';

import { createContext, use } from 'react';

/** Which side of the gap a count opened the drawer on: they lead, you lead, or neither leads by enough. */
export type CompetitorLead = 'they' | 'you' | 'equal';

/**
 * Opens the competitor drawer for one tracked brand (`inspect=competitor:<entity id>`). `opener` is the element to give focus
 * back to when the drawer closes. A count opens the Prompts tab with that kind of lead chosen (`options.lead`).
 */
export type OpenCompetitor = (id: string, opener: HTMLElement | null, options?: { lead?: CompetitorLead }) => void;

/** Until the drawer is built, and in a test that renders a card alone, opening a competitor does nothing. */
const NOOP: OpenCompetitor = () => undefined;

/** The provider is the competitor drawer's (O-competitor-drawer); a card only reads it through `useOpenCompetitor`. */
export const OpenCompetitorContext = createContext<OpenCompetitor>(NOOP);

export function useOpenCompetitor(): OpenCompetitor {
  return use(OpenCompetitorContext);
}
