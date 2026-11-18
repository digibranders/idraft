import { init, use } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { describe, expect, it } from 'vitest';

// Importing the wrapper registers its chart types, which is what this test relies on
import './echart';

describe('EChart treemap', () => {
  it('renders a treemap from an option, one tile per node', () => {
    // jsdom has no canvas, so the check draws to an SVG string on the server path of ECharts
    use([SVGRenderer]);
    const chart = init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 200 });
    chart.setOption({
      animation: false,
      series: [
        {
          type: 'treemap',
          roam: false,
          breadcrumb: { show: false },
          label: { show: true },
          data: [
            { name: 'Own site', value: 60 },
            { name: 'Reviews', value: 40 },
          ],
        },
      ],
    });
    const svg = chart.renderToSVGString();
    chart.dispose();
    expect(svg).toContain('Own site');
    expect(svg).toContain('Reviews');
  });
});
