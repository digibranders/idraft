import { MOCK_LOCATIONS } from '../entity-fixtures';
import type { components } from '@/lib/api/schema';

type LocationRef = components['schemas']['LocationRef'];

/** The location of the fixtures with this id, or `undefined`: `GET /api/v1/locations` knows no other. */
export const mockLocation = (locationId: number): (typeof MOCK_LOCATIONS)[number] | undefined =>
  MOCK_LOCATIONS.find((location) => location.location_id === locationId);

/**
 * The `LocationRef` a project shows for its `default_location_id` (19 section 3.3); `null` for none. The
 * handlers store only fixture ids, so an unknown one comes from a hand-edited cookie and shows as none.
 */
export function locationRefFactory(locationId: number | null): LocationRef | null {
  const location = locationId === null ? undefined : mockLocation(locationId);
  if (!location) return null;
  return {
    location_id: location.location_id,
    name: location.name,
    country_iso: location.country_iso,
    location_type: location.location_type,
  };
}
