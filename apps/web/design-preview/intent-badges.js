/* global document */
/**
 * Search intent as small letter badges, shared by the Keywords and Prompts mocks: I, C, T, N and L, one badge per
 * intent, so a keyword or prompt with several intents shows several badges. The tooltip (data-tip, drawn by
 * interactions.js) names the intent and says who searches like that.
 */
export const INTENTS = {
  informational: { letter: 'I', label: 'Informational', tip: 'Users who are looking for specific information and doing research.', tone: 'border-chart-1/40 bg-chart-1/10 text-chart-1' },
  commercial: { letter: 'C', label: 'Commercial', tip: 'Users who are doing an investigation before buying products or services.', tone: 'border-chart-2/40 bg-chart-2/10 text-chart-2' },
  transactional: { letter: 'T', label: 'Transactional', tip: 'Users who are ready to buy or sign up.', tone: 'border-chart-3/40 bg-chart-3/10 text-chart-3' },
  navigational: { letter: 'N', label: 'Navigational', tip: 'Users who are looking for a specific brand or site.', tone: 'border-chart-6/40 bg-chart-6/10 text-chart-6' },
  local: { letter: 'L', label: 'Local', tip: 'Users who are looking for services in a specific area.', tone: 'border-chart-4/40 bg-chart-4/10 text-chart-4' },
};

/** The intents in a fixed order (I, C, T, N, L), so the badges line up from row to row. */
const ORDER = Object.keys(INTENTS);

/** A row of badges for `keys` (lower case intent names), or a muted "n/a" when there are none. */
export function intentBadges(keys) {
  const row = document.createElement('span');
  const known = ORDER.filter((key) => keys.includes(key));
  if (known.length === 0) {
    row.className = 'text-foreground-tertiary';
    row.textContent = 'n/a';
    return row;
  }
  row.className = 'inline-flex items-center gap-1';
  row.setAttribute('role', 'list');
  known.forEach((key) => {
    const { letter, label, tip, tone } = INTENTS[key];
    const badge = document.createElement('span');
    badge.className = `inline-flex size-5 shrink-0 items-center justify-center rounded-sm border type-label font-medium ${tone}`;
    badge.setAttribute('role', 'listitem');
    badge.setAttribute('aria-label', `${label} intent`);
    badge.dataset.tip = `${label} intent. ${tip}`;
    badge.textContent = letter;
    row.append(badge);
  });
  return row;
}
