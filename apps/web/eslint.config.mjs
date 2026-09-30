// ESLint flat config. Design-system enforcement rules are explained in
// docs/design-system/26-implementation-guidelines.md section 9. Tailwind class rules
// (eslint-plugin-better-tailwindcss) are added in Phase 1 when the Next.js app and JSX exist.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const FORMAT_DIR = 'src/lib/format/**';

export default tseslint.config(
  { ignores: ['.tmp/**', 'node_modules/**', '.next/**', 'design-preview/vendor/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Only one component system and one icon set (ADR-DS-001, ADR-DS-004).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@radix-ui/react-dialog', message: 'Use Base UI through components/ui (ADR-DS-001).' },
            { name: 'react-icons', message: 'Use lucide-react through components/ui/icon (07-icons.md).' },
            { name: 'recharts', message: 'Use ECharts through components/app/chart (15-data-visualization.md).' },
          ],
          patterns: [
            { group: ['@mui/*', 'antd', 'antd/*', '@chakra-ui/*', '@mantine/*'], message: 'Competing component frameworks are not allowed (ADR-DS-001).' },
            { group: ['@heroicons/*', '@phosphor-icons/*', '@tabler/icons-react'], message: 'Lucide is the only icon library (07-icons.md).' },
          ],
        },
      ],
      // Colors come from tokens, never from literals in code (02-color-system.md section 10).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message: 'Hex colors are not allowed. Use a design token (CSS variable or Tailwind token utility).',
        },
        {
          selector: 'Literal[value=/\\b(rgb|rgba|hsl|hsla)\\(/]',
          message: 'Color functions are not allowed in code. Use a design token.',
        },
        {
          selector: 'Literal[value=/[\\u2013\\u2014]/]',
          message: 'Em-dashes and en-dashes are not allowed in UI text (22-content-formatting.md section 1).',
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [FORMAT_DIR, '**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Intl', property: 'NumberFormat', message: 'Use @/lib/format (22-content-formatting.md).' },
        { object: 'Intl', property: 'DateTimeFormat', message: 'Use @/lib/format (22-content-formatting.md).' },
        { property: 'toLocaleString', message: 'Use @/lib/format (22-content-formatting.md).' },
        { property: 'toLocaleDateString', message: 'Use @/lib/format (22-content-formatting.md).' },
        { property: 'toFixed', message: 'Use @/lib/format (22-content-formatting.md).' },
      ],
    },
  },
);
