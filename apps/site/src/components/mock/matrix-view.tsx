import { MATRIX, type MatrixRow } from './data';

const VERDICT: Record<MatrixRow['verdict'], string> = {
  'Strong in both': 'bg-surface text-ink ring-1 ring-ink/10',
  'Ranks, not named': 'bg-wash text-cobalt-deep ring-1 ring-cobalt/30',
  'Named, not ranking': 'bg-wash text-cobalt-deep ring-1 ring-cobalt/30',
  'Neither yet': 'bg-ink/5 text-ink-3',
};

/** The SEO and AI matrix: each topic with its rank and its mention rate side by side, never a combined score. */
export function MatrixView() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      <div className="overflow-hidden rounded-lg bg-surface ring-1 ring-ink/[0.06]">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="h-8 bg-paper text-[11px] font-medium text-ink-3">
              <th className="px-3 font-medium">Topic</th>
              <th className="px-3 text-right font-medium">Google rank</th>
              <th className="px-3 font-medium">Mention rate</th>
              <th className="hidden px-3 text-right font-medium sm:table-cell">Checks</th>
              <th className="px-3 font-medium">Where you stand</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((row) => (
              <tr key={row.topic} className="h-11 border-t border-line">
                <td className="px-3 font-medium text-ink">{row.topic}</td>
                <td className="px-3 text-right font-mono text-ink">{row.rank ?? <span className="text-ink-3">&gt;20</span>}</td>
                <td className="px-3">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                      <span className="block h-full rounded-full bg-cobalt" style={{ width: `${row.mentionRate}%` }} />
                    </span>
                    <span className="font-mono text-[12px] text-ink-2">{row.mentionRate}%</span>
                  </span>
                </td>
                <td className="hidden px-3 text-right font-mono text-ink-3 sm:table-cell">n={row.checks}</td>
                <td className="px-3">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${VERDICT[row.verdict]}`}>{row.verdict}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10px] text-ink-3">Each rate shows the number of checks behind it · Illustrative data</p>
    </div>
  );
}
