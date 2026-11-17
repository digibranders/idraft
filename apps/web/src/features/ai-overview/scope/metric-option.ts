import { DEFAULT_METRIC, SCOPE_METRICS, type ScopeMetric } from './scope-model';

/**
 * The `metric` option value of a layout card (`visibility`, `mention`, `citation`, `share_of_voice`) and the
 * `metric` URL key of the scope (`visibility`, `mention`, `citation`, `sov`) name the same four measures. Only share
 * of voice is spelled differently, and this is the one place that knows it.
 */
const OPTION_OF_METRIC: Readonly<Record<ScopeMetric, string>> = {
  visibility: 'visibility',
  mention: 'mention',
  citation: 'citation',
  sov: 'share_of_voice',
};

/** The layout option value of a scope metric. */
export const optionOfMetric = (metric: ScopeMetric): string => OPTION_OF_METRIC[metric];

/** The scope metric of a layout option value; a value no scope metric stands for (and an absent one) is the default. */
export function metricOfOption(value: string | undefined): ScopeMetric {
  return SCOPE_METRICS.find((metric) => OPTION_OF_METRIC[metric] === value) ?? DEFAULT_METRIC;
}
