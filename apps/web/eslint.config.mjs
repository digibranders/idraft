// ESLint flat config. Design-system enforcement rules are explained in
// docs/design-system/26-implementation-guidelines.md section 9.
import path from 'node:path';
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import tailwind from 'eslint-plugin-better-tailwindcss';
import boundaries from 'eslint-plugin-boundaries';
import i18next from 'eslint-plugin-i18next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Paths are absolute, so the rules hold wherever ESLint is started from (an editor rooted at the
// repository, a hook, this folder). With relative paths the Tailwind and boundary rules switch themselves off.
const ROOT = import.meta.dirname;
const FORMAT_DIR = 'src/lib/format/**';
const SOURCES = ['src/**/*.{ts,tsx}'];
const MARKUP = ['src/**/*.tsx'];
const TESTS = ['src/**/*.test.{ts,tsx}', 'src/test/**', 'vitest.setup.ts'];

// -------------------------------------------------------------------------------------------------
// Imports

// Only one component system and one icon set (ADR-DS-001, ADR-DS-004). Each name bans its subpaths too.
const banned = (names, message) => ({ group: names.flatMap((name) => [name, `${name}/*`]), message });
const BANNED_PACKAGES = [
  banned(['react-icons'], 'Use lucide-react through components/ui/icon (07-icons.md).'),
  banned(['recharts'], 'Use ECharts through components/app/chart (15-data-visualization.md).'),
  banned(['echarts-for-react'], 'Use the in-house ECharts wrapper in components/app/chart (15-data-visualization.md).'),
  banned(['cmdk'], 'The command palette is Base UI Autocomplete in a Dialog (26 section 4).'),
  banned(['sonner'], 'Toasts use the Base UI Toast through components/ui/toast (26 section 4).'),
  banned(['react-markdown'], 'Render collected markdown through SafeMarkdown only (20 section 7.1).'),
  { group: ['@radix-ui/*', 'radix-ui', 'radix-ui/*'], message: 'Use Base UI through components/ui (ADR-DS-001).' },
  {
    group: ['@mui/*', 'antd', 'antd/*', '@chakra-ui/*', '@mantine/*'],
    message: 'Competing component frameworks are not allowed (ADR-DS-001).',
  },
  {
    group: ['@heroicons/*', '@phosphor-icons/*', '@tabler/icons-react'],
    message: 'Lucide is the only icon library (07-icons.md).',
  },
];
// A later no-restricted-imports replaces an earlier one for the same file, so every block repeats the bans.
const restrictedImports = (...patterns) => ['error', { patterns: [...BANNED_PACKAGES, ...patterns] }];

const NO_FETCHING = {
  group: ['@tanstack/react-query', '@tanstack/react-query/*', 'openapi-fetch', 'openapi-fetch/*'],
  message: 'Components do not fetch. Pass data in from a feature (26 section 2).',
};
const FORMS_ONLY = {
  group: ['react-hook-form', 'react-hook-form/*', '@hookform/*', '@/lib/forms', '@/lib/forms/*'],
  message: 'Form state belongs to a feature or to components/app/forms (26 section 2, rule 2).',
};
// What a primitive may import (26 section 2, rule 1). Anything else, including next/* and lib, is refused.
const PRIMITIVE_IMPORTS = {
  regex:
    '^(?!(react|react-dom|@base-ui/react|lucide-react|class-variance-authority|react-day-picker|@/lib/utils|@/components/ui)(/|$))(?!\\.{1,2}/)',
  message:
    'Primitives import only React, Base UI, Lucide, cva, cn and other primitives (26 section 2, rule 1). They know nothing about the product and never format values.',
};
const NO_FETCH_GLOBAL = ['error', { name: 'fetch', message: 'Components do not fetch (26 section 2).' }];

// -------------------------------------------------------------------------------------------------
// Literals

