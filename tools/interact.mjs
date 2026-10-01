// Drives the real UI with mouse/keyboard and asserts the design data changes. node tools/interact.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const exe = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell`;
const xdg = `/tmp/xdg-${process.env.USER}`; mkdirSync(xdg, { recursive: true });
const env = { ...process.env, XDG_CONFIG_HOME: xdg }; delete env.DISPLAY;
const out = path.resolve(process.env.OUT || 'tools/shots'); mkdirSync(out, { recursive: true });
const PAGE = path.resolve(process.env.PAGE || 'dist/floorplan.html');
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], env });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const settle = async (n = 3) => { const f = await page.evaluate(() => app.frames); await page.waitForFunction(k => app.frames > k, f + n, { timeout: 60000 }); };
const screen = (x, y, z) => page.evaluate(([x, y, z]) => {
  const cam = app.camera(), V = cam.position.constructor, v = new V(x, y, z).project(cam);
  const r = document.querySelector('#stage canvas').getBoundingClientRect();
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}, [x, y, z]);
const item = type => page.evaluate(t => { const it = app.design.items.find(i => i.type === t); return { ...it }; }, type);
async function dragPx(from, dx, dy) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(from.x + dx * i / 8, from.y + dy * i / 8); await page.waitForTimeout(30); }
  await page.mouse.up(); await settle();
}
const shot = async name => { await settle(); await page.screenshot({ path: `${out}/${name}.png` }); console.log('  shot', name); };

await page.goto('file://' + PAGE + '?fresh&design=1&view=plan');
await page.waitForFunction(() => window.app && app.frames > 2, null, { timeout: 120000 });
await settle();

// 1. drag the leather sofa in plan view
const s0 = await item('sofaLeather');
const p0 = await screen(s0.x, 1.5, s0.z);
await dragPx(p0, 60, 40);
const s1 = await item('sofaLeather');
assert.ok(s1.x > s0.x + 1 && s1.z > s0.z + 1, `sofa moved (${s0.x},${s0.z}) → (${s1.x},${s1.z})`);
assert.equal(await page.evaluate(() => app.state.view), 'plan', 'still in plan view (drag did not pan)');
console.log('✓ drag furniture', s0.x, s0.z, '→', s1.x, s1.z);
await shot('i1-dragged');

// 2. rotate with R, then undo twice restores the original spot
await page.keyboard.press('r'); await settle();
const want = ((s0.rot + 90 + 540) % 360) - 180;
assert.equal((await item('sofaLeather')).rot, want === -180 ? 180 : want, 'R rotated +90');
await page.keyboard.press('Control+z'); await settle();
await page.keyboard.press('Control+z'); await settle();
const s2 = await item('sofaLeather');
assert.deepEqual([s2.x, s2.z, s2.rot], [s0.x, s0.z, s0.rot], 'undo restored sofa');
await page.keyboard.press('Control+y'); await settle();
assert.equal((await item('sofaLeather')).x, s1.x, 'redo re-applies move');
await page.keyboard.press('Control+z'); await settle();
console.log('✓ rotate + undo/redo');

// 3. walls mode: drag the bedroom|kitchen wall (x=16) east by ~2 ft
await page.keyboard.press('b'); await settle();
const bed0 = await page.evaluate(() => app.design.rooms.find(r => r.id === 'bed').w);
const w0 = await screen(16, 5, 26.5), w1 = await screen(18, 5, 26.5);
await dragPx(w0, w1.x - w0.x, w1.y - w0.y);
const bed1 = await page.evaluate(() => app.design.rooms.find(r => r.id === 'bed').w);
const kit1 = await page.evaluate(() => app.design.rooms.find(r => r.id === 'kitchen'));
assert.ok(bed1 > bed0 + 1, `bedroom widened ${bed0} → ${bed1}`);
assert.equal(kit1.x, 16 + (bed1 - bed0), 'kitchen shrank by the same amount');
console.log('✓ wall drag: bedroom', bed0, '→', bed1, ' kitchen x', kit1.x);
await shot('i2-wall-moved');

// 4. plot boundary is locked
const n0 = await page.evaluate(() => JSON.stringify(app.design.rooms));
const nb = await screen(26, 5, 0.37);
await dragPx(nb, 0, 60);
assert.equal(await page.evaluate(() => JSON.stringify(app.design.rooms)), n0, 'north wall did not move');
console.log('✓ plot boundary locked');

