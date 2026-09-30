/**
 * Makes the tested TypeScript of src/lib available to the static preview. The preview has no bundler, so
 * each module is transpiled (types stripped) to an ES module in design-preview/vendor/<set>/, and relative
 * imports get the `.js` extension a browser needs. The preview therefore runs the code the unit tests cover:
 * the layout rules, the statistics beside AI rates, and the number formatters. Run by `pnpm run preview`.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, '..', 'src', 'lib');
const outRoot = join(here, 'vendor');

/**
 * One entry per module set. `files` limits a set to modules a browser can load unaided: the date and URL
 * formatters import packages, which need a bundler.
 */
const SETS = [{ name: 'layouts' }, { name: 'stats' }, { name: 'format', files: ['number.ts', 'delta.ts'] }];

// Every way a module names a relative file: `from './x'`, `import './x'` and `import('./x')`
const RELATIVE_SPECIFIER = /((?:\bfrom|\bimport)\s*\(?\s*['"])(\.{1,2}\/[^'"]+?)(['"])/g;

const problems = [];
const written = [];
for (const set of SETS) {
  const sourceDir = join(sourceRoot, set.name);
  const outDir = join(outRoot, set.name);
  // The output holds generated files only. It is emptied first, so a module that was deleted or renamed in
  // the source does not linger in the preview.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const sources = set.files ?? readdirSync(sourceDir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  for (const name of sources) {
    const { outputText, diagnostics = [] } = ts.transpileModule(readFileSync(join(sourceDir, name), 'utf8'), {
      fileName: name,
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
    });
    for (const diagnostic of diagnostics) problems.push(`${set.name}/${name}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    const withExtensions = outputText.replace(RELATIVE_SPECIFIER, (_match, open, specifier, close) =>
      specifier.endsWith('.js') ? `${open}${specifier}${close}` : `${open}${specifier}.js${close}`,
    );
    writeFileSync(join(outDir, name.replace(/\.ts$/, '.js')), withExtensions);
  }
  written.push(`${set.name} (${sources.length})`);
}

if (problems.length > 0) {
  stderr.write(`Could not transpile the core modules:\n${problems.map((problem) => `  ${problem}`).join('\n')}\n`);
  exit(1);
}
stdout.write(`Transpiled core modules to design-preview/vendor/: ${written.join(', ')}\n`);
