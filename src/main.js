import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import * as P from './plan.js';
import { DESIGNS } from './designs.js';
import { CATALOG, GROUP_LABEL, buildItem, tickModels, mat } from './models.js';
import { buildStructure, FLOOR_NAMES } from './structure.js';
import { capacity, metrics, planSVG } from './compare.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clone = o => JSON.parse(JSON.stringify(o));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const STORE = 'ghar32.v1', SNAP = 0.25, EYE = 5.2;
const snap = v => Math.round(v / SNAP) * SNAP;
const normRot = r => { r = ((Math.round(r) % 360) + 360) % 360; return r > 180 ? r - 360 : r; };
const fmt = P.fmtFt;

// ------------------------------------------------------------------ state & persistence
const params = new URLSearchParams(location.search);
const state = { di: 0, view: 'orbit', mode: 'arrange', wallMode: 'auto', labels: true, night: params.has('night') };
const OPEN_TYPES = new Set(['door', 'window', 'vent', 'arch', 'almirah']);
const num = v => typeof v === 'number' && Number.isFinite(v);
const str = (v, n = 60) => typeof v === 'string' && v.length <= n;

// Geometry-only validation for anything read from storage or an imported file.
function validDesign(d) {
  return !!d && Array.isArray(d.rooms) && Array.isArray(d.openings) && Array.isArray(d.items)
    && d.rooms.length > 0 && d.rooms.length <= 60 && d.openings.length <= 150 && d.items.length <= 400
    && d.rooms.every(r => r && str(r.id) && str(r.name) && [r.x, r.z, r.w, r.d].every(num) && r.w >= P.MIN_ROOM && r.d >= P.MIN_ROOM
      && Math.abs(r.x) < 200 && Math.abs(r.z) < 200 && r.w < 200 && r.d < 200 && (r.zone === undefined || str(r.zone)) && (r.floor === undefined || str(r.floor)) && (r.wall === undefined || str(r.wall)))
    && d.openings.every(o => o && OPEN_TYPES.has(o.type) && (o.axis === 'h' || o.axis === 'v') && [o.at, o.pos, o.w].every(num) && o.w >= 1 && o.w <= 20)
    && d.items.every(it => it && Object.hasOwn(CATALOG, it.type) && [it.x, it.z, it.rot].every(num) && Math.abs(it.x) < 300 && Math.abs(it.z) < 300
      && (it.w === undefined || (num(it.w) && it.w > 0.2 && it.w < 40)) && (it.d === undefined || (num(it.d) && it.d > 0.2 && it.d < 40)) && (it.v === undefined || num(it.v)));
}
// Text, plot and shed always come from the shipped design; only geometry is user data.
function normalize(d, i) {
  const out = { ...clone(DESIGNS[i]), rooms: d.rooms, openings: d.openings, items: d.items };
  const seen = new Set();
  out.items.forEach((it, k) => {
    let id = str(it.id) ? it.id : `${it.type}-${k}`;
    while (seen.has(id)) id += '_';
    seen.add(id); it.id = id;
  });
  return out;
}
function load() {
  if (!params.has('fresh')) try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (raw && raw.v === 1 && Array.isArray(raw.designs) && raw.designs.length <= 60) {
      // Saved layouts are matched by design id; older saves had no ids and were stored in design order.
      // Designs added since the save start fresh, and the client's edits to the others are kept.
      const saved = (d, i) => raw.designs.find(s => s?.id === d.id) || (raw.designs[i] && !raw.designs[i].id ? raw.designs[i] : null);
      state.di = Math.min(DESIGNS.length - 1, Math.max(0, raw.di | 0));
      return DESIGNS.map((d, i) => { const s = saved(d, i); return normalize(s && validDesign(s) ? s : clone(d), i); });
    }
  } catch { /* unreadable storage → start from the shipped designs */ }
  return DESIGNS.map((d, i) => normalize(clone(d), i));
}
const designs = load();
if (params.has('design')) state.di = Math.min(DESIGNS.length - 1, Math.max(0, (parseInt(params.get('design'), 10) || 1) - 1));
let D = designs[state.di];
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ v: 1, di: state.di, designs: designs.map(d => ({ id: d.id, rooms: d.rooms, openings: d.openings, items: d.items })) })); }
    catch { /* storage full or blocked: edits stay in memory */ }
  }, 250);
}

let walls = [], S = null, obst = { solids: [], swings: [] }, clashes = new Map();
let sel = null, drag = null, pendingAdd = null, needsStructure = false;
const undoStack = [], redoStack = [];

// ------------------------------------------------------------------ renderer, scene, lights
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
stage.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.className = 'label-layer';
stage.appendChild(labelRenderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
const skyTex = (stops) => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach(([k, col]) => gr.addColorStop(k, col));
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
const SKY = { day: skyTex([[0, '#a7c4d6'], [0.6, '#dfe7e6'], [1, '#f2ece1']]), night: skyTex([[0, '#0d1428'], [0.6, '#27304f'], [1, '#4a3b4f']]) };
scene.background = SKY.day;
scene.fog = new THREE.Fog('#e8e3d8', 140, 360);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;
const hemi = new THREE.HemisphereLight('#fff5e6', '#7f8f68', 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff0da', 3.0);
sun.position.set(40, 62, 58);
sun.target.position.set(16, 0, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 10, far: 170 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
scene.add(sun, sun.target);

const structureRoot = new THREE.Group(), furnGroup = new THREE.Group(), overlay = new THREE.Group();
scene.add(structureRoot, furnGroup);
const overlayScene = new THREE.Scene(); // drawn after post-processing so outlines stay crisp
overlayScene.add(overlay);
const viz = { sel: new THREE.Group(), clash: new THREE.Group(), hover: new THREE.Group(), wall: new THREE.Group(), measure: new THREE.Group(), grips: new THREE.Group() };
Object.values(viz).forEach(g => overlay.add(g));
const grid = new THREE.GridHelper(120, 120, '#8a7f70', '#8a7f70');
grid.material.transparent = true; grid.material.opacity = 0.18; grid.material.depthWrite = false;
grid.position.set(16, 0.03, 16); grid.visible = false; overlay.add(grid);
const itemMeshes = new Map();
let spinners = [], highParts = [], tags = [];
const TAGS = { fridge: 'Fridge', washer: 'WM', counterStove: 'Hob', counterSink: 'Sink', wc: 'WC', shower: 'Shower', basin: 'Basin', partyBox: 'JBL', tvUnit: 'TV', fan: 'Fan', rack: 'Rack', shoeRack: 'Shoes', diningTable: 'Dining', twinBed: 'Twin', queenBed: 'Queen' };

// ------------------------------------------------------------------ cameras & controls
const persp = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.3, 700);
// Soft ambient occlusion in 3D/walk views. Auto-disables on slow GPUs; ?ao=0 / ?ao=1 forces it.
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, persp), gtao = new GTAOPass(scene, persp, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 2.6, distanceExponent: 1.0, thickness: 3, scale: 1.9, samples: 24 });
gtao.updatePdMaterial({ lumaPhi: 20, depthPhi: 3, normalPhi: 4, radius: 9, rings: 3, samples: 24 });
gtao.blendIntensity = 1;
composer.addPass(renderPass); composer.addPass(gtao); composer.addPass(new OutputPass());
composer.setPixelRatio(renderer.getPixelRatio());
const aoParam = params.get('ao'), perf = { sum: 0, n: 0 };
let aoOn = aoParam !== '0';
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
let camera = persp;
const controls = new OrbitControls(persp, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.maxPolarAngle = Math.PI * 0.47; controls.minDistance = 6; controls.maxDistance = 170;
let tween = null;

function extents() {
  let x0 = 0, x1 = D.plot.w, z0 = -(D.shed?.depth || 0), z1 = D.plot.d;
  for (const r of D.rooms) { x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x + r.w); z0 = Math.min(z0, r.z); z1 = Math.max(z1, r.z + r.d); }
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}
function orbitHome() {
  const e = extents(), v = D.view3d || {}, t = new THREE.Vector3(e.cx, 0, v.tz ?? e.z1 / 2 + 1), r = Math.min(160, 60 * Math.max(1, 1.3 * innerHeight / innerWidth)), phi = 0.9, th = v.th ?? 0.6;
  return { pos: new THREE.Vector3(t.x + r * Math.sin(phi) * Math.sin(th), r * Math.cos(phi), t.z + r * Math.sin(phi) * Math.cos(th)), target: t };
}
const leftUi = () => (innerWidth > 860 && !$('#info').classList.contains('collapsed') ? 360 : 0);
const PAD_T = 70, PAD_B = 92;
let orthoUpp = 1;
// Fit the plan into the screen area not covered by the side panel, top bar and toolbar.
// A pixel view offset (not a shifted frustum) keeps the centre correct at any zoom.
function fitOrtho() {
  const e = extents(), pad = 4, padL = leftUi(), dy = Math.max(0, PAD_B - PAD_T);
  orthoUpp = Math.max((e.x1 - e.x0 + pad * 2) / (innerWidth - padL), (e.z1 - e.z0 + pad * 2) / (innerHeight - PAD_T - PAD_B));
  const fullW = innerWidth + padL, fullH = innerHeight + dy;
  Object.assign(ortho, { left: -fullW * orthoUpp / 2, right: fullW * orthoUpp / 2, top: fullH * orthoUpp / 2, bottom: -fullH * orthoUpp / 2 });
  ortho.setViewOffset(fullW, fullH, 0, dy, innerWidth, innerHeight);
  ortho.updateProjectionMatrix();
}
// Shift the 3D view so the house centres in the area right of the side panel.
function fitPersp() {
  const l = state.view === 'walk' ? 0 : leftUi();
  persp.aspect = (innerWidth + l) / innerHeight;
  if (l) persp.setViewOffset(innerWidth + l, innerHeight, 0, 0, innerWidth, innerHeight); else persp.clearViewOffset();
  persp.updateProjectionMatrix();
}
function flyTo(pos, target, ms = 750) {
  tween = { p0: persp.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), ms };
}
function stepTween(now) {
  if (!tween) return;
  let k = Math.min(1, (now - tween.start) / tween.ms);
  k = 1 - Math.pow(1 - k, 3);
  persp.position.lerpVectors(tween.p0, tween.p1, k);
  controls.target.lerpVectors(tween.t0, tween.t1, k);
  if (k >= 1) tween = null;
}

