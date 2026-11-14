/** A rate (or a change in rate) on the 0 to 1 scale as a percent number to two places, for a file: float noise does not reach it. */
export const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;
