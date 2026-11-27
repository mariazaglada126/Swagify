// Production build: bundles source/main.js (three.js scenes) into app.js at the site root.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const r = await build({
  entryPoints: [path.join(root, 'source/main.js')],
  outfile: path.join(root, 'app.js'),
  bundle: true, minify: true, format: 'iife', target: ['es2019'],
  nodePaths: [path.join(here, 'node_modules')],
  logLevel: 'warning', metafile: true
});
const out = Object.entries(r.metafile.outputs)[0];
console.log(`built app.js — ${(out[1].bytes / 1024).toFixed(0)} KB`);
