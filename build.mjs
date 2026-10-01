// Bundles src/ into one self-contained dist/floorplan.html (works from file:// or any static host).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2022', write: false });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/index.html', 'utf8').replace('<!--APP-->', () => `<script>${js}</script>`);
const out = process.env.OUT_HTML || 'dist/floorplan.html'; // separate outputs let parallel work not clobber each other
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out} ${(html.length / 1024).toFixed(0)} KB`);
