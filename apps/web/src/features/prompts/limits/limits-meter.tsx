import type { PromptsToolbarEntry } from '../seams/toolbar';

/**
 * The header's limits meter (WB-TPH-14, WB-TPH-18). A stub until T7 draws it: the seam imports it now so the entry
 * is registered, and it renders nothing.
 */
export const limitsMeter: PromptsToolbarEntry = {
  id: 'limits-meter',
  slot: 'actions',
  permission: null,
  render: () => null,
};
