'use client';

import { ScatterChart } from 'echarts/charts';
import { use as registerModules } from 'echarts/core';

// Registered here, not in echart.tsx, so only the code that loads this module with import() pays for the
// scatter series (15-data-visualization.md section 3: its own chunk, budget 170 KB gzip). Never import it
// statically: echart-scatter.test.ts fails on that.
registerModules([ScatterChart]);

export { EChart as ScatterEChart, type EChartProps } from './echart';
