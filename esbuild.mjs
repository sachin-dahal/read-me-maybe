// Build script: bundles the extension host code and the webview app.
import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {esbuild.BuildOptions} */
const shared = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: 'none',
};

const configs = [
  {
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    ...shared,
    entryPoints: ['src/webview/main.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome114',
  },
  {
    ...shared,
    entryPoints: ['src/webview/styles/index.css'],
    outfile: 'dist/webview.css',
    target: 'chrome114',
  },
];

async function copyAssets() {
  await mkdir('dist/media', { recursive: true });
  await Promise.all([
    copyFile('node_modules/mermaid/dist/mermaid.min.js', 'dist/media/mermaid.min.js'),
    copyFile('node_modules/@vscode/codicons/dist/codicon.css', 'dist/media/codicon.css'),
    copyFile('node_modules/@vscode/codicons/dist/codicon.ttf', 'dist/media/codicon.ttf'),
  ]);
}

await copyAssets();

if (watch) {
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
