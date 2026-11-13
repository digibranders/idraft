import { CITATION_KEYS } from './citation-scope';
import { DEFAULT_VIEW_ID, type SavedView } from '@/components/app/views/views-model';

/**
 * The saved views of the Citations page (23-application-patterns.md section 14, plan D14): the default and one
 * preset for each role. The date range, the inspector and the view's own id are never set by a view. "New
 * sources" waits for the New and lost tab, and stored views are WP-49's.
 */

/** The URL keys a view governs: every key of the page's own, as `useSavedView` takes them. A stable array. */
export const CITATION_VIEW_KEYS: readonly string[] = CITATION_KEYS;

type ViewName = 'default' | 'own' | 'competitors' | 'thirdParty';

/** The views, named through `citations.views` of the catalog. */
export function citationViews(name: (key: ViewName) => string): SavedView[] {
  const preset = (id: string, key: ViewName, role: string): SavedView => ({
    id,
    name: name(key),
    kind: 'preset',
    params: { role },
  });
  return [
    { id: DEFAULT_VIEW_ID, name: name('default'), kind: 'preset', params: {} },
    preset('own-domain', 'own', 'own'),
    preset('competitor-sources', 'competitors', 'competitor'),
    preset('third-party-sources', 'thirdParty', 'third_party'),
  ];
}