// 5. add a window on the bedroom west wall, then drag the main door along its wall
const ops0 = await page.evaluate(() => app.design.openings.length);
await page.click('#addWindow');
const ww = await screen(0.37, 5, 27);
await page.mouse.click(ww.x, ww.y); await settle();
assert.equal(await page.evaluate(() => app.design.openings.length), ops0 + 1, 'window added');
const md0 = await page.evaluate(() => app.design.openings.find(o => o.main).pos);
const mdp = await screen(md0 + 0.8, 3.5, 0.2);
await dragPx(mdp, -50, 0);
const md1 = await page.evaluate(() => app.design.openings.find(o => o.main).pos);
assert.ok(md1 < md0 - 1, `main door slid west ${md0} → ${md1}`);
console.log('✓ add window + slide door', md0, '→', md1);
await shot('i3-openings');

// 6. back to furniture, 3D view, labels + clash outline after pushing a bed into a wall
await page.keyboard.press('b'); await page.keyboard.press('o'); await settle(20);
const clash0 = await page.evaluate(() => app.clashes.size);
await page.evaluate(() => { const it = app.design.items.find(i => i.type === 'twinBed'); app.moveItem(it.id, it.x, 1.2, it.rot); app.select({ kind: 'item', id: it.id }); });
assert.ok(await page.evaluate(() => { const it = app.design.items.find(i => i.type === 'twinBed'); return (app.clashes.get(it.id) || []).includes('runs into a wall'); }), 'wall clash detected');
await shot('i4-clash-3d');
await page.keyboard.press('Control+z'); await settle();
assert.equal(await page.evaluate(() => app.clashes.size), clash0, 'clash cleared after undo');
console.log('✓ clash detect + clear');