function setView(v) {
  const prev = state.view;
  state.view = v;
  $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  document.body.classList.toggle('walking', v === 'walk');
  if (prev === 'walk' && v !== 'walk') { walk.keys.clear(); persp.fov = 42; persp.updateProjectionMatrix(); if (document.activeElement?.closest('#walkpad')) $(`[data-view="${v}"]`).focus(); } // the pad hides: keep its focus in the toolbar
  if (v === 'walk') enterWalk();
  else if (v === 'plan') {
    camera = ortho; controls.object = ortho; controls.enabled = true; controls.enableRotate = true; controls.zoomToCursor = true;
    controls.minPolarAngle = controls.maxPolarAngle = 0.0005; // top-down; right-drag spins the map
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    const e = extents();
    controls.target.set(e.cx, 0, e.cz); ortho.position.set(e.cx, 150, e.cz + 0.01); ortho.zoom = 1; fitOrtho();
    tween = null;
  } else {
    camera = persp; controls.object = persp; controls.enabled = true; controls.enableRotate = true; controls.zoomToCursor = false;
    controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI * 0.47;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    const h = orbitHome();
    if (prev === 'plan') { persp.position.set(h.target.x, 95, h.target.z + 6); controls.target.copy(h.target); }
    if (prev !== 'orbit') flyTo(h.pos, h.target, 1000);
  }
  fitPersp();
  controls.update();
  $$('[data-wall]').forEach(b => { b.disabled = v !== 'orbit'; });
  applyViewStyle();
  updateHint();
}

// ------------------------------------------------------------------ walk mode
const walk = { yaw: Math.PI, pitch: -0.06, keys: new Set(), pos: new THREE.Vector3(), look: null };
// Keys are tracked by physical position (e.code) AND by label (e.key → 'KeyW'): remote desktops/VDI
// send typed letters with an empty code, and on AZERTY/Dvorak the W label sits on another physical key.
const keyIds = e => [e.code, /^[a-z]$/i.test(e.key) ? `Key${e.key.toUpperCase()}` : e.key].filter(id => id && id !== 'Unidentified');
function enterWalk() {
  camera = persp; controls.enabled = false; tween = null;
  // Take focus off the clicked Walk button (Enter there restarts at the door) or a form field (swallows keys).
  if (document.activeElement !== document.body) { document.activeElement?.blur(); $('#walkpad button').focus(); }
  const m = D.openings.find(o => o.main), e = extents();
  walk.pos.set(m ? m.pos : D.plot.w / 2, EYE, 2.6);
  walk.yaw = Math.atan2(-(e.cx - walk.pos.x), -(D.plot.d * 0.55 - walk.pos.z)); walk.pitch = -0.12;
  persp.fov = 70; persp.updateProjectionMatrix();
  deselect();
}
function blocked(x, z) {
  const R = 0.7;
  return obst.solids.some(s => x > s.x0 - R && x < s.x1 + R && z > s.z0 - R && z < s.z1 + R);
}
function walkStep(dt) {
  const on = (...ids) => ids.some(id => walk.keys.has(id)); // booleans subtract to -1/0/1 below
  const f = on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown');
  const s = on('KeyE') - on('KeyQ'); // side-step
  walk.yaw += (on('KeyA', 'ArrowLeft') - on('KeyD', 'ArrowRight')) * 1.9 * dt;
  if (f || s) {
    const sp = (on('Shift', 'ShiftLeft', 'ShiftRight') ? 11 : 6) * dt;
    const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw), rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
    let mx = fx * f + rx * s, mz = fz * f + rz * s;
    const L = Math.hypot(mx, mz); mx *= sp / L; mz *= sp / L;
    if (!blocked(walk.pos.x + mx, walk.pos.z)) walk.pos.x += mx;
    if (!blocked(walk.pos.x, walk.pos.z + mz)) walk.pos.z += mz;
  }
  persp.position.copy(walk.pos);
  persp.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
}

// ------------------------------------------------------------------ building the scene
function disposeTree(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.isCSS2DObject) o.element.remove();
  });
}
function clearGroup(g) { for (const c of [...g.children]) { g.remove(c); disposeTree(c); } }

function rebuildStructure() {
  walls = P.deriveWalls(D);
  if (S) { structureRoot.remove(S.group); disposeTree(S.group); }
  S = buildStructure(D, walls);
  structureRoot.add(S.group);
  obst = P.obstacles(D, walls);
  buildLamps();
  drawGrips();
  applyViewStyle();
  refreshClashes();
  renderInfo();
  if (sel?.kind === 'opening') { if (!D.openings[sel.idx]) sel = null; renderInspector(); drawSelection(); }
}
function addItemMesh(it) {
  const g = buildItem(it);
  furnGroup.add(g); itemMeshes.set(it.id, g);
  g.traverse(o => { if (o.userData.spin) spinners.push(o); if (o.userData.high) { o.userData.item = it; highParts.push(o); } });
  if (TAGS[it.type]) {
    const t = new CSS2DObject(el('div', 'item-tag', TAGS[it.type]));
    t.position.y = 3; g.add(t); tags.push(t);
    t.visible = state.view === 'plan' && state.labels;
  }
  for (const o of highParts) if (o.parent && state.view === 'plan') o.visible = false;
}
function rebuildFurniture() {
  clearGroup(furnGroup); itemMeshes.clear(); spinners = []; highParts = []; tags = [];
  D.items.forEach(addItemMesh);
}
function removeItemMesh(id) {
  const g = itemMeshes.get(id);
  if (!g) return;
  furnGroup.remove(g); disposeTree(g); itemMeshes.delete(id);
  const inside = o => { let p = o; while (p && p !== g) p = p.parent; return p === g; };
  spinners = spinners.filter(o => !inside(o)); highParts = highParts.filter(o => !inside(o)); tags = tags.filter(o => !inside(o));
}
function syncItem(it, rebuild = false) {
  if (rebuild) { removeItemMesh(it.id); addItemMesh(it); return; }
  const g = itemMeshes.get(it.id);
  g.position.set(it.x, 0, it.z); g.rotation.y = it.rot * Math.PI / 180;
}
function rebuildAll() { rebuildStructure(); rebuildFurniture(); drawSelection(); renderInspector(); }

function applyViewStyle() {
  if (!S) return;
  const plan = state.view === 'plan', walkV = state.view === 'walk';
  S.ceilings.visible = walkV;
  overlay.visible = !walkV;
  S.openLines.visible = state.mode === 'walls' && !walkV;
  for (const l of S.labels) l.visible = state.labels && !walkV;
  S.dims.visible = state.labels && plan;
  if (S.shed) { S.shed.roof.material.opacity = plan ? 0.28 : 1; S.shed.roof.material.depthWrite = !plan; S.shed.frame.visible = true; }
  if (plan || walkV) for (const p of S.parts) p.upper.visible = walkV; // plan is cut at 3½ ft like a drawing
  for (const o of highParts) o.visible = !plan;
  for (const t of tags) t.visible = plan && state.labels;
  $('#scalebar').hidden = !plan;
  if (!plan) { labelRenderer.domElement.classList.remove('tight'); lastScale = ''; }
}
function applyCutaway() {
  const cp = camera.position, all = state.wallMode === 'full', none = state.wallMode === 'cut';
  for (const p of S.parts) p.upper.visible = all || (!none && p.ext && (cp.x - p.cx) * p.nx + (cp.z - p.cz) * p.nz <= 0);
  for (const h of highParts) h.visible = all || (!none && hostVisible(h));
  if (S.shed) { const fade = cp.z < 1 && cp.y > 14; S.shed.roof.material.opacity = fade ? 0.14 : 1; S.shed.roof.material.depthWrite = !fade; }
}
// Is the wall a wall-mounted item hangs on still shown at full height?
function hostVisible(mesh) {
  const it = mesh.userData.item;
  if (!it) return true;
  for (const p of S.parts) {
    const across = p.axis === 'h' ? it.z : it.x, along = p.axis === 'h' ? it.x : it.z;
    if (Math.abs(across - p.line) < 1.7 && along > p.a - 0.2 && along < p.b + 0.2) return p.upper.visible;
  }
  return true;
}

