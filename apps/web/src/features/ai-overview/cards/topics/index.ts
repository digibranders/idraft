import type { CardRegistration } from '@/features/layouts';

/**
 * The cards of the topics family (WP-36): the catalog key of each card and where its code is. A card listed here
 * replaces its pending placeholder (../registry.ts); the contract is section 5 of
 * docs/superpowers/plans/2026-11-13-ai-wp-33-overview-shell.md.
 */
export const TOPIC_CARDS: Readonly<Record<string, CardRegistration>> = {};
