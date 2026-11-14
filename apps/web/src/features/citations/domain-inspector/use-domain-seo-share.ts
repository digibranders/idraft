/**
 * What the search share of voice of a domain on the project's tracked keywords is (WB-DOM-06). No read gives it
 * yet (rank tracking is on hold, so no route measures a domain's share of the keywords' results): the one state is
 * `unavailable`, and the section says so with its reason instead of drawing a figure. The day a read exists, this
 * hook asks for it and the type gains the states of a read (loading, error, ready); nothing else about the
 * section's frame changes.
 */
export type DomainSeoShare = { status: 'unavailable' };

/** The figure of the domain in the inspector. Today it only says the figure is not available. */
export function useDomainSeoShare(): DomainSeoShare {
  return { status: 'unavailable' };
}