const COLOR_MESSAGE = 'Colors come from tokens, never from literals in code (02-color-system.md section 10).';
const DASH_MESSAGE = 'Em-dashes and en-dashes are not allowed in UI text (22-content-formatting.md section 1).';
// A hex color is 3, 4, 6 or 8 hex digits and nothing more: "#add-item" and "#section" are anchors.
const HEX = '/#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\\w-])/';
const COLOR_FUNCTION = '/\\b(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\\(/';
const DASH = '/[\\u2013\\u2014]/';
const literalRules = (pattern, message) => [
  { selector: `Literal[value=${pattern}]`, message },
  { selector: `TemplateElement[value.cooked=${pattern}]`, message },
  { selector: `JSXText[value=${pattern}]`, message },
];
const LITERAL_RULES = [
  ...literalRules(HEX, COLOR_MESSAGE),
  ...literalRules(COLOR_FUNCTION, COLOR_MESSAGE),
  ...literalRules(DASH, DASH_MESSAGE),
];
// On native elements the i18next rule reads only placeholder, alt, aria-label, value and title. These
// attributes are spoken or shown too, so a literal in them is caught here.
const SPOKEN_ATTRIBUTE = {
  selector:
    'JSXAttribute[name.name=/^(aria-description|aria-valuetext|aria-roledescription|aria-placeholder|label)$/] > Literal[value=/\\S/]',
  message: 'Visible text comes from messages/en.json through next-intl, not from a literal.',
};

// -------------------------------------------------------------------------------------------------
// Tailwind classes (26 section 9). A pattern is tested against the whole class, so each one allows
// variants before the utility and the important marker on either side.

const ALLOWED_STEPS = '0|0\\.5|1|1\\.5|2|3|4|5|6|8|10|12';
const OFF_SCALE_SPACING = {
  pattern: `^(.*:)?!?-?(p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|scroll-[pm][xytrblse]?)-(?!(${ALLOWED_STEPS})!?$)\\d+(\\.\\d+)?!?$`,
  message: 'Spacing uses the allowed steps only: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12 (04-spacing-density.md).',
};
const RAW_Z_INDEX = {
  pattern: '^(.*:)?!?-?z-(\\d+|\\[\\d+\\])!?$',
  message: 'Use a z-index token, for example z-(--z-dropdown) (01-foundations.md section 4).',
};
const FONT_WEIGHT = {
  pattern: '^(.*:)?!?font-(thin|extralight|light|medium|semibold|bold|extrabold|black)!?$',
  message:
    'Weight comes with the type-* utility (03-typography.md section 2). Use type-body-strong, not a weight class.',
};
const ARBITRARY_VALUE = {
  pattern: '\\[([^\\[\\]])*?\\](?!:)',
  message: 'Arbitrary values are not allowed outside components/ui. Use a token utility, or add the token first.',
};
const ARBITRARY_BREAKPOINT = {
  pattern: '(^|:)(min|max)-\\[',
  message: 'Use the breakpoints of globals.css, not an arbitrary one (19-responsive-behavior.md).',
};
// p-sidebar compiles, because named sizes live in the spacing scale. They are heights and widths.
const SIZE_AS_SPACING = {
  pattern:
    '^(.*:)?!?-?(p[xytrblse]?|m[xytrblse]?|gap(-[xy])?|space-[xy]|scroll-[pm][xytrblse]?)-(?!(auto|px)!?$)[a-z][a-z-]*!?$',
  message:
    'Named sizes are for height, width and size. Padding, margin and gap use the spacing steps (04-spacing-density.md).',
};
const EVERYWHERE = [OFF_SCALE_SPACING, SIZE_AS_SPACING, RAW_Z_INDEX, ARBITRARY_BREAKPOINT];

// -------------------------------------------------------------------------------------------------
// Import boundaries (26 section 2). Elements are folders; the first match wins.

