// Headless screenshots of dist/floorplan.html. Usage: node tools/shoot.mjs [name=query[;js]] ...
// With no args, shoots every design in 3D and plan. JS after ';' runs in the page before the shot.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const exe = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell`;
const xdg = `/tmp/xdg-${process.env.USER}`; mkdirSync(xdg, { recursive: true });
const env = { ...process.env, XDG_CONFIG_HOME: xdg }; delete env.DISPLAY;
const out = path.resolve(process.env.OUT || 'tools/shots'); mkdirSync(out, { recursive: true });
const url = 'file://' + path.resolve(process.env.PAGE || 'dist/floorplan.html');
const W = +(process.env.W || 1500), H = +(process.env.H || 950);

let shots = process.argv.slice(2).map(a => { const [name, rest] = a.split(/=(.*)/s); const [q, js] = rest.split(/;(.*)/s); return { name, q, js }; });
if (!shots.length) shots = [1, 2, 3].flatMap(d => [{ name: `d${d}-3d`, q: `design=${d}&still` }, { name: `d${d}-plan`, q: `design=${d}&view=plan` }]);

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
for (const s of shots) {
  await page.goto(`${url}?fresh&${s.q}`);
  await page.waitForFunction(() => window.app && window.app.frames > 2, null, { timeout: 120000 });
  if (s.js) await page.evaluate(s.js);
  const f0 = await page.evaluate(() => window.app.frames);
  await page.waitForFunction(n => window.app.frames > n, f0 + +(process.env.FRAMES || 3), { timeout: 180000 });
  await page.screenshot({ path: `${out}/${s.name}.png` });
  console.log('shot', s.name);
}
if (errors.length) console.log('CONSOLE:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
await browser.close();
