/**
 * Copies what the static preview needs into design-preview/vendor/, because the preview is served from this
 * folder and cannot reach node_modules: the ECharts browser bundle and the engine logos. Run by `pnpm run preview`.
 * The app itself imports ECharts from `echarts/core` with tree shaking (15-data-visualization.md section 3) and
 * renders logos through `EngineLogo` (07-icons.md section 5).
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const vendorDir = join(here, 'vendor');
mkdirSync(vendorDir, { recursive: true });

const echartsDist = join(dirname(require.resolve('echarts/package.json')), 'dist', 'echarts.min.js');
copyFileSync(echartsDist, join(vendorDir, 'echarts.min.js'));
stdout.write('Copied echarts.min.js to design-preview/vendor/\n');

// Engine logos (07-icons.md section 5): one file per engine code, from @lobehub/icons-static-svg. Both Google
// surfaces (AI Mode and AI Overview) use the Google mark. The OpenAI mark is monochrome and follows the theme.
const LOGOS = {
  chatgpt: 'openai.svg',
  gemini: 'gemini-color.svg',
  google: 'google-color.svg',
  perplexity: 'perplexity-color.svg',
  claude: 'claude-color.svg',
  copilot: 'copilot-color.svg',
};
const logoSource = join(dirname(require.resolve('@lobehub/icons-static-svg/package.json')), 'icons');
const logoDir = join(vendorDir, 'logos');
mkdirSync(logoDir, { recursive: true });
for (const [engine, file] of Object.entries(LOGOS)) copyFileSync(join(logoSource, file), join(logoDir, `${engine}.svg`));
stdout.write(`Copied ${Object.keys(LOGOS).length} engine logos to design-preview/vendor/logos/\n`);
