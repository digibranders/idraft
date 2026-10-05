import type { useTranslations } from 'next-intl';

import { isApiProblem } from '@/lib/api/problem';

type Translate = ReturnType<typeof useTranslations<'rankings.groups.refusals'>>;

/** What to say for a refused group write; `field` is where it belongs, `null` for the form as a whole. */
export function groupRefusal(error: unknown, t: Translate): { field: 'name' | null; message: string } {
  if (isApiProblem(error, 'duplicate')) return { field: 'name', message: t('duplicate') };
  if (isApiProblem(error, 'cycle_detected')) return { field: null, message: t('cycle') };
  if (isApiProblem(error, 'not_found')) return { field: null, message: t('gone') };
  if (isApiProblem(error, 'forbidden')) return { field: null, message: t('forbidden') };
  if (isApiProblem(error, 'validation_failed')) {
    const codes = new Set(error.errors.map((item) => item.code));
    if (codes.has('slash_not_allowed')) return { field: 'name', message: t('slash') };
    if (codes.has('path_too_long')) return { field: 'name', message: t('pathTooLong') };
    if (codes.has('too_deep')) return { field: null, message: t('tooDeep') };
    if (codes.has('group_unknown')) return { field: null, message: t('gone') };
  }
  return { field: null, message: t('failed') };
}
