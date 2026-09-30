/**
 * Whether a card can be used in the current project by the current person (spec section 8).
 * An unavailable card is skipped in normal view and explained in customize mode and in the catalog.
 * A card the person has no permission for is hidden everywhere.
 */
import type { Availability, Capabilities, CardTypeDefinition, Channel } from './types';

const CHANNEL_NAME: Record<Channel, string> = { seo: 'SEO', ai: 'AI' };

export function cardAvailability(definition: CardTypeDefinition, capabilities: Capabilities): Availability {
  if (definition.permission !== null && !capabilities.permissions.includes(definition.permission))
    return { state: 'hidden' };

  const missing = definition.channels.all.filter((channel) => !capabilities.channels.includes(channel));
  const [firstMissing] = missing;
  if (firstMissing)
    return { state: 'unavailable', reason: `${CHANNEL_NAME[firstMissing]} tracking is off in this project` };

  const { any } = definition.channels;
  if (any.length > 0 && !any.some((channel) => capabilities.channels.includes(channel))) {
    return {
      state: 'unavailable',
      reason: `${any.map((channel) => CHANNEL_NAME[channel]).join(' and ')} tracking are off in this project`,
    };
  }

  if (definition.integration !== null && !capabilities.integrations.includes(definition.integration)) {
    return { state: 'unavailable', reason: 'This project has not connected the data source this card needs' };
  }
  return { state: 'available' };
}