// ------------------------------------------------------------------ overlays
const onTop = { depthTest: false, depthWrite: false, transparent: true, toneMapped: false };
const M = {
  sel: new THREE.LineBasicMaterial({ color: '#b4532a', ...onTop }),
  selFill: new THREE.MeshBasicMaterial({ color: '#b4532a', opacity: 0.16, ...onTop }),
  clash: new THREE.LineBasicMaterial({ color: '#d92d20', ...onTop }),
  clashFill: new THREE.MeshBasicMaterial({ color: '#d92d20', opacity: 0.24, ...onTop }),
  hover: new THREE.LineBasicMaterial({ color: '#2f5d58', ...onTop }),
  wall: new THREE.MeshBasicMaterial({ color: '#f07b3c', opacity: 0.62, ...onTop }),
  locked: new THREE.MeshBasicMaterial({ color: '#8a8378', opacity: 0.35, ...onTop }),
  measure: new THREE.LineBasicMaterial({ color: '#2f5d58', ...onTop }),
};
const itemById = id => D.items.find(i => i.id === id);
const dims = it => { const c = CATALOG[it.type]; return { w: it.w ?? c.w, d: it.d ?? c.d, h: c.h }; };
function itemBox(it) { const d = dims(it); return P.obb(it.x, it.z, d.w, d.d, it.rot); }
function aabb(it) {
  const b = itemBox(it), hx = b.hw * Math.abs(b.ux[0]) + b.hd * Math.abs(b.uz[0]), hz = b.hw * Math.abs(b.ux[1]) + b.hd * Math.abs(b.uz[1]);
  return { x0: it.x - hx, x1: it.x + hx, z0: it.z - hz, z1: it.z + hz, hx, hz };
}
function footprint(it, line, fill, y) {
  const pts = P.obbCorners(itemBox(it)).map(([x, z]) => new THREE.Vector3(x, y, z));
  const g = new THREE.Group();
  g.renderOrder = 10;
  g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), line));
  g.children[0].renderOrder = 11;
  if (fill) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, p.z)))), fill);
    m.rotation.x = Math.PI / 2; m.position.y = y - 0.005; m.renderOrder = 10; g.add(m);
  }
  return g;
}
function flatBox(r, y0, y1, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0 + 0.06, y1 - y0, r.z1 - r.z0 + 0.06), material);
  m.position.set((r.x0 + r.x1) / 2, (y0 + y1) / 2, (r.z0 + r.z1) / 2); m.renderOrder = 10;
  return m;
}
function drawSelection() {
  clearGroup(viz.sel); clearGroup(viz.measure);
  labelRenderer.domElement.classList.toggle('focus', sel?.kind === 'item');
  if (!sel) return;
  if (sel.kind === 'item') {
    const it = itemById(sel.id);
    if (!it) return;
    viz.sel.add(footprint(it, M.sel, M.selFill, 0.08));
    drawClearances(it);
  } else {
    const o = D.openings[sel.idx], w = o && walls.find(w => w.kind !== 'open' && w.axis === o.axis && Math.abs(w.at - o.at) < 1e-3 && o.pos >= w.a && o.pos <= w.b);
    if (w) viz.sel.add(flatBox(P.wallRect(w, o.pos - o.w / 2, o.pos + o.w / 2), 0, o.type === 'window' || o.type === 'vent' ? 8 : 7.2, M.wall));
  }
}
// Distance from the selected item's edges to the nearest wall/furniture on each side.
function clearances(it) {
  const box = aabb(it), res = {};
  const targets = [...obst.solids, ...D.items.filter(o => o !== it && CATALOG[o.type].solid !== false).map(aabb)];
  const put = (k, d, at) => { if (d > -0.02 && (!res[k] || d < res[k].d)) res[k] = { d: Math.max(0, d), at }; };
  for (const t of targets) {
    const zo = t.z1 > box.z0 + 0.02 && t.z0 < box.z1 - 0.02, xo = t.x1 > box.x0 + 0.02 && t.x0 < box.x1 - 0.02;
    const cz = (Math.max(t.z0, box.z0) + Math.min(t.z1, box.z1)) / 2, cx = (Math.max(t.x0, box.x0) + Math.min(t.x1, box.x1)) / 2;
    if (zo && t.x1 <= box.x0 + 0.02) put('W', box.x0 - t.x1, cz);
    if (zo && t.x0 >= box.x1 - 0.02) put('E', t.x0 - box.x1, cz);
    if (xo && t.z1 <= box.z0 + 0.02) put('N', box.z0 - t.z1, cx);
    if (xo && t.z0 >= box.z1 - 0.02) put('S', t.z0 - box.z1, cx);
  }
  return { box, res };
}
function drawClearances(it) {
  if (CATALOG[it.type].wall || state.view === 'walk') return;
  const { box, res } = clearances(it), y = 0.12;
  for (const [k, r] of Object.entries(res)) {
    if (r.d < 0.05 || r.d > 24) continue;
    const a = k === 'W' ? [box.x0, r.at] : k === 'E' ? [box.x1, r.at] : k === 'N' ? [r.at, box.z0] : [r.at, box.z1];
    const b = k === 'W' ? [box.x0 - r.d, r.at] : k === 'E' ? [box.x1 + r.d, r.at] : k === 'N' ? [r.at, box.z0 - r.d] : [r.at, box.z1 + r.d];
    const pts = [new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1])];
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.measure); ln.renderOrder = 11; viz.measure.add(ln);
    const lab = el('div', 'dim-label measure', fmt(r.d));
    lab.style.cssText = 'background:#2f5d58;color:#fff;font-size:11px;padding:2px 5px';
    const o = new CSS2DObject(lab); o.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    viz.measure.add(o);
  }
}
// Night mode: warm ceiling lamps in every room + one under the shed; dusk sky, moonlight, glowing windows.
const lamps = new THREE.Group(); scene.add(lamps);
const bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe2b0' });
function buildLamps() {
  clearGroup(lamps);
  const spots = D.rooms.filter(r => r.w * r.d > 30 && !r.open).map(r => [r.x + r.w / 2, r.z + r.d / 2, r.w * r.d > 150 ? 22 : 12]);
  const m = D.openings.find(o => o.main);
  if (m && D.shed) spots.push([m.pos, -2.5, 10]);
  for (const [x, z, power] of spots) {
    const l = new THREE.PointLight('#ffcf94', power, 0, 1.15); l.position.set(x, 8.6, z); lamps.add(l);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), bulbMat); b.position.copy(l.position); lamps.add(b);
  }
  lamps.visible = state.night;
}
function applyLighting() {
  const n = state.night;
  scene.background = n ? SKY.night : SKY.day;
  scene.fog.color.set(n ? '#1d2236' : '#e8e3d8');
  scene.environmentIntensity = n ? 0.1 : 0.42;
  hemi.intensity = n ? 0.16 : 0.75; hemi.color.set(n ? '#5c6f9e' : '#fff5e6'); hemi.groundColor.set(n ? '#1c2118' : '#7f8f68');
  sun.intensity = n ? 0.35 : 3.0; sun.color.set(n ? '#9db2ff' : '#fff0da');
  renderer.toneMappingExposure = n ? 1.25 : 1.02;
  lamps.visible = n;
  const g = mat('glass'); // shared by windows and the shower: lit panes glow from outside at night
  g.emissive.set(n ? '#ffc877' : '#000000'); g.emissiveIntensity = n ? 0.55 : 0; g.opacity = n ? 0.55 : 0.22;
  $('#night').setAttribute('aria-pressed', String(n));
}