const ELEMENTS = [
  { type: 'ui', pattern: 'src/components/ui/**', partialMatch: false },
  { type: 'app-component', pattern: 'src/components/app/**', partialMatch: false },
  { type: 'design-system', pattern: 'src/components/design-system/**', partialMatch: false },
  { type: 'feature', pattern: 'src/features/*/**', partialMatch: false, capture: ['feature'] },
  { type: 'route', pattern: 'src/app/**', partialMatch: false },
  { type: 'providers', pattern: 'src/providers/**', partialMatch: false },
  { type: 'mocks', pattern: 'src/mocks/**', partialMatch: false },
  { type: 'test-support', pattern: 'src/test/**', partialMatch: false },
  { type: 'styles', pattern: 'src/styles/**', partialMatch: false },
  { type: 'lib', pattern: ['src/lib/**', 'src/i18n/**'], partialMatch: false },
];
const FILES = [
  // cn() is the one piece of lib a primitive may use (shadcn convention), so it is named as a file.
  { category: 'class-helper', pattern: 'src/lib/utils.ts' },
  // The clients that talk to the API. Components never reach them, by alias or by relative path.
  { category: 'api-client', pattern: ['src/lib/api/client.ts', 'src/lib/api/server.ts', 'src/lib/api/query.ts'] },
  // The message catalog, and the two files that may read it. Everything else gets text through next-intl.
  { category: 'catalog', pattern: 'messages/*.json' },
  { category: 'catalog-reader', pattern: ['src/i18n/request.ts', 'src/i18n/types.d.ts'] },
  // Files Next.js loads by name. Nothing imports them.
  { category: 'entry', pattern: ['src/proxy.ts', 'src/instrumentation.ts', 'src/instrumentation.node.ts'] },
];
const to = (...types) => ({ to: { element: { types: { anyOf: types } } } });
const toFile = (category) => ({ to: { file: { categories: category } } });
const from = (type) => ({ element: { type } });
const POLICIES = [
  // 1. Primitives know nothing about the product: other primitives and the class helper only.
  { from: from('ui'), allow: to('ui') },
  { from: from('ui'), allow: toFile('class-helper') },
  // 2. Application components compose primitives and read lib. They never reach into a feature, and never fetch.
  { from: from('app-component'), allow: to('app-component', 'ui', 'lib') },
  { from: from('app-component'), disallow: toFile('api-client') },
  // 3. A feature composes components and owns its data. It never imports another feature.
  { from: from('feature'), allow: to('app-component', 'ui', 'lib', 'providers') },
  {
    from: from('feature'),
    allow: { to: { element: { type: 'feature', captured: { feature: '{{from.captured.feature}}' } } } },
  },
  // 4. Routes are thin: features, providers and server-side lib. A component reaches a route through a feature.
  { from: from('route'), allow: to('route', 'feature', 'providers', 'lib', 'styles', 'design-system') },
  // The preview sections show components. Product code never imports them; only the internal route does.
  { from: from('design-system'), allow: to('design-system', 'app-component', 'ui', 'lib') },
  { from: from('design-system'), disallow: toFile('api-client') },
  { from: from('providers'), allow: to('providers', 'ui', 'lib', 'mocks') },
  { from: from('mocks'), allow: to('mocks', 'lib') },
  { from: from('lib'), allow: to('lib') },
  { from: { file: { categories: 'catalog-reader' } }, allow: toFile('catalog') },
  { from: { file: { categories: 'entry' } }, allow: to('lib', 'mocks') },
  { from: { file: { categories: 'entry' } }, allow: toFile('entry') },
];

