// Build: esbuild bundles (no remote code, no eval) + static assets → dist/. `--watch` for development.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, process.argv.includes('--e2e') ? 'dist-e2e' : 'dist');
const watch = process.argv.includes('--watch');
const e2e = process.argv.includes('--e2e'); // test build: handler hook + localhost host permission
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const common = { define: { __E2E__: String(e2e) }, minifySyntax: true, bundle: true, target: 'chrome138', format: 'iife', legalComments: 'none', logLevel: 'warning', minify: false, sourcemap: false };
const pages = {
  ...common,
  entryPoints: {
    sw: 'src/background/sw.ts',
    popup: 'src/popup/popup.ts',
    options: 'src/options/options.ts',
    'popup-ui': 'src/popup/popup.css',
    'options-ui': 'src/options/options.css',
  },
  outdir: dist,
  entryNames: '[name]',
  loader: { '.png': 'file' },
};
// Content script gets its CSS as text to adopt inside Shadow DOM.
const content = { ...common, entryPoints: { content: 'src/content/content.ts' }, outdir: dist, loader: { '.css': 'text' } };

function copyStatic() {
  fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
  for (const f of ['src/popup/popup.html', 'src/options/options.html']) fs.copyFileSync(path.join(root, f), path.join(dist, path.basename(f)));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  if (e2e) manifest.host_permissions = ['http://localhost/*', ...manifest.optional_host_permissions]; // no permission prompts in automation
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

if (watch) {
  const ctxs = await Promise.all([esbuild.context(pages), esbuild.context(content)]);
  copyStatic();
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('watching… (static files copied once; re-run for html/locales)');
} else {
  await Promise.all([esbuild.build(pages), esbuild.build(content)]);
  copyStatic();
  console.log('built', path.relative(root, dist), 'v' + pkg.version);
}