// Walls mode: a grip on every movable wall line so users can see what is draggable.
function drawGrips() {
  clearGroup(viz.grips);
  if (state.mode !== 'walls') return;
  const seen = new Set();
  for (const w of walls) {
    if (P.isLocked(w.axis, w.at, D.plot) || w.b - w.a < 1.5) continue;
    const g = P.lineGroup(D, w.axis, w.at, w.a, w.b), key = `${w.axis}${w.at}:${g.lo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mid = (Math.max(g.lo, w.a) + Math.min(g.hi, w.b)) / 2;
    const o = new CSS2DObject(el('div', 'grip', w.axis === 'h' ? '↕' : '↔'));
    o.position.set(w.axis === 'h' ? mid : w.at, 0.4, w.axis === 'h' ? w.at : mid);
    viz.grips.add(o);
  }
}
// Fade room labels that sit behind a full-height wall from the camera's point of view.
const occl = new THREE.Raycaster(), tmpV = new THREE.Vector3();
// Only matters with full-height walls; a label stays if any of 5 sample points in its room is visible.
function occludeLabels() {
  const on = state.view === 'orbit';
  const blockers = on ? S.pickWalls.filter(m => m.parent.visible && m.material.visible !== false) : [];
  for (const l of S.labels) {
    if (!on) { l.element.classList.remove('behind'); continue; }
    l.getWorldPosition(tmpV);
    const seen = [[0, 0], [-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]].some(([dx, dz]) => {
      const p = new THREE.Vector3(tmpV.x + dx, 1.2, tmpV.z + dz), d = camera.position.distanceTo(p);
      occl.set(camera.position, p.sub(camera.position).normalize()); occl.far = d - 0.6;
      return occl.intersectObjects(blockers, false).length === 0;
    });
    l.element.classList.toggle('behind', !seen);
  }
}

let openIssues = [], lostRooms = [];
function refreshClashes() {
  clashes = P.findClashes(D, walls, CATALOG);
  openIssues = P.openingProblems(D, walls); lostRooms = P.unreachableRooms(D, walls);
  updateParty(); if (guestsOn) drawGuests();
  clearGroup(viz.clash);
  for (const id of clashes.keys()) { const it = itemById(id); if (it) viz.clash.add(footprint(it, M.clash, M.clashFill, 0.06)); }
  renderWarnings();
}

// ------------------------------------------------------------------ edits, undo
function commit(before) {
  if (before === JSON.stringify(D)) return;
  undoStack.push(before); if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0; updateUndo(); save();
}
function restore(json) {
  const d = JSON.parse(json);
  D.rooms = d.rooms; D.openings = d.openings; D.items = d.items;
  sel = null; rebuildAll(); updateUndo(); save();
}
function undo() { if (undoStack.length) { redoStack.push(JSON.stringify(D)); restore(undoStack.pop()); toast('Undone'); } }
function redo() { if (redoStack.length) { undoStack.push(JSON.stringify(D)); restore(redoStack.pop()); toast('Redone'); } }
function updateUndo() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }

function select(s) { sel = s; drawSelection(); renderInspector(); }
function deselect() { if (sel) select(null); }
function rotateSel(deg) {
  const it = sel?.kind === 'item' && itemById(sel.id);
  if (!it) return;
  if (CATALOG[it.type].wall) return toast('Wall-mounted: drag it to another wall instead');
  const before = JSON.stringify(D);
  it.rot = normRot(it.rot + deg); syncItem(it); commit(before); afterItemChange();
}
function deleteSel() {
  const before = JSON.stringify(D);
  if (sel?.kind === 'item') { D.items = D.items.filter(i => i.id !== sel.id); removeItemMesh(sel.id); select(null); refreshClashes(); }
  else if (sel?.kind === 'opening') { D.openings.splice(sel.idx, 1); sel = null; rebuildStructure(); drawSelection(); renderInspector(); }
  else return;
  commit(before);
}
function newId(type) { return `${type}-${Date.now().toString(36)}${Math.floor(performance.now() % 1000)}`; }
function duplicate() {
  const it = sel?.kind === 'item' && itemById(sel.id);
  if (!it) return;
  const before = JSON.stringify(D), cp = { ...clone(it), id: newId(it.type), x: it.x + 1, z: it.z + 1 };
  D.items.push(cp); addItemMesh(cp); commit(before); select({ kind: 'item', id: cp.id }); refreshClashes();
}
function addItem(type) {
  const c = CATALOG[type];
  ray.setFromCamera(new THREE.Vector2(state.view === 'plan' ? 0.15 : 0, 0), camera);
  const p = groundHit() || new THREE.Vector3(16, 0, 16);
  const it = { id: newId(type), type, x: snap(p.x), z: snap(p.z), rot: 0 };
  if (c.resize) { it.w = c.w; if (c.resize === 'wd') it.d = c.d; }
  const before = JSON.stringify(D);
  if (c.wall) wallSnap(it, p);
  D.items.push(it); addItemMesh(it); commit(before);
  select({ kind: 'item', id: it.id }); refreshClashes();
  toast(`${c.name} added — drag it into place`);
}
function afterItemChange() { drawSelection(); refreshClashes(); renderInspector(); }

// ------------------------------------------------------------------ picking & dragging
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function groundHit() { const p = new THREE.Vector3(); return ray.ray.intersectPlane(ground, p) ? p : null; }
function pickItem() {
  for (const h of ray.intersectObjects(furnGroup.children, true)) if (h.object.userData.itemId) return h.object.userData.itemId;
  return null;
}
function pickFrom(list) { const h = ray.intersectObjects(list, false)[0]; return h ? h.object : null; }

// Snap an item flush to nearby wall faces / furniture edges.
function magnet(it) {
  const b = aabb(it), R = 0.4;
  const targets = [...obst.solids, ...D.items.filter(o => o !== it && CATALOG[o.type].solid !== false && !CATALOG[o.type].wall).map(aabb)];
  let sx = null, sz = null;
  const best = (cur, v) => (Math.abs(v) < R && (cur === null || Math.abs(v) < Math.abs(cur)) ? v : cur);
  for (const t of targets) {
    if (t.z1 > b.z0 + 0.05 && t.z0 < b.z1 - 0.05) { sx = best(sx, t.x1 - b.x0); sx = best(sx, t.x0 - b.x1); }
    if (t.x1 > b.x0 + 0.05 && t.x0 < b.x1 - 0.05) { sz = best(sz, t.z1 - b.z0); sz = best(sz, t.z0 - b.z1); }
  }
  if (sx !== null) it.x += sx;
  if (sz !== null) it.z += sz;
}
// Wall-mounted items hang on the wall face nearest the cursor.
function wallSnap(it, p) {
  let best = null;
  for (const s of obst.solids) {
    const faces = [
      { d: Math.abs(p.x - s.x0), ok: p.z > s.z0 && p.z < s.z1 && p.x <= s.x0 + 0.2, x: s.x0, z: null, rot: -90 },
      { d: Math.abs(p.x - s.x1), ok: p.z > s.z0 && p.z < s.z1 && p.x >= s.x1 - 0.2, x: s.x1, z: null, rot: 90 },
      { d: Math.abs(p.z - s.z0), ok: p.x > s.x0 && p.x < s.x1 && p.z <= s.z0 + 0.2, x: null, z: s.z0, rot: 180 },
      { d: Math.abs(p.z - s.z1), ok: p.x > s.x0 && p.x < s.x1 && p.z >= s.z1 - 0.2, x: null, z: s.z1, rot: 0 },
    ];
    for (const f of faces) if (f.ok && (!best || f.d < best.d)) best = { ...f, s };
  }
  if (!best || best.d > 6) return false;
  const half = dims(it).d / 2, hw = dims(it).w / 2;
  it.rot = best.rot;
  if (best.x !== null) { it.x = best.x + (best.rot === 90 ? half : -half); it.z = Math.min(best.s.z1 - hw, Math.max(best.s.z0 + hw, snap(p.z))); }
  else { it.z = best.z + (best.rot === 0 ? half : -half); it.x = Math.min(best.s.x1 - hw, Math.max(best.s.x0 + hw, snap(p.x))); }
  return true;
}
function wallOf(o) { return walls.find(w => w.kind !== 'open' && w.axis === o.axis && Math.abs(w.at - o.at) < 1e-3 && o.pos >= w.a - 1e-6 && o.pos <= w.b + 1e-6); }
const roomName = r => (r ? r.name : 'outside');

function onDown(e) {
  if (state.view === 'walk') { walk.look = { x: e.clientX, y: e.clientY, id: e.pointerId }; return; }
  if (e.button !== 0 || e.target !== canvas) return;
  setRay(e);
  drag = null;
  const click = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
  if (pendingAdd) {
    const obj = pickFrom(S.pickWalls), w = obj && walls[obj.userData.wall], p = groundHit();
    if (!w || w.kind === 'open' || !p) { toast('Click on a solid wall to place it'); return; }
    if (P.onNeighbourWall(D.plot, w.axis, w.at)) { toast('That is the neighbour’s wall: no doors or windows there. Try the north wall or a courtyard wall.'); return; }
    const width = pendingAdd === 'door' ? 3 : 4, along = w.axis === 'h' ? p.x : p.z;
    if (w.b - w.a < width + 0.6) { toast('That wall is too short for it'); return; }
    const before = JSON.stringify(D);
    D.openings.push({ type: pendingAdd, axis: w.axis, at: w.at, pos: Math.min(w.b - width / 2 - 0.3, Math.max(w.a + width / 2 + 0.3, snap(along))), w: width, hinge: -1, swing: 1 });
    commit(before); endAdd(); rebuildStructure(); select({ kind: 'opening', idx: D.openings.length - 1 });
    return;
  }
  if (state.mode === 'arrange') {
    const id = pickItem(), p = groundHit();
    if (id && p) {
      const it = itemById(id);
      select({ kind: 'item', id });
      drag = { kind: 'item', it, before: JSON.stringify(D), dx: it.x - p.x, dz: it.z - p.z, click };
    }
  } else {
    const oObj = pickFrom(S.pickOpenings), p = groundHit();
    if (oObj && p) {
      const idx = oObj.userData.opening, o = D.openings[idx], w = wallOf(o);
      select({ kind: 'opening', idx });
      if (w) drag = { kind: 'opening', o, w, before: JSON.stringify(D), grab: (o.axis === 'h' ? p.x : p.z) - o.pos, click };
    } else {
      const wObj = pickFrom(S.pickWalls);
      if (wObj && p) {
        const w = walls[wObj.userData.wall];
        if (P.isLocked(w.axis, w.at, D.plot)) { toast('The 32′ plot boundary is fixed — drag the inner walls'); drag = { kind: 'none', before: JSON.stringify(D), click }; }
        else {
          deselect();
          const { lo, hi } = P.lineGroup(D, w.axis, w.at, w.a, w.b);
          const hung = D.items.filter(it => {
            const c = CATALOG[it.type], across = w.axis === 'h' ? it.z : it.x, along = w.axis === 'h' ? it.x : it.z;
            return c.wall && Math.abs(across - w.at) < w.t / 2 + c.d + 0.15 && along > lo && along < hi;
          }).map(it => ({ it, x: it.x, z: it.z }));
          drag = { kind: 'wall', w: { axis: w.axis, at: w.at, a: w.a, b: w.b }, hung, rooms: clone(D.rooms), openings: clone(D.openings), before: JSON.stringify(D), start: p.clone(), last: 0, click };
        }
      }
    }
  }
  if (drag) {
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    grid.visible = drag.kind === 'item';
  } else pressOnEmpty = click;
}
let pressOnEmpty = null;

function onMove(e) {
  if (state.view === 'walk') {
    if (walk.look?.id === e.pointerId) { // only the dragging pointer looks; a thumb on the walk pad must not
      walk.yaw -= (e.clientX - walk.look.x) * 0.0045;
      walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - walk.look.y) * 0.0045));
      walk.look = { x: e.clientX, y: e.clientY, id: e.pointerId };
    }
    return;
  }
  if (!drag) { queueHover(e); return; }
  setRay(e);
  const p = groundHit();
  if (!p) return;
  drag.moved = drag.moved || Math.hypot(e.clientX - drag.click.x, e.clientY - drag.click.y) > 3;
  if (!drag.moved) return;
  if (drag.kind === 'none') return;
  if (drag.kind === 'item') {
    const it = drag.it;
    if (CATALOG[it.type].wall) wallSnap(it, p);
    else {
      it.x = p.x + drag.dx; it.z = p.z + drag.dz;
      if (!e.altKey) { it.x = snap(it.x); it.z = snap(it.z); magnet(it); }
      it.x = Math.max(-30, Math.min(62, it.x)); it.z = Math.max(-40, Math.min(70, it.z));
    }
    syncItem(it); drawSelection(); refreshClashes();
    const c = clashes.get(it.id);
    showTip(e, CATALOG[it.type].name, c ? '⚠ ' + c.join(', ') : '');
  } else if (drag.kind === 'opening') {
    const o = drag.o, w = drag.w, along = (o.axis === 'h' ? p.x : p.z) - drag.grab;
    o.pos = Math.min(w.b - o.w / 2 - 0.2, Math.max(w.a + o.w / 2 + 0.2, snap(along)));
    needsStructure = true;
    showTip(e, openingName(o), `${fmt(o.pos - o.w / 2 - w.a)} from one end · ${fmt(w.b - o.pos - o.w / 2)} from the other`);
  } else {
    const w = drag.w, delta = snap(w.axis === 'h' ? p.z - drag.start.z : p.x - drag.start.x);
    if (delta !== drag.last) {
      const tryMove = d => { D.rooms = clone(drag.rooms); D.openings = clone(drag.openings); return d ? P.moveLine(D, w.axis, w.at, w.a, w.b, d) : true; };
      const res = tryMove(delta);
      if (res === true) drag.last = delta;
      else { tryMove(drag.last); if (res !== drag.why) toast(res === 'opening' ? 'A door or window needs this wall — slide or delete it first' : 'A room can’t get smaller than 3 ft'); drag.why = res; }
      for (const h of drag.hung) { h.it.x = h.x + (w.axis === 'v' ? drag.last : 0); h.it.z = h.z + (w.axis === 'h' ? drag.last : 0); syncItem(h.it); }
      needsStructure = true;
    }
    const { edges } = P.lineGroup(D, w.axis, w.at + drag.last, w.a, w.b);
    const wl = P.deriveWalls(D);
    const info = [...new Set(edges.map(ed => ed.room))].map(r => { const c = P.clearRect(wl, r); return `${r.name} ${fmt(w.axis === 'h' ? c.d : c.w)}`; });
    showTip(e, info.join('  ·  '), drag.last ? `moved ${fmt(Math.abs(drag.last))} ${w.axis === 'h' ? (drag.last > 0 ? 'south' : 'north') : (drag.last > 0 ? 'east' : 'west')}` : 'drag to resize');
  }
}
function onUp(e) {
  if (state.view === 'walk') { if (walk.look?.id === e.pointerId) walk.look = null; return; }
  if (drag) {
    const d = drag; drag = null; grid.visible = false;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    controls.enabled = true;
    if (d.kind === 'wall' || d.kind === 'opening') { rebuildStructure(); drawSelection(); }
    commit(d.before);
    renderInspector(); hideTip();
  } else if (pressOnEmpty && Math.hypot(e.clientX - pressOnEmpty.x, e.clientY - pressOnEmpty.y) < 4) deselect();
  pressOnEmpty = null;
}
stage.addEventListener('pointerdown', onDown, true);
addEventListener('pointermove', onMove);
addEventListener('pointerup', onUp);
addEventListener('pointercancel', onUp);

let hoverEvt = null;
function queueHover(e) { if (!hoverEvt) requestAnimationFrame(() => { hover(hoverEvt); hoverEvt = null; }); hoverEvt = e; }
function hover(e) {
  if (!e || e.target !== canvas || state.view === 'walk') { if (e && e.target !== canvas) hideTip(); return; }
  setRay(e);
  clearGroup(viz.hover); clearGroup(viz.wall);
  let cursor = '';
  if (pendingAdd) {
    const obj = pickFrom(S.pickWalls), w = obj && walls[obj.userData.wall], nbr = w && P.onNeighbourWall(D.plot, w.axis, w.at);
    cursor = w && w.kind !== 'open' && !nbr ? 'crosshair' : 'not-allowed';
    showTip(e, pendingAdd === 'door' ? 'Place door' : 'Place window', nbr ? 'neighbour’s wall: not allowed' : 'click a wall · Esc to cancel');
  } else if (state.mode === 'arrange') {
    const id = pickItem();
    if (id) {
      const it = itemById(id), c = clashes.get(id);
      cursor = 'grab';
      if (sel?.id !== id) viz.hover.add(footprint(it, M.hover, null, 0.09));
      showTip(e, CATALOG[it.type].name, c ? '⚠ ' + c.join(', ') : `${fmt(dims(it).w)} × ${fmt(dims(it).d)}`);
    } else hideTip();
  } else {
    const oObj = pickFrom(S.pickOpenings);
    if (oObj) {
      const o = D.openings[oObj.userData.opening];
      cursor = o.axis === 'h' ? 'ew-resize' : 'ns-resize';
      showTip(e, openingName(o), `${fmt(o.w)} wide · drag along the wall`);
    } else {
      const wObj = pickFrom(S.pickWalls);
      if (wObj) {
        const w = walls[wObj.userData.wall], locked = P.isLocked(w.axis, w.at, D.plot);
        cursor = locked ? 'not-allowed' : (w.axis === 'h' ? 'ns-resize' : 'ew-resize');
        const [a, b] = P.wallSpan(w);
        viz.wall.add(flatBox(P.wallRect({ ...w, t: Math.max(w.t, 0.5) }, a, b), 0, w.kind === 'open' ? 0.25 : 10.05, locked ? M.locked : M.wall));
        const kind = w.kind === 'open' ? 'Open boundary' : P.onNeighbourWall(D.plot, w.axis, w.at) ? 'Neighbour’s wall (shared, fixed)' : locked ? 'Plot boundary (fixed)' : 'Wall';
        showTip(e, `${kind} · ${fmt(w.b - w.a)}`, `${roomName(w.neg)} | ${roomName(w.pos)}${locked ? '' : ' · drag to move'}`);
      } else hideTip();
    }
  }
  canvas.style.cursor = cursor;
}
const tip = $('#tip');
function showTip(e, title, sub) {
  tip.replaceChildren(document.createTextNode(title));
  if (sub) tip.append(el('small', '', sub));
  tip.style.left = Math.min(innerWidth - 240, e.clientX + 16) + 'px';
  tip.style.top = (e.clientY + 18) + 'px';
  tip.classList.add('on');
}
function hideTip() { tip.classList.remove('on'); }

// ------------------------------------------------------------------ panels
const OPEN_NAMES = { door: 'Door', window: 'Window', vent: 'Ventilator', arch: 'Open arch', almirah: 'Wall almirah' };
const openingName = o => (o.main ? 'Main door' : OPEN_NAMES[o.type]);
const FACING = { 0: 'south', 90: 'east', 180: 'north', '-90': 'west' };
const SWATCH = { marble: '#e9e2d6', wood: '#a8764b', kitchenTile: '#d4d0c8', bathTile: '#afc1c6', cement: '#b9b3a8', kota: '#8a968c' };

// Designs 1–3 assume open sides; the rest are drawn for the real plot (neighbours on three sides).
const groupOf = i => (DESIGNS[i].plot.neighbours ? 1 : 0);
const GROUPS = [['Open-site ideas', 'Designs that assume open sides, before we knew about the neighbours'], ['For your plot', 'Neighbours east, west and south; light from the north and the sky']];
const groupIdx = g => DESIGNS.map((_, i) => i).filter(i => groupOf(i) === g);
function renderTabs() {
  const tabs = $('#tabs');
  tabs.replaceChildren();
  DESIGNS.forEach((d, i) => {
    if (!i || groupOf(i) !== groupOf(i - 1)) { const g = el('span', 'tab-group', GROUPS[groupOf(i)][0]); g.title = GROUPS[groupOf(i)][1]; tabs.append(g); }
    const b = el('button', 'tab');
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === state.di));
    b.title = `${d.name} (${i + 1})`;
    b.append(el('span', 'n', String(i + 1)), el('span', 't', d.name));
    b.onclick = () => setDesign(i);
    tabs.append(b);
  });
  const ids = groupIdx(groupOf(state.di));
  $('#compareBtn').textContent = `Compare ${ids[0] + 1}–${ids[ids.length - 1] + 1}`;
}
function renderInfo() {
  const box = $('#info'), base = DESIGNS[state.di];
  box.replaceChildren();
  box.append(el('div', 'kicker', `Design ${state.di + 1} of ${DESIGNS.length}`), el('h2', '', base.name), el('p', 'tagline', base.tagline));
  box.append(el('div', base.plot.neighbours ? 'site fits' : 'site', base.plot.neighbours
    ? '✓ Drawn for your plot: neighbours east, west and south, so all light comes from the north, the courtyard or the sky'
    : `Assumes open sides. Its east, west and south windows aren’t possible on your plot; see designs ${groupIdx(1)[0] + 1}–${groupIdx(1).at(-1) + 1}`));
  const areas = D.rooms.map(r => ({ r, c: P.clearRect(walls, r, D) }));
  const sum = f => Math.round(areas.filter(f).reduce((s, a) => s + a.c.area, 0));
  const stats = el('div', 'stats');
  for (const [v, t] of [[sum(a => !a.r.open), 'Carpet'], [sum(a => a.r.zone === 'living'), 'Living zone'], [sum(a => a.r.id === 'bed'), 'Bedroom']]) {
    const s = el('div', 'stat'), b = el('b', '', v.toLocaleString('en-IN'));
    b.append(el('small', '', ' sq ft')); s.append(b, el('span', '', t)); stats.append(s);
  }
  box.append(stats);
  const beds = el('div', 'beds'); beds.append(el('b', '', 'Beds'), el('span', '', base.beds)); box.append(beds);
  const party = el('div', 'party'), gb = el('button', 'btn', guestsOn ? 'Hide guests' : 'Show guests');
  gb.setAttribute('aria-pressed', String(guestsOn));
  gb.onclick = () => { guestsOn = !guestsOn; drawGuests(); gb.textContent = guestsOn ? 'Hide guests' : 'Show guests'; gb.setAttribute('aria-pressed', String(guestsOn)); if (guestsOn) toast('Each figure is one standing guest with room to move'); };
  party.append(el('b', '', 'Party'), el('span', '', ''), gb); party.children[1].id = 'partyText';
  box.append(party); updateParty();
  box.append(el('div', 'sec', 'Your things · click to find'));
  const things = el('div', 'things');
  for (const [types, need, label] of OWNED) {
    const found = D.items.filter(i => types.includes(i.type)), ok = need ? found.length >= need : found.length > 0;
    const b = el('button', ok ? 'thing' : 'thing missing', ok ? `✓ ${found.length} ${label}` : `⚠ ${found.length} of ${need || 1} ${label}`);
    b.onclick = () => {
      if (!found[0]) return toast(`No ${label} placed — add from “+ Add item”`);
      if (state.mode !== 'arrange') setMode('arrange');
      select({ kind: 'item', id: found[0].id }); focusPoint(found[0].x, found[0].z, 7);
    };
    things.append(b);
  }
  box.append(things);
  const extra = [...new Set(D.items.filter(i => CATALOG[i.type].group === 'suggested').map(i => CATALOG[i.type].name))];
  if (extra.length) box.append(el('p', 'suggested', `Shown but not on your list (suggestions): ${extra.join(', ')}.`));
  box.append(el('div', 'sec', 'Why it works'));
  const pros = el('ul', 'list pros'); base.highlights.forEach(h => pros.append(el('li', '', h))); box.append(pros);
  box.append(el('div', 'sec', 'Trade-offs'));
  const cons = el('ul', 'list cons'); base.tradeoffs.forEach(h => cons.append(el('li', '', h))); box.append(cons);
  box.append(el('div', 'sec', 'Vastu check'));
  const v = el('div', 'vastu');
  base.vastu.forEach(([k, dir, ok]) => v.append(el('span', ok ? 'chip' : 'chip meh', `${ok ? '✓' : '~'} ${k} ${dir}`)));
  box.append(v);
  box.append(el('div', 'sec', 'Room schedule · clear inside walls'));
  const t = el('table', 'rooms');
  for (const { r, c } of areas) {
    if (r.label === false) continue;
    const tr = el('tr'), td = el('td'), sw = el('span', 'swatch');
    sw.style.background = SWATCH[r.floor] || '#ccc';
    td.append(sw, document.createTextNode(r.name + (r.open ? ' · open to sky' : '')));
    td.title = `${FLOOR_NAMES[r.floor] || ''} floor · click to zoom`;
    tr.append(td, el('td', '', `${fmt(c.w)} × ${fmt(c.d)}`), el('td', '', `${Math.round(c.area)}`));
    tr.style.cursor = 'pointer'; tr.onclick = () => focusRoom(r);
    t.append(tr);
  }
  const tot = el('tr', 'total');
  tot.append(el('td', '', 'Total carpet'), el('td', '', `plot ${fmt(D.plot.w)} × ${fmt(D.plot.d)}`), el('td', '', `${sum(a => !a.r.open)}`));
  t.append(tot); box.append(t);
  box.append(el('div', 'sec', 'Fit check'), el('div', '', ''));
  box.lastChild.id = 'warns';
  renderWarnings();
}
function renderWarnings() {
  const box = $('#warns');
  if (!box) return;
  box.replaceChildren();
  if (!clashes.size && !openIssues.length && !lostRooms.length) { box.append(el('div', 'allgood', '✓ Every piece fits: no overlaps, no blocked doors, every room reachable.')); return; }
  const ul = el('ul', 'warns');
  const warn = (text, act) => {
    const li = el('li'); li.append(el('span', '', '⚠'), el('span', '', text)); li.tabIndex = 0;
    li.onclick = li.onkeydown = ev => { if (ev.type === 'click' || ev.key === 'Enter') act(); };
    ul.append(li);
  };
  for (const r of lostRooms) warn(`${r.name} has no way in — add a door`, () => focusRoom(r));
  for (const { idx, msg } of openIssues) warn(msg, () => { if (state.mode !== 'walls') setMode('walls'); select({ kind: 'opening', idx }); });
  for (const [id, why] of clashes) {
    const it = itemById(id);
    if (!it) continue;
    const li = el('li');
    li.append(el('span', '', '⚠'), el('span', '', `${CATALOG[it.type].name} ${why.join(', ')}`));
    li.tabIndex = 0;
    li.onclick = li.onkeydown = ev => { if (ev.type === 'click' || ev.key === 'Enter') { select({ kind: 'item', id }); } };
    ul.append(li);
  }
  box.append(ul);
}
const OWNED = [[['queenBed'], 2, 'queen beds'], [['twinBed'], 1, 'twin bed'], [['sofaLeather'], 1, 'leather sofa'], [['sofaWood'], 1, 'teak sofa'],
  [['chairWood'], 2, 'teak armchairs'], [['partyBox'], 1, 'JBL PartyBox'], [['micStand'], 2, 'mics + stands'], [['fan'], 1, 'pedestal fan'],
  [['plasticChair'], 3, 'plastic chairs'], [['frame', 'frameWide'], 0, 'photo frames'], [['boxStack', 'rack'], 0, 'box stacks & racks']];
function updateParty() {
  const t = $('#partyText');
  if (t) { const c = capacity(D, walls, CATALOG); t.textContent = `${c.seated} seated + ${c.standing} standing`; }
}
// Guest overlay: one figure per free standing spot in the living zone.
const guests = new THREE.Group(); scene.add(guests);
let guestsOn = false;
const guestGeo = [new THREE.CapsuleGeometry(0.55, 3.0, 4, 10), new THREE.SphereGeometry(0.46, 12, 10)];
const guestMat = [new THREE.MeshStandardMaterial({ roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: '#b98062', roughness: 0.7 })];
const GUEST_COLORS = ['#b4532a', '#2f5d58', '#c9a13b', '#3f4f7a', '#8a2f45', '#6b8f71', '#d9825b', '#5a4a7a'].map(c => new THREE.Color(c));
function drawGuests() {
  for (const m of [...guests.children]) { guests.remove(m); m.dispose(); }
  if (!guestsOn) return;
  const { points } = capacity(D, walls, CATALOG), mtx = new THREE.Matrix4();
  const [body, head] = guestGeo.map((g, k) => new THREE.InstancedMesh(g, guestMat[k], Math.max(1, points.length)));
  points.forEach(([x, z], i) => {
    const jx = ((i * 37) % 7 - 3) * 0.09, jz = ((i * 53) % 5 - 2) * 0.12; // fixed offsets so the crowd doesn't look gridded
    body.setMatrixAt(i, mtx.makeTranslation(x + jx, 2.05, z + jz)); body.setColorAt(i, GUEST_COLORS[i % GUEST_COLORS.length]);
    head.setMatrixAt(i, mtx.makeTranslation(x + jx, 4.55, z + jz));
  });
  body.count = head.count = points.length;
  body.castShadow = head.castShadow = true;
  guests.add(body, head);
}
function focusPoint(x, z, size) {
  if (state.view === 'plan') {
    controls.target.set(x, 0, z); ortho.position.set(x, 150, z + 0.01);
    const vh = (innerHeight - PAD_T - PAD_B) * orthoUpp; ortho.zoom = Math.min(4, Math.max(1, vh / (size * 2.2))); ortho.updateProjectionMatrix();
  } else {
    if (state.view === 'walk') setView('orbit');
    const k = size * 1.5 + 8;
    flyTo(new THREE.Vector3(x + k * 0.45, k * 0.95, z + k * 0.62), new THREE.Vector3(x, 0, z), 800);
  }
}
function openCompare() {
  const grid = $('#cmpGrid'), ids = groupIdx(groupOf(state.di));
  grid.replaceChildren(); grid.style.setProperty('--n', ids.length);
  $('#cmpTitle').textContent = `Compare designs ${ids[0] + 1}–${ids[ids.length - 1] + 1} · ${GROUPS[groupOf(state.di)][0].toLowerCase()}`;
  let x0 = 0, z0 = -10, x1 = 32, z1 = 32;
  for (const i of ids) for (const r of designs[i].rooms) { x0 = Math.min(x0, r.x); z0 = Math.min(z0, r.z); x1 = Math.max(x1, r.x + r.w); z1 = Math.max(z1, r.z + r.d); }
  const box = [x0 - 1.5, z0 - 1.5, x1 + 1.5, z1 + 1.5], parser = new DOMParser();
  ids.map(i => [designs[i], i]).forEach(([d, i]) => {
    const col = el('section', i === state.di ? 'cmp-col current' : 'cmp-col'), fig = el('div', 'cmp-plan');
    fig.append(document.importNode(parser.parseFromString(planSVG(d, CATALOG, box), 'image/svg+xml').documentElement, true));
    const t = el('table', 'rooms cmp');
    for (const [k, v] of metrics(d, DESIGNS[i], CATALOG)) { const tr = el('tr'); tr.append(el('td', '', k), el('td', '', v)); t.append(tr); }
    const b = el('button', 'btn primary', i === state.di ? 'Currently open' : 'Open this design');
    b.onclick = () => { $('#compare').close(); setDesign(i); };
    col.append(el('div', 'kicker', `Design ${i + 1}`), el('h3', '', DESIGNS[i].name), fig, t, b);
    grid.append(col);
  });
  $('#compare').showModal();
}

function focusRoom(r) {
  const c = P.clearRect(walls, r), cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2;
  if (state.view === 'plan') {
    controls.target.set(cx, 0, cz); ortho.position.set(cx, 150, cz + 0.01);
    const vw = (innerWidth - leftUi()) * orthoUpp, vh = (innerHeight - PAD_T - PAD_B) * orthoUpp;
    ortho.zoom = Math.min(4, Math.max(1, Math.min(vw / (c.w * 1.9), vh / (c.d * 1.9))));
    ortho.updateProjectionMatrix();
  } else {
    if (state.view === 'walk') setView('orbit');
    const k = Math.max(c.w, c.d) * 1.5 + 9;
    flyTo(new THREE.Vector3(cx + k * 0.45, k * 0.95, cz + k * 0.62), new THREE.Vector3(cx, 0, cz), 800);
  }
}
function roomAt(x, z) { return D.rooms.find(r => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d); }

function renderInspector() {
  const box = $('#inspector');
  const it = sel?.kind === 'item' ? itemById(sel.id) : null, o = sel?.kind === 'opening' ? D.openings[sel.idx] : null;
  if (!it && !o) { box.hidden = true; document.body.classList.remove('inspecting'); return; }
  box.hidden = false; document.body.classList.add('inspecting');
  box.replaceChildren();
  const row = () => { const r = el('div', 'row'); box.append(r); return r; };
  const btn = (label, fn, cls = 'btn') => { const b = el('button', cls, label); b.onclick = fn; return b; };
  const field = (label, value, min, max, onchange) => {
    const f = el('label', 'field'), inp = el('input');
    Object.assign(inp, { type: 'number', step: '0.25', min: String(min), max: String(max), value: String(value) });
    inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v) && v >= min && v <= max) onchange(v); else inp.value = String(value); };
    f.append(el('span', '', label), inp, el('span', 'meta', 'ft'));
    return f;
  };
  if (it) {
    const c = CATALOG[it.type], d = dims(it), room = roomAt(it.x, it.z);
    box.append(el('div', 'kicker', GROUP_LABEL[c.group]), el('h3', '', c.name));
    box.append(el('div', 'meta', `${fmt(d.w)} × ${fmt(d.d)} · ${fmt(d.h)} tall · ${room ? 'in ' + room.name : 'on the verandah'}`));
    if (!c.wall) {
      box.append(el('div', 'meta', `Faces ${FACING[it.rot] || it.rot + '°'}`));
      const r = row();
      r.append(btn('⟲ 90°', () => rotateSel(-90)), btn('⟳ 90°', () => rotateSel(90)), btn('−15°', () => rotateSel(-15)), btn('+15°', () => rotateSel(15)));
    }
    if (c.resize) {
      const r = row();
      const upd = (k, v) => { const before = JSON.stringify(D); it[k] = v; syncItem(it, true); commit(before); afterItemChange(); };
      r.append(field('Width', d.w, 0.5, 30, v => upd('w', v)));
      if (c.resize === 'wd') row().append(field('Depth', d.d, 0.5, 30, v => upd('d', v)));
    }
    const r2 = row();
    r2.append(btn('Duplicate', duplicate), btn('Delete', deleteSel, 'btn danger'));
    const cl = clashes.get(it.id);
    if (cl) box.append(el('div', 'clashbox', `⚠ ${cl.join(', ')}. Drag it or rotate until the red outline clears.`));
  } else {
    const w = wallOf(o);
    box.append(el('div', 'kicker', 'Opening'), el('h3', '', openingName(o)));
    box.append(el('div', 'meta', w ? `Between ${roomName(w.neg)} and ${roomName(w.pos)}` : 'Not on a wall'));
    const upd = fn => { const before = JSON.stringify(D); fn(); commit(before); rebuildStructure(); drawSelection(); renderInspector(); };
    row().append(field('Width', o.w, 1.5, o.type === 'almirah' ? 10 : 8, v => upd(() => { o.w = v; })));
    if (o.type === 'window') row().append(field('Sill', o.sill ?? 3, 0.5, 6, v => upd(() => { o.sill = v; })));
    const r = row();
    if (o.type === 'door') r.append(btn('Flip hinge', () => upd(() => { o.hinge = -(o.hinge ?? -1); })), btn('Flip swing', () => upd(() => { o.swing = -(o.swing ?? 1); })));
    if (o.type === 'almirah') r.append(btn('Face other room', () => upd(() => { o.face = -(o.face ?? 1); })));
    row().append(btn('Delete', deleteSel, 'btn danger'));
  }
}

// ------------------------------------------------------------------ toolbar & keys
function setMode(m) {
  state.mode = m;
  document.body.classList.toggle('walls', m === 'walls');
  $$('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  endAdd(); deselect(); clearGroup(viz.hover); clearGroup(viz.wall);
  drawGrips(); applyViewStyle(); updateHint();
  if (m === 'walls' && state.view === 'walk') setView('orbit');
}
function setWallMode(m) {
  state.wallMode = m;
  $$('[data-wall]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.wall === m)));
  applyCutaway(); occludeLabels();
}
function toggleLabels() { state.labels = !state.labels; $('#labels').setAttribute('aria-pressed', String(state.labels)); applyViewStyle(); }
function startAdd(kind) {
  if (state.mode !== 'walls') setMode('walls');
  pendingAdd = kind;
  $('#addDoor').setAttribute('aria-pressed', String(kind === 'door'));
  $('#addWindow').setAttribute('aria-pressed', String(kind === 'window'));
  toast(`Click a wall to place the ${kind}`);
}
function endAdd() { pendingAdd = null; $('#addDoor').removeAttribute('aria-pressed'); $('#addWindow').removeAttribute('aria-pressed'); }
function setDesign(i) {
  if (i === state.di || !DESIGNS[i]) return;
  state.di = i; D = designs[i];
  undoStack.length = 0; redoStack.length = 0; sel = null; drag = null;
  rebuildAll(); renderTabs(); updateUndo(); save();
  if (state.view === 'orbit') { const h = orbitHome(); flyTo(h.pos, h.target, 900); }
  else setView(state.view);
}
function download(blob, name) {
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function renderFrame() {
  if (aoOn && camera === persp) { renderPass.camera = persp; gtao.camera = persp; composer.render(); }
  else renderer.render(scene, camera);
  renderer.autoClear = false; renderer.render(overlayScene, camera); renderer.autoClear = true;
  labelRenderer.render(scene, camera); labelRenderer.render(overlayScene, camera);
}
function snapshot() {
  applyViewStyle(); if (state.view === 'orbit') applyCutaway();
  renderFrame();
  const src = canvas, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d'), k = src.width / src.clientWidth;
  g.drawImage(src, 0, 0);
  for (const node of labelRenderer.domElement.children) {
    if (node.style.display === 'none' || !node.textContent) continue;
    const r = node.getBoundingClientRect(), cs = getComputedStyle(node);
    g.fillStyle = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : 'rgba(255,253,249,0.85)';
    g.beginPath(); g.roundRect(r.left * k, r.top * k, r.width * k, r.height * k, 8 * k); g.fill();
    const lines = node.children.length ? [...node.children].map(ch => [ch.textContent, getComputedStyle(ch)]) : [[node.textContent, cs]];
    let y = r.top + parseFloat(cs.paddingTop || 0);
    for (const [txt, st] of lines) {
      const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.2;
      g.font = `${st.fontWeight} ${parseFloat(st.fontSize) * k}px ${st.fontFamily}`;
      g.fillStyle = st.color; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(st.textTransform === 'uppercase' ? txt.toUpperCase() : txt, (r.left + r.width / 2) * k, (y + lh / 2) * k);
      y += lh;
    }
  }
  c.toBlob(b => b && download(b, `ghar-${D.id}-${state.view}.png`), 'image/png');
  toast('Snapshot saved');
}
const HINTS = {
  plan: 'Drag to pan · right-drag to rotate · scroll to zoom',
  orbit: 'Drag to orbit · right-drag to pan · scroll to zoom',
  arrange: 'Drag furniture · <kbd>R</kbd> rotate 90° · <kbd>Q</kbd><kbd>E</kbd> ±15° · <kbd>Del</kbd> remove · <kbd>Ctrl</kbd>+<kbd>D</kbd> copy · <kbd>Alt</kbd> no snap',
  walls: 'Drag a wall to resize rooms · drag doors &amp; windows along their wall · <kbd>+ Door</kbd> to add',
  walk: '<kbd>W</kbd><kbd>S</kbd> or <kbd>↑</kbd><kbd>↓</kbd> walk · <kbd>A</kbd><kbd>D</kbd> or <kbd>←</kbd><kbd>→</kbd> turn · <kbd>Q</kbd><kbd>E</kbd> side-step · <kbd>Shift</kbd> run · drag to look · <kbd>Esc</kbd> leave',
};
function updateHint() {
  $('#hint').innerHTML = state.view === 'walk' ? HINTS.walk : `${HINTS[state.view]} · ${HINTS[state.mode]}`;
}
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

$$('[data-view]').forEach(b => { b.onclick = () => setView(b.dataset.view); });
$$('[data-mode]').forEach(b => { b.onclick = () => setMode(b.dataset.mode); });
$$('[data-wall]').forEach(b => { b.onclick = () => setWallMode(b.dataset.wall); });
$('#labels').onclick = toggleLabels;
$('#night').onclick = () => { state.night = !state.night; applyLighting(); toast(state.night ? 'Evening — lamps on' : 'Daylight'); };
$('#addDoor').onclick = () => (pendingAdd === 'door' ? endAdd() : startAdd('door'));
$('#addWindow').onclick = () => (pendingAdd === 'window' ? endAdd() : startAdd('window'));
$('#undo').onclick = undo; $('#redo').onclick = redo;
$('#reset').onclick = () => {
  if (!confirm(`Restore “${DESIGNS[state.di].name}” to the original layout? (You can undo this.)`)) return;
  const before = JSON.stringify(D), f = normalize(clone(DESIGNS[state.di]), state.di);
  D.rooms = f.rooms; D.openings = f.openings; D.items = f.items; sel = null;
  commit(before); rebuildAll(); toast('Design restored');
};
$('#export').onclick = () => download(new Blob([JSON.stringify({ v: 1, design: D.id, rooms: D.rooms, openings: D.openings, items: D.items }, null, 1)], { type: 'application/json' }), `ghar-${D.id}.json`);
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async ev => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  if (f.size > 2e6) return toast('That file is too large');
  try {
    const d = JSON.parse(await f.text());
    if (!validDesign(d)) throw new Error('invalid');
    const before = JSON.stringify(D), n = normalize(clone({ rooms: d.rooms, openings: d.openings, items: d.items }), state.di);
    D.rooms = n.rooms; D.openings = n.openings; D.items = n.items; sel = null;
    commit(before); rebuildAll(); toast('Layout imported');
  } catch { toast('That is not a valid layout file'); }
};
$('#shot').onclick = snapshot;
$('#compareBtn').onclick = openCompare;
$('#cmpClose').onclick = () => $('#compare').close();
$('#compass').onclick = () => setView(state.view === 'walk' ? 'orbit' : state.view);
for (const id of ['#export', '#import', '#reset']) $(id).addEventListener('click', () => { $('#fileMenu').open = false; });
addEventListener('pointerdown', e => { if (!e.target.closest?.('#fileMenu')) $('#fileMenu').open = false; });
const addSel = $('#addItem');
for (const [grp, label] of Object.entries(GROUP_LABEL)) {
  const og = el('optgroup'); og.label = label;
  for (const [k, c] of Object.entries(CATALOG)) if (c.group === grp) { const op = el('option', '', c.name); op.value = k; og.append(op); }
  addSel.append(og);
}
addSel.onchange = () => { if (addSel.value) { if (state.mode !== 'arrange') setMode('arrange'); addItem(addSel.value); } addSel.value = ''; addSel.blur(); };
$('#collapse').onclick = () => {
  const info = $('#info'), shut = info.classList.toggle('collapsed');
  $('#collapse').classList.toggle('shut', shut); $('#collapse').textContent = shut ? '›' : '‹';
  $('#collapse').setAttribute('aria-expanded', String(!shut)); $('#collapse').setAttribute('aria-label', shut ? 'Show design details' : 'Hide design details');
  fitOrtho(); fitPersp();
};

addEventListener('keydown', e => {
  if (e.target.closest?.('input, select, textarea')) return;
  if (state.view === 'walk') {
    if (e.key === 'Escape' || e.code === 'Escape') { setView('orbit'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { walk.keys.clear(); return; } // browser shortcuts; macOS drops keyups while ⌘ is held
    const ids = keyIds(e);
    ids.forEach(id => walk.keys.add(id));
    if (ids.some(id => /^(Arrow|Key)/.test(id))) e.preventDefault(); // no scrolling or Firefox find-as-you-type
    return;
  }
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicate(); return; }
  if (mod || e.altKey) return;
  if (k === 'r') rotateSel(e.shiftKey ? -90 : 90);
  else if (k === 'q') rotateSel(-15);
  else if (k === 'e') rotateSel(15);
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  else if (e.key === 'Escape') { endAdd(); deselect(); }
  else if (k === 'p') setView('plan');
  else if (k === 'o') setView('orbit');
  else if (k === 'g') setView('walk');
  else if (k === 'b') setMode(state.mode === 'walls' ? 'arrange' : 'walls');
  else if (k === 'l') toggleLabels();
  else if (k === 'n') { state.night = !state.night; applyLighting(); }
  else if (/^[1-9]$/.test(e.key)) setDesign(+e.key - 1);
});
addEventListener('keyup', e => keyIds(e).forEach(id => walk.keys.delete(id)));
addEventListener('blur', () => walk.keys.clear());
document.addEventListener('visibilitychange', () => walk.keys.clear());
// Some remote-desktop input gives letters an unusable keydown (key 'Unidentified', no code), but keypress still
// carries the character. Holding a key auto-repeats keypress, so each one refreshes a short self-expiring pulse.
const pulses = new Map();
addEventListener('keypress', e => {
  const id = `Key${e.key.toUpperCase()}`, tracked = walk.keys.has(id) && !pulses.has(id); // a real keydown holds it
  if (state.view !== 'walk' || !/^[wasdqe]$/i.test(e.key) || tracked || e.target.closest?.('input, select, textarea')) return;
  e.preventDefault(); walk.keys.add(id); clearTimeout(pulses.get(id));
  pulses.set(id, setTimeout(() => { walk.keys.delete(id); pulses.delete(id); }, 250));
});
// On-screen walk pad: press and hold with mouse or touch, or hold Enter/Space on a focused button.
for (const b of $$('#walkpad button')) {
  const press = () => walk.keys.add(b.dataset.key), release = () => walk.keys.delete(b.dataset.key);
  const activates = e => e.key === 'Enter' || e.key === ' ';
  b.onpointerdown = e => { if (e.button === 0) { b.setPointerCapture(e.pointerId); press(); } };
  b.onpointerup = b.onpointercancel = b.onlostpointercapture = b.onblur = release;
  b.onkeydown = e => { if (activates(e)) press(); };
  b.onkeyup = e => { if (activates(e)) release(); };
}
$('#walkpad').oncontextmenu = e => e.preventDefault(); // touch long-press
// Keep the pad bottom-right, above the toolbar and hint, whose heights change as they wrap.
const padRO = new ResizeObserver(() => {
  const tops = $$('.toolbar, #hint').filter(n => n.offsetHeight).map(n => n.getBoundingClientRect().top);
  $('#walkpad').style.bottom = `${innerHeight - Math.min(...tops) + 10}px`;
});
$$('.toolbar, #hint').forEach(n => padRO.observe(n));
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
  fitPersp(); fitOrtho(); composer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ loop
const needle = $('#needle'), sbBar = $('#scalebarBar'), sbTxt = $('#scalebarTxt');
let lastNeedle = null, lastScale = '';
let frameCount = 0, lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  frameCount++;
  const raw = (now - lastT) / 1000, dt = Math.min(0.05, raw);
  lastT = now;
  if (needsStructure) { needsStructure = false; rebuildStructure(); drawSelection(); }
  // Walk caps at 0.1 s so slow machines still walk at full speed. No tunnelling: the max step, 11 ft/s × 0.1 s = 1.1 ft,
  // is less than the ≥1.775 ft Minkowski-expanded wall (0.375 ft partition + 2 × 0.7 ft body radius).
  if (state.view === 'walk') walkStep(Math.min(0.1, raw)); else { stepTween(now); controls.update(); }
  if (state.view === 'orbit') applyCutaway();
  if (frameCount % 10 === 0 && S) occludeLabels();
  tickModels(now, spinners);
  renderFrame();
  if (aoOn && aoParam !== '1' && state.view !== 'plan' && ++perf.n > 90) { // adaptive: drop AO if frames are slow
    perf.sum += dt;
    if (perf.n > 150) { if (perf.sum / 60 > 0.045) { aoOn = false; toast('Switched to fast rendering for this device'); } perf.n = -1e9; }
  }
  const deg = Math.round(THREE.MathUtils.radToDeg(state.view === 'walk' ? walk.yaw : controls.getAzimuthalAngle()));
  if (deg !== lastNeedle) { needle.style.transform = `rotate(${deg}deg)`; lastNeedle = deg; }
  if (state.view === 'plan') {
    const px = ortho.zoom / orthoUpp;
    let ft = 10; if (px * ft > 240) ft = 5; if (px * ft < 70) ft = 20;
    const key = `${Math.round(px * ft)}|${ft}`;
    if (key !== lastScale) { sbBar.style.width = `${px * ft}px`; sbTxt.textContent = `${ft} ft`; lastScale = key; labelRenderer.domElement.classList.toggle('tight', px < 17); }
  }
}

// ------------------------------------------------------------------ boot
renderTabs();
rebuildAll();
applyLighting();
updateUndo();
const startView = ['plan', 'orbit', 'walk'].includes(params.get('view')) ? params.get('view') : 'orbit';
if (startView === 'orbit') {
  const h = orbitHome();
  persp.position.set(h.target.x, 110, h.target.z + 8); controls.target.copy(h.target); controls.update();
  flyTo(h.pos, h.target, params.has('still') ? 1 : 1700);
  updateHint();
} else setView(startView);
if (innerWidth < 860) $('#collapse').click();
fitPersp();
requestAnimationFrame(frame);

// Automation hook for screenshots and scripted checks.
window.app = {
  state, get frames() { return frameCount; }, get design() { return D; }, get designs() { return designs; }, get clashes() { return clashes; }, get walls() { return walls; },
  setDesign, setView, setMode, setWallMode, select, undo, redo, focusRoom, toggleLabels, openCompare,
  showGuests(on = true) { guestsOn = on; drawGuests(); }, capacity: () => capacity(D, walls, CATALOG),
  camera: () => camera, controls, persp, ortho, flyTo, walk, CATALOG,
  moveItem(id, x, z, rot) { const it = itemById(id), before = JSON.stringify(D); Object.assign(it, { x, z, rot: rot ?? it.rot }); syncItem(it); commit(before); afterItemChange(); },
  moveWall(axis, at, a, b, delta) { const before = JSON.stringify(D); const res = P.moveLine(D, axis, at, a, b, delta); commit(before); rebuildStructure(); return res; },
};
