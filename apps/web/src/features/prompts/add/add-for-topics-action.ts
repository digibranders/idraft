import type { PromptActionEntry } from '../seams/actions';

/**
 * "Add prompt" in the bulk bar, with the selection's topics chosen (WB-BLK-09). A stub until T7 builds it: the seam
 * imports it now so the entry is registered, and it offers nothing.
 */
export const addPromptForTopicsAction: PromptActionEntry = {
  id: 'add-prompt-for-topics',
  surfaces: ['bulk'],
  permission: 'prompts:write',
  build: () => null,
};
