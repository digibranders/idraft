/**
 * The slugs of the component preview's sections, in the order the index lists them. A plain list with no
 * component in it, so the end-to-end and visual tests can name one test per section without loading the
 * sections themselves. `registry.ts` gives each slug its title and renderer.
 */
export const PREVIEW_SECTION_SLUGS = [
  'tokens',
  'typography',
  'sizes',
  'icons',
  'buttons',
  'forms',
  'badges',
  'tables',
  'overlays',
  'feedback',
] as const;

export type PreviewSectionSlug = (typeof PREVIEW_SECTION_SLUGS)[number];
