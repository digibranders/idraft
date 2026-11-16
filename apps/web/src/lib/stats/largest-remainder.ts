/**
 * Whole percents of shares that add up to 1, written so that they add up to 100 (the largest remainder method):
 * each share is rounded down, then the points left over go to the shares with the largest remainders. Only for the
 * figures printed beside each other under a note that says they add up to 100%; the counts behind them stay exact.
 * Shares that do not add up to 1 (a share is missing) are rounded one by one, as there is no total to keep.
 */
export function wholePercents(shares: readonly number[]): number[] {
  const scaled = shares.map((share) => share * 100);
  const floors = scaled.map((value) => Math.floor(value + 1e-9));
  const total = scaled.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 100) > 1e-6) return scaled.map((value) => Math.round(value));
  const left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = scaled
    .map((value, index) => ({ index, remainder: value - (floors[index] ?? 0) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const result = [...floors];
  for (const { index } of order.slice(0, Math.max(0, left))) result[index] = (result[index] ?? 0) + 1;
  return result;
}
