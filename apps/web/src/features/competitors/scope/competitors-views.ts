import { COMPETITOR_KEYS } from './scope-model';
import { DEFAULT_VIEW_ID, type SavedView } from '@/components/app/views/views-model';

/**
 * The saved views of the Competitors page (23-application-patterns.md section 14, plan D-23): the default and two
 * presets. The date range, the country, the inspector and the view's own id are never set by a view. Stored views
 * are WP-49's.
 */

/** The URL keys a view governs: every key of the page's own, as `useSavedView` takes them. A stable array. */
export const COMPETITOR_VIEW_KEYS: readonly string[] = COMPETITOR_KEYS;

type ViewName = 'default' | 'shareOfVoice' | 'brandedIncluded';

/** The views, named through `competitors.views` of the catalog. */
export function competitorViews(name: (key: ViewName) => string): SavedView[] {
  return [
    { id: DEFAULT_VIEW_ID, name: name('default'), kind: 'preset', params: {} },
    { id: 'share-of-voice', name: name('shareOfVoice'), kind: 'preset', params: { metric: 'sov' } },
    { id: 'branded-included', name: name('brandedIncluded'), kind: 'preset', params: { branded: 'include' } },
  ];
}
