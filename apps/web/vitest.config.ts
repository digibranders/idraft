import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `server-only` throws when it is loaded outside a React Server Component build, which a test is
  'server-only': fileURLToPath(new URL('./src/test/server-only.ts', import.meta.url)),
};

// Two projects: pure logic runs in Node, anything that renders runs in jsdom. The file extension decides.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['src/**/*.test.ts'], environment: 'node', setupFiles: ['./vitest.msw.ts'] },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
          // https, so the `__Host-` session cookie can be set: jsdom applies the cookie prefix rules
          environmentOptions: { jsdom: { url: 'https://localhost:3000/' } },
          setupFiles: ['./vitest.msw.ts', './vitest.setup.ts'],
        },
      },
    ],
  },
});