// 7. walk mode: W/↑ forward, S/↓ back, A/← D/→ turn, E side-step, on-screen pad, letters with no e.code or no usable keydown (VDI)
await page.click('[data-view="walk"]'); await settle();
assert.ok(await page.isVisible('#walkpad'), 'walk pad shown in walk view');
assert.ok(await page.evaluate(() => !document.activeElement.closest('.toolbar')), 'focus moved off the Walk button');
const cdp = await page.context().newCDPSession(page);
const pose = () => page.evaluate(() => ({ x: app.walk.pos.x, z: app.walk.pos.z, yaw: app.walk.yaw, held: app.walk.keys.size }));
const key = k => [() => page.keyboard.down(k), () => page.keyboard.up(k)];
const noCode = ['keydown', 'keyup'].map(t => () => page.evaluate(t => dispatchEvent(new KeyboardEvent(t, { key: 'w', code: '' })), t));
const cdpNoCode = k => ['keyDown', 'keyUp'].map(type => () => cdp.send('Input.dispatchKeyEvent', { type, key: k, code: '', text: type === 'keyDown' ? k : undefined }));
const unidentified = [ // keydown carries nothing usable; auto-repeated keypress events carry the letter
  () => page.evaluate(() => {
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', code: '' }));
    const tap = () => dispatchEvent(new KeyboardEvent('keypress', { key: 'w' }));
    tap(); window.autoRepeat = setInterval(tap, 50);
  }),
  async () => {
    await page.evaluate(() => { clearInterval(window.autoRepeat); dispatchEvent(new KeyboardEvent('keyup', { key: 'Unidentified', code: '' })); });
    await page.waitForFunction(() => !app.walk.keys.size, null, { polling: 50, timeout: 10000 }).catch(() => {}); // pulse expires
  },
];
const padAt = async k => { const b = await page.locator(`#walkpad [data-key="${k}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const upPad = await padAt('ArrowUp'), downPad = await padAt('ArrowDown');
const mousePad = [async () => { await page.mouse.move(upPad.x, upPad.y); await page.mouse.down(); }, () => page.mouse.up()];
const touchPad = ['touchStart', 'touchEnd'].map(type => () => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchStart' ? [downPad] : [] }));
for (const [label, [down, up], ok] of [
  ['W', key('w'), r => r.fwd > 0.25], ['S', key('s'), r => r.fwd < -0.25],
  ['↑', key('ArrowUp'), r => r.fwd > 0.25], ['↓', key('ArrowDown'), r => r.fwd < -0.25],
  ['w, code "" (dispatchEvent)', noCode, r => r.fwd > 0.25], ['s, code "" (CDP input)', cdpNoCode('s'), r => r.fwd < -0.25],
  ['w, key "Unidentified" + keypress repeats', unidentified, r => r.fwd > 0.25], ['pad ↓ touch hold', touchPad, r => r.fwd < -0.25],
  ['pad ↑ mouse hold', mousePad, r => r.fwd > 0.25],
  ['A', key('a'), r => r.turn > 0.1 && r.fwd === 0], ['D', key('d'), r => r.turn < -0.1 && r.fwd === 0],
  ['←', key('ArrowLeft'), r => r.turn > 0.1 && r.fwd === 0], ['→', key('ArrowRight'), r => r.turn < -0.1 && r.fwd === 0],
  ['E', key('e'), r => r.side > 0.25 && r.turn === 0],
]) { // hold for 4+ frames, not ms: headless WebGL is slow
  const a = await pose(); await down(); await settle(4); await up(); const b = await pose();
  const dx = b.x - a.x, dz = b.z - a.z, s = Math.sin(a.yaw), c = Math.cos(a.yaw);
  const r = { fwd: -dx * s - dz * c, side: dx * c - dz * s, turn: b.yaw - a.yaw };
  assert.ok(ok(r) && b.held === 0, `walk ${label}: ${JSON.stringify(r)}, keys still held: ${b.held}`);
  console.log('✓ walk %s: forward %s ft, side %s ft, turn %s rad', label, r.fwd.toFixed(2), r.side.toFixed(2), r.turn.toFixed(2));
}
await shot('i5-walk');
await page.keyboard.press('Escape'); await settle();
assert.ok(!(await page.isVisible('#walkpad')), 'walk pad hidden after leaving walk');
assert.equal(await page.evaluate(() => document.activeElement.dataset.view), 'orbit', 'focus moved from the pad to the 3D button');

// 8. snapshot + export produce downloads; importing the export restores that layout
await page.keyboard.press('Escape'); await page.keyboard.press('p'); await settle();
const [png] = await Promise.all([page.waitForEvent('download'), page.click('#shot')]);
const pngPath = `${out}/i6-snapshot.png`; await png.saveAs(pngPath);
console.log('✓ snapshot download', png.suggestedFilename());
await page.click('#fileMenu summary');
const [js] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
const jsonPath = `${out}/export.json`; await js.saveAs(jsonPath);
await page.evaluate(() => { const it = app.design.items[0]; app.moveItem(it.id, it.x + 3, it.z, it.rot); });
const moved = await page.evaluate(() => app.design.items[0].x);
await page.setInputFiles('#file', jsonPath); await settle();
assert.equal(await page.evaluate(() => app.design.items[0].x), moved - 3, 'import restored exported layout');
await page.setInputFiles('#file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"rooms":[{"x":"<img src=x onerror=alert(1)>"}]}') });
await settle();
assert.equal(await page.evaluate(() => app.design.items[0].x), moved - 3, 'invalid import rejected');
console.log('✓ export/import round-trip, bad file rejected');

// 9. persistence: reload without ?fresh keeps the moved wall
await page.goto('file://' + PAGE + '?design=1&view=plan');
await page.waitForFunction(() => window.app && app.frames > 2, null, { timeout: 120000 });
assert.equal(await page.evaluate(() => app.design.rooms.find(r => r.id === 'bed').w), bed1, 'edits persisted');
console.log('✓ persisted across reload');
await page.evaluate(() => localStorage.clear());

// 9b. a save from the three-design version keeps its edits once designs 4–6 exist, and is re-saved by id
const x0 = await page.evaluate(() => {
  const old = app.designs.slice(0, 3).map(d => JSON.parse(JSON.stringify({ rooms: d.rooms, openings: d.openings, items: d.items })));
  old[0].items[0].x += 0.25;
  localStorage.setItem('ghar32.v1', JSON.stringify({ v: 1, di: 0, designs: old }));
  return old[0].items[0].x;
});
await page.goto('file://' + PAGE + '?design=1&view=plan');
await page.waitForFunction(() => window.app && app.frames > 2, null, { timeout: 120000 });
assert.deepEqual(await page.evaluate(() => ({ n: app.designs.length, x: app.designs[0].items[0].x, id4: app.designs[3].id })), { n: 7, x: x0, id4: 'aangan' }, 'old save merged');
await page.keyboard.press('6'); await settle();
assert.equal(await page.evaluate(() => app.design.id), 'lightwell', 'key 6 opens design 6');
await page.waitForFunction(() => JSON.parse(localStorage.getItem('ghar32.v1')).designs.length === 7, null, { timeout: 10000 });
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ghar32.v1')));
assert.ok(stored.designs[0].id === 'vastu' && stored.designs[0].items[0].x === x0 && stored.di === 5, 're-saved by design id');
console.log('✓ old 3-design save kept its edits; designs 4–7 added; key 6 works');
await page.evaluate(() => localStorage.clear());

// 9c. plot designs: no window in a neighbour's wall; compare shows designs 4–7
await page.goto('file://' + PAGE + '?fresh&design=4&view=plan');
await page.waitForFunction(() => window.app && app.frames > 2, null, { timeout: 120000 }); await settle();
await page.keyboard.press('b'); await settle();
const n4 = await page.evaluate(() => app.design.openings.length);
await page.click('#addWindow');
const ew = await screen(31.62, 5, 18);
await page.mouse.click(ew.x, ew.y); await settle();
assert.equal(await page.evaluate(() => app.design.openings.length), n4, 'window refused on the east party wall');
assert.match(await page.textContent('#toast'), /neighbour/, 'explains why');
await page.keyboard.press('Escape'); await page.keyboard.press('b'); await settle();
await page.click('#compareBtn'); await settle();
assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#cmpGrid .kicker')].map(k => k.textContent)), ['Design 4', 'Design 5', 'Design 6', 'Design 7'], 'compare shows designs 4–7');
await shot('i9-compare-46');
await page.click('#cmpClose');
console.log('✓ neighbour wall refuses windows; compare 4–7');

// 10. compare dialog, plan rotation, guest overlay, night mode
await page.goto('file://' + PAGE + '?fresh&design=2&view=plan');
await page.waitForFunction(() => window.app && app.frames > 2, null, { timeout: 120000 }); await settle();
await page.click('#compareBtn'); await settle();
assert.ok(await page.evaluate(() => document.querySelector('#compare').open), 'compare dialog open');
assert.equal(await page.evaluate(() => document.querySelectorAll('#cmpGrid svg').length), 3, 'three plans rendered');
await shot('i7-compare');
await page.click('#cmpClose');
assert.ok(!(await page.evaluate(() => document.querySelector('#compare').open)), 'compare dialog closed');
const az0 = await page.evaluate(() => app.controls.getAzimuthalAngle());
const mid = await screen(16, 0, 14);
await page.mouse.move(mid.x + 200, mid.y + 150); await page.mouse.down({ button: 'right' });
for (let i = 1; i <= 8; i++) { await page.mouse.move(mid.x + 200 + i * 25, mid.y + 150 - i * 20); await page.waitForTimeout(30); }
await page.mouse.up({ button: 'right' }); await settle();
const az1 = await page.evaluate(() => app.controls.getAzimuthalAngle());
assert.ok(Math.abs(az1 - az0) > 0.15, `plan rotated ${az0.toFixed(2)} → ${az1.toFixed(2)}`);
console.log('✓ compare dialog + plan rotation');
await page.click('.party .btn'); await settle();
assert.equal(await page.evaluate(() => document.querySelector('.party .btn').getAttribute('aria-pressed')), 'true', 'guests toggled on');
const cap = await page.evaluate(() => app.capacity());
assert.ok(cap.standing > 20 && cap.seated >= 11, `capacity ${cap.seated} seated + ${cap.standing} standing`);
await page.click('#night'); await settle();
assert.ok(await page.evaluate(() => app.state.night), 'night mode on');
await page.keyboard.press('o'); await settle(12);
await shot('i8-party-night');
console.log('✓ guests', cap.seated, '+', cap.standing, '+ night');

if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
else console.log('all interaction checks passed');
await browser.close();
