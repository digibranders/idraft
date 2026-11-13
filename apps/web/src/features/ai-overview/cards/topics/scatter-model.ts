import { engineValue, type EngineValue } from './engine-values';
import type { TopicNode } from './model-types';
import { leavesOf } from './topic-nodes';

/** The size of a point, in px: the smallest topic never vanishes and the largest never hides its neighbours. */
const SIZE_FROM = 4;
const SIZE_TO = 14;
/** Never more topics named in the summary sentence. */
const LEADERS = 3;

/** One leaf topic on one engine: its mention rate and its citation rate, each with the counts behind it. */
export interface ScatterRow {
  node: TopicNode;
  mention: EngineValue;
  citation: EngineValue;
  /** Both rates are known: the topic is a point. */
  plotted: boolean;
  /** Mention minus citation in percentage points, exact; `null` for a topic that is not plotted. */
  gap: number | null;
}

/** A plotted topic. `x` and `y` are rates on the 0 to 1 scale, `size` the diameter in px. */
export interface ScatterPoint {
  row: ScatterRow;
  x: number;
  y: number;
  size: number;
}

export interface ScatterModel {
  /** Every leaf topic, the largest gap first, the topics that are not plotted after them. */
  rows: ScatterRow[];
  points: ScatterPoint[];
  /** Topics with too few answers (or none) on mention or on citation: counted, never drawn. */
  unplotted: number;
  /** The one top of both axes, so the diagonal is "cited as often as named". */
  ceiling: number;
  /** The topics named more often than cited, largest gap first: what the summary sentence points to. */
  leaders: ScatterRow[];
  /** At least one answer was given on either rate. */
  answered: boolean;
}

/** The next tenth above `highest`, at most 1. A point that sits on a tenth is not on the edge of the plot. */
function ceilingOf(highest: number): number {
  // The tiny term keeps 0.3, which is 2.9999999999999996 tenths in floating point, on its tenth
  return Math.min(1, (Math.floor(highest * 10 + 1e-9) + 1) / 10);
}

/** Diameter from the square root of the prompts, the busiest topic being the largest. */
const sizeOf = (prompts: number, most: number): number =>
  most <= 0 ? SIZE_FROM : SIZE_FROM + (SIZE_TO - SIZE_FROM) * Math.sqrt(Math.min(prompts, most) / most);

const hasRate = (value: EngineValue): boolean => value.state === 'ok' && value.value !== null;

/**
 * Citation rate against mention rate for the leaf topics of one engine (CH-15). A point needs a rate on both
 * (`ok`: from 4 valid answers); a topic with too few answers on either is counted and listed, never drawn at 0.
 */
export function scatterModel(nodes: readonly TopicNode[], code: string): ScatterModel {
  const rows = leavesOf(nodes).map((node): ScatterRow => {
    const mention = engineValue(node.engines, code, 'mentioned');
    const citation = engineValue(node.engines, code, 'cited');
    const plotted = hasRate(mention) && hasRate(citation);
    return {
      node,
      mention,
      citation,
      plotted,
      gap: plotted ? ((mention.value ?? 0) - (citation.value ?? 0)) * 100 : null,
    };
  });
  const byGap = (a: ScatterRow, b: ScatterRow): number =>
    (b.gap ?? -Infinity) - (a.gap ?? -Infinity) ||
    b.node.promptCount - a.node.promptCount ||
    a.node.name.localeCompare(b.node.name);
  const ordered = [...rows.filter((row) => row.plotted).sort(byGap), ...rows.filter((row) => !row.plotted).sort(byGap)];
  const plotted = ordered.filter((row) => row.plotted);
  const most = Math.max(0, ...plotted.map((row) => row.node.promptCount));
  const points = plotted.map((row): ScatterPoint => ({
    row,
    x: row.mention.value ?? 0,
    y: row.citation.value ?? 0,
    size: sizeOf(row.node.promptCount, most),
  }));
  return {
    rows: ordered,
    points,
    unplotted: ordered.length - points.length,
    ceiling: points.length === 0 ? 1 : ceilingOf(Math.max(...points.map((point) => Math.max(point.x, point.y)))),
    leaders: plotted.filter((row) => (row.gap ?? 0) > 0).slice(0, LEADERS),
    answered: ordered.some((row) => row.mention.answers > 0 || row.citation.answers > 0),
  };
}

/** The columns of the card's export block: per rate its percent, answers and status, then prompts, gap and whether it is drawn. */
export const SCATTER_EXPORT_HEADER: readonly string[] = [
  'topic',
  'mention_rate_percent',
  'mention_answers',
  'mention_status',
  'citation_rate_percent',
  'citation_answers',
  'citation_status',
  'prompts',
  'gap_points',
  'plotted',
];

/** What the export writes in the last column. */
export const SCATTER_PLOTTED = { yes: 'plotted', no: 'not_plotted' } as const;

export const scatterFileName = (code: string): string => `citation-vs-mention-${code}`;