export default tseslint.config(
  {
    ignores: [
      '.tmp/**',
      'node_modules/**',
      '.next/**',
      'next-env.d.ts',
      'design-preview/vendor/**',
      'public/mockServiceWorker.js',
      'src/lib/api/schema.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrictedImports(),
      'no-restricted-syntax': ['error', ...LITERAL_RULES],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [FORMAT_DIR, '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['NumberFormat', 'DateTimeFormat', 'RelativeTimeFormat', 'ListFormat', 'PluralRules'].map((property) => ({
          object: 'Intl',
          property,
          message: 'Use @/lib/format (22-content-formatting.md).',
        })),
        ...['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toFixed', 'toPrecision'].map((property) => ({
          property,
          message: 'Use @/lib/format (22-content-formatting.md).',
        })),
      ],
    },
  },

  // React, hooks, accessibility and Next.js rules for the application sources.
  {
    files: SOURCES,
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser, ...globals.node },
    },
    // A fixed version: the plugin's 'detect' path calls an API that ESLint 10 removed.
    settings: { react: { version: '19.3.0' }, next: { rootDir: ROOT } },
  },
  { files: SOURCES, ...react.configs.flat['jsx-runtime'] },
  { files: SOURCES, ...reactHooks.configs.flat.recommended },
  { files: MARKUP, ...jsxA11y.flatConfigs.strict },
  { files: SOURCES, ...nextPlugin.configs['core-web-vitals'] },
  {
    files: SOURCES,
    rules: {
      // Collected content is hostile: the only HTML-producing path is SafeMarkdown (20 section 7.1).
      'react/no-danger': 'error',
      // Props are typed with TypeScript, and TypeScript reports undefined names.
      'react/prop-types': 'off',
      'no-undef': 'off',
    },
  },

  {
    // Tests hand an empty anchor to a `render` prop, which fills it: the rule reads the JSX and sees no content.
    files: TESTS,
    rules: { 'jsx-a11y/anchor-has-content': 'off' },
  },

  // Tailwind: only classes the design system registers, no conflicts, no values off the scales. Class
  // strings are read in className, cn() and cva(); write them there so they are checked.
  {
    files: SOURCES,
    plugins: { 'better-tailwindcss': tailwind },
    settings: { 'better-tailwindcss': { entryPoint: path.join(ROOT, 'src/styles/globals.css'), cwd: ROOT } },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-restricted-classes': ['error', { restrict: EVERYWHERE }],
    },
  },
  {
    files: SOURCES,
    ignores: ['src/components/ui/**'],
    rules: {
      'better-tailwindcss/no-restricted-classes': [
        'error',
        { restrict: [ARBITRARY_VALUE, FONT_WEIGHT, ...EVERYWHERE] },
      ],
    },
  },

  // Import boundaries between the layers. Tests may import anything, so they are left out.
  {
    files: SOURCES,
    ignores: TESTS,
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': ROOT,
      'boundaries/elements': ELEMENTS,
      'boundaries/files': FILES,
      'import/resolver': { typescript: { project: path.join(ROOT, 'tsconfig.json') } },
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies: POLICIES }],
      // A new folder has to be given a layer before it can be used: an unclassified file would escape every rule.
      'boundaries/no-unknown-files': 'error',
      'boundaries/no-unknown-dependencies': 'error',
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: { 'no-restricted-imports': restrictedImports(PRIMITIVE_IMPORTS), 'no-restricted-globals': NO_FETCH_GLOBAL },
  },
  {
    files: ['src/components/app/**/*.{ts,tsx}'],
    ignores: [...TESTS, 'src/components/app/forms/**'],
    rules: {
      'no-restricted-imports': restrictedImports(NO_FETCHING, FORMS_ONLY),
      'no-restricted-globals': NO_FETCH_GLOBAL,
    },
  },
  // The form components hold form state, and the component preview shows them in a live form. Neither fetches.
  {
    files: ['src/components/app/forms/**/*.{ts,tsx}', 'src/components/design-system/**/*.{ts,tsx}'],
    ignores: TESTS,
    rules: { 'no-restricted-imports': restrictedImports(NO_FETCHING), 'no-restricted-globals': NO_FETCH_GLOBAL },
  },

  // Every visible string lives in messages/en.json (20 section 3.11). The component preview and its route
  // are for the team and never translated, so they are exempt, as tests are. The rule reads prop types: a prop
  // whose type is a set of literal values (variant, size, side) is an option, not text, and is skipped.
  {
    files: MARKUP,
    ignores: ['src/components/design-system/**', 'src/app/(internal)/**', ...TESTS],
    plugins: { i18next },
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: ROOT } },
    rules: {
      // A later no-restricted-syntax replaces the earlier one for these files, so the literal rules are repeated
      'no-restricted-syntax': ['error', ...LITERAL_RULES, SPOKEN_ATTRIBUTE],
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'should-validate-template': true,
          'jsx-attributes': {
            exclude: [
              'className',
              'style',
              'type',
              'key',
              'id',
              'name',
              'role',
              'href',
              'src',
              'srcSet',
              'sizes',
              'target',
              'rel',
              'method',
              'htmlFor',
              'form',
              'autoComplete',
              'inputMode',
              'pattern',
              'width',
              'height',
              'viewBox',
              'd',
              'fill',
              'stroke',
              'xmlns',
              'lang',
              'dir',
              'data-.*',
              'aria-(controls|labelledby|describedby|details|owns|activedescendant|flowto|errormessage)',
            ],
          },
          message: 'Visible text comes from messages/en.json through next-intl, not from a literal.',
        },
      ],
    },
  },
);
