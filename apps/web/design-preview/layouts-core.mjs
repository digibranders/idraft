/**
 * Makes the layout rules of src/lib/layouts available to the static preview. The preview has no bundler, so
 * each TypeScript module is transpiled (types stripped) to an ES module in design-preview/vendor/layouts/, and
 * relative imports get the `.js` extension a browser needs. The preview therefore runs the code the unit
 * tests cover. Run by `pnpm run preview`.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, '..', 'src', 'lib', 'layouts');
const outDir = join(here, 'vendor', 'layouts');

// The output holds generated files only. It is emptied first, so a module that was deleted or renamed in the
// source does not linger in the preview.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Every way a module names a relative file: `from './x'`, `import './x'` and `import('./x')`
const RELATIVE_SPECIFIER = /((?:\bfrom|\bimport)\s*\(?\s*['"])(\.{1,2}\/[^'"]+?)(['"])/g;

const sources = readdirSync(sourceDir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
const problems = [];
for (const name of sources) {
  const { outputText, diagnostics = [] } = ts.transpileModule(readFileSync(join(sourceDir, name), 'utf8'), {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
  });
  for (const diagnostic of diagnostics) problems.push(`${name}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
  const withExtensions = outputText.replace(RELATIVE_SPECIFIER, (_match, open, specifier, close) =>
    specifier.endsWith('.js') ? `${open}${specifier}${close}` : `${open}${specifier}.js${close}`,
  );
  writeFileSync(join(outDir, name.replace(/\.ts$/, '.js')), withExtensions);
}

if (problems.length > 0) {
  stderr.write(`Could not transpile the layout modules:\n${problems.map((problem) => `  ${problem}`).join('\n')}\n`);
  exit(1);
}
stdout.write(`Transpiled ${sources.length} layout modules to design-preview/vendor/layouts/\n`);
