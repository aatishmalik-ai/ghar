// Builds the house meshes (floors, walls, openings, verandah + tin shed, labels, dims)
// from a design and its derived walls.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { WALL_H, wallSpan, clearRect, assignOpenings, fmtFt } from './plan.js';
import { tex, mat, TEX_FT } from './models.js';

export const CUT = 3.5;       // cutaway height for dollhouse views
const DOOR_H = 7, ARCH_H = 7.5, ALMIRAH_D = 2;
export const FLOOR_NAMES = { marble: 'Vitrified tile', wood: 'Wood laminate', kitchenTile: 'Matte tile', bathTile: 'Anti-skid tile', cement: 'IPS cement', kota: 'Kota stone' };
const PAINT = { warm: '#efe7da', sage: '#dde5d3', blush: '#f1ddd2', sky: '#dce6ec', plain: '#e8e4dc', sand: '#ede2cc' };

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());
const std = o => new THREE.MeshStandardMaterial(o);
function repeatTex(name) { const t = tex(name); t.repeat.set(1 / TEX_FT[name], 1 / TEX_FT[name]); return t; }
const floorMat = f => once('floor' + f, () => std({ map: repeatTex(f), roughness: { marble: 0.22, wood: 0.5, kitchenTile: 0.6, bathTile: 0.55, cement: 0.9, kota: 0.7 }[f] ?? 0.6 }));
const paintMat = c => once('paint' + c, () => std({ color: PAINT[c] || PAINT.warm, roughness: 0.92 }));
const M = {
  tile: () => once('wallTile', () => std({ map: repeatTex('wallTile'), roughness: 0.2 })),
  ext: () => once('plaster', () => std({ map: repeatTex('plaster'), roughness: 0.95 })),
  poche: () => once('poche', () => std({ color: '#34302c', roughness: 0.85 })),
  cap: () => once('cap', () => std({ color: '#d9cfbf', roughness: 0.9 })),
  plinth: () => once('plinthC', () => std({ color: '#8f887d', roughness: 0.95 })),
  alu: () => once('alu', () => std({ color: '#4a4038', metalness: 0.4, roughness: 0.5 })),
  grill: () => once('grillM', () => std({ color: '#1e1e20', metalness: 0.5, roughness: 0.5 })),
  ledge: () => once('ledge', () => std({ color: '#f1ede6', roughness: 0.3 })),
  leaf: () => once('leafM', () => std({ color: '#e6d8c3', roughness: 0.55 })),
  mainLeaf: () => once('mainLeaf', () => std({ color: '#6b3f22', map: tex('teak'), roughness: 0.45 })),
  bathLeaf: () => once('bathLeaf', () => std({ color: '#f4f2ee', roughness: 0.35 })),
  arc: () => once('arc', () => new THREE.LineBasicMaterial({ color: '#3f3831', transparent: true, opacity: 0.9 })),
  dim: () => once('dim', () => new THREE.LineBasicMaterial({ color: '#4a4540' })),
  openLine: () => once('openLine', () => new THREE.LineDashedMaterial({ color: '#b4532a', dashSize: 0.5, gapSize: 0.35 })),
  pick: () => once('pick', () => new THREE.MeshBasicMaterial({ visible: false })),
  sheet: () => once('sheet', () => new THREE.MeshStandardMaterial({ color: '#aeb7bb', metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide, transparent: true, opacity: 1 })),
  ceiling: () => once('ceiling', () => std({ color: '#f7f5f0', emissive: '#efe9df', emissiveIntensity: 0.35, roughness: 1, side: THREE.DoubleSide })),
  skirt: () => once('skirt', () => std({ color: '#b3a590', roughness: 0.55 })),
  grass: () => once('grass', () => std({ map: repeatTex('grass'), roughness: 1 })),
  paver: () => once('paver', () => std({ map: repeatTex('paver'), roughness: 0.9 })),
};
const roomWall = r => (r ? (r.wall === 'tile' ? M.tile() : paintMat(r.wall)) : M.ext());

// Box from world bounds; UVs in feet (textures repeat via their .repeat).
function worldBox(x0, x1, y0, y1, z0, z1, material) {
  const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, y = pos.getY(i) + cy, z = pos.getZ(i) + cz, f = Math.floor(i / 4);
    if (f < 2) uv.setXY(i, z, y); else if (f < 4) uv.setXY(i, x, z); else uv.setXY(i, x, y);
  }
  const m = new THREE.Mesh(geo, material);
  m.position.set(cx, cy, cz);
  m.castShadow = m.receiveShadow = true;
  return m;
}

// Adds a box to a wall part, split at CUT so the upper half can be hidden in cutaway views.
function partBox(part, x0, x1, y0, y1, z0, z1, material, tag) {
  const put = (a, b, grp) => { if (b - a < 1e-4) return; const m = worldBox(x0, x1, a, b, z0, z1, material); Object.assign(m.userData, tag); grp.add(m); };
  put(y0, Math.min(y1, CUT), part.lower);
  put(Math.max(y0, CUT), y1, part.upper);
}

export function buildStructure(design, walls) {
  const group = new THREE.Group(), labels = [], parts = [], pickWalls = [], pickOpenings = [];
  const openLines = new THREE.Group(), ceilings = new THREE.Group(), dims = new THREE.Group();
  group.add(openLines, ceilings, dims);
  ceilings.visible = false;

  // floors, plinth, ceilings, labels
  for (const r of design.rooms) {
    const floor = new THREE.Mesh(floorGeo(r.x, r.z, r.w, r.d), floorMat(r.floor || 'marble'));
    floor.receiveShadow = true; floor.userData.room = r.id;
    group.add(floor);
    group.add(worldBox(r.x - 0.3, r.x + r.w + 0.3, -0.6, -0.01, r.z - 0.3, r.z + r.d + 0.3, M.plinth()));
    const c = new THREE.Mesh(new THREE.PlaneGeometry(r.w, r.d), M.ceiling());
    c.rotation.x = Math.PI / 2; c.position.set(r.x + r.w / 2, WALL_H - 0.02, r.z + r.d / 2);
    ceilings.add(c);
    if (r.label === false) continue;
    const cr = clearRect(walls, r, design);
    const el = document.createElement('div');
    el.className = cr.w < 6.5 || cr.area < 45 ? 'room-label compact' : 'room-label';
    el.innerHTML = `<b></b><span></span><em></em>`;
    el.children[0].textContent = r.name;
    el.children[1].textContent = `${fmtFt(cr.w)} × ${fmtFt(cr.d)}`;
    el.children[2].textContent = `${Math.round(cr.area)} sq ft`;
    const lab = new CSS2DObject(el);
    lab.position.set((cr.x0 + cr.x1) / 2 + (r.lx || 0), 0.2, (cr.z0 + cr.z1) / 2 + (r.lz || 0));
    labels.push(lab); group.add(lab);
  }

  // walls + openings
  const byWall = assignOpenings(design, walls);
  walls.forEach((w, wi) => {
    if (w.kind === 'open') {
      const pts = w.axis === 'h' ? [new THREE.Vector3(w.a, 0.04, w.at), new THREE.Vector3(w.b, 0.04, w.at)] : [new THREE.Vector3(w.at, 0.04, w.a), new THREE.Vector3(w.at, 0.04, w.b)];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.openLine());
      line.computeLineDistances(); openLines.add(line);
      const r = w.axis === 'h' ? [w.a, w.b, w.at - 0.3, w.at + 0.3] : [w.at - 0.3, w.at + 0.3, w.a, w.b];
      const pick = worldBox(r[0], r[1], 0, 0.3, r[2], r[3], M.pick());
      pick.userData.wall = wi; pick.castShadow = false; openLines.add(pick); pickWalls.push(pick);
      return;
    }
    const part = { lower: new THREE.Group(), upper: new THREE.Group(), ext: w.kind === 'ext' && !(w.pos && w.neg) };
    const out = w.pos ? -1 : 1; // outward direction for single-room exterior walls
    part.nx = w.axis === 'v' ? out : 0; part.nz = w.axis === 'h' ? out : 0;
    part.cx = w.axis === 'h' ? (w.a + w.b) / 2 : w.at; part.cz = w.axis === 'h' ? w.at : (w.a + w.b) / 2;
    Object.assign(part, { axis: w.axis, line: w.at + w.off, a: w.a, b: w.b });
    group.add(part.lower, part.upper); parts.push(part);
    const c0 = w.at + w.off - w.t / 2, c1 = w.at + w.off + w.t / 2;
    // face materials in BoxGeometry order: +x, -x, +y, -y, +z, -z
    const mats = w.axis === 'h'
      ? [M.cap(), M.cap(), M.poche(), M.cap(), roomWall(w.pos), roomWall(w.neg)]
      : [roomWall(w.pos), roomWall(w.neg), M.poche(), M.cap(), M.cap(), M.cap()];
    const seg = (a0, a1, y0, y1, material = mats, tag = { wall: wi }, k0 = c0, k1 = c1) => {
      if (w.axis === 'h') partBox(part, a0, a1, y0, y1, k0, k1, material, tag);
      else partBox(part, k0, k1, y0, y1, a0, a1, material, tag);
    };
    const skirt = (a0, a1) => { // 4" skirting on painted room faces
      if (w.pos && w.pos.wall !== 'tile') seg(a0, a1, 0, 0.33, M.skirt(), { wall: wi }, c1, c1 + 0.03);
      if (w.neg && w.neg.wall !== 'tile') seg(a0, a1, 0, 0.33, M.skirt(), { wall: wi }, c0 - 0.03, c0);
    };
    const solid = (a0, a1) => { seg(a0, a1, 0, WALL_H); skirt(a0, a1); };
    const [sa, sb] = wallSpan(w);
    const ops = (byWall.get(wi) || []).sort((p, q) => p.o.pos - q.o.pos);
    let s = sa;
    for (const { o, idx } of ops) {
      const o0 = Math.max(sa, o.pos - o.w / 2), o1 = Math.min(sb, o.pos + o.w / 2);
      if (o0 > s) solid(s, o0);
      const tag = { opening: idx };
      if (o.type === 'door') { seg(o0, o1, DOOR_H, WALL_H); door(seg, part, w, o, o0, o1, c0, c1, tag, group); }
      else if (o.type === 'arch') { seg(o0, o1, ARCH_H, WALL_H); casing(seg, o0, o1, ARCH_H, c0, c1, tag); }
      else if (o.type === 'almirah') almirah(seg, w, o, o0, o1, tag);
      else {
        const vent = o.type === 'vent', sill = o.sill ?? (vent ? 6.5 : 3), h = o.h ?? (vent ? 1.5 : 4);
        seg(o0, o1, 0, sill); seg(o0, o1, sill + h, WALL_H); skirt(o0, o1);
        windowFill(seg, w, o0, o1, sill, h, c0, c1, tag, vent);
      }
      s = Math.max(s, o1);
    }
    if (sb > s) solid(s, sb);
    part.lower.traverse(m => { if (m.isMesh) (m.userData.opening !== undefined ? pickOpenings : pickWalls).push(m); });
    part.upper.traverse(m => { if (m.isMesh) (m.userData.opening !== undefined ? pickOpenings : pickWalls).push(m); });
  });

  // verandah, tin shed, path, dims
  const shed = verandah(design, group);
  dimensions(design, dims, labels);
  entryMarker(design, group, labels);
  return { group, labels, parts, pickWalls, pickOpenings, openLines, ceilings, dims, shed };
}

function floorGeo(x, z, w, d) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x + w / 2, 0, z + d / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), -p.getZ(i));
  return g;
}

function casing(seg, o0, o1, top, c0, c1, tag) {
  const e = 0.03, t = 0.14;
  seg(o0, o0 + t, 0, top, mat('teak'), tag, c0 - e, c1 + e);
  seg(o1 - t, o1, 0, top, mat('teak'), tag, c0 - e, c1 + e);
  seg(o0, o1, top - t, top, mat('teak'), tag, c0 - e, c1 + e);
}

function door(seg, part, w, o, o0, o1, c0, c1, tag, group) {
  casing(seg, o0, o1, DOOR_H, c0, c1, tag);
  seg(o0, o1, 0, 0.02, M.ledge(), tag, c0, c1);
  const lw = o1 - o0 - 0.28, hinge = o.hinge ?? -1, swing = o.swing ?? 1;
  const hA = hinge < 0 ? o0 + 0.14 : o1 - 0.14;
  const face = w.at + w.off + swing * w.t / 2;
  const leafMat = o.main ? M.mainLeaf() : (o.bath ? M.bathLeaf() : M.leaf());
  const a0 = hinge < 0 ? hA : hA - 0.12, a1 = a0 + 0.12;
  const k0 = Math.min(face, face + swing * lw), k1 = Math.max(face, face + swing * lw);
  seg(a0, a1, 0.05, DOOR_H - 0.12, leafMat, tag, k0, k1);
  if (o.main) for (const [y0, y1] of [[0.7, 3.0], [3.5, 6.3]]) {
    const inset = 0.25, ka = Math.min(face + swing * inset, face + swing * (lw - inset)), kb = Math.max(face + swing * inset, face + swing * (lw - inset));
    seg(a0 - 0.02, a1 + 0.02, y0, y1, mat('walnut'), tag, ka, kb);
  }
  const kh = face + swing * (lw - 0.35);
  seg(a0 - 0.08, a1 + 0.08, 3.3, 3.45, mat(o.main ? 'brass' : 'chrome'), tag, kh - 0.05, kh + 0.05);
  // plan swing arc
  const pts = [], dirC = hinge < 0 ? 1 : -1;
  for (let i = 0; i <= 24; i++) {
    const th = (i / 24) * Math.PI / 2, a = hA + Math.cos(th) * lw * dirC, k = face + Math.sin(th) * lw * swing;
    pts.push(w.axis === 'h' ? new THREE.Vector3(a, 0.03, k) : new THREE.Vector3(k, 0.03, a));
  }
  const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.arc());
  arc.userData = { ...tag };
  part.lower.add(arc);
}

function windowFill(seg, w, o0, o1, sill, h, c0, c1, tag, vent) {
  const f = 0.12, mid = (c0 + c1) / 2, top = sill + h;
  const alu = M.alu();
  seg(o0, o0 + f, sill, top, alu, tag, mid - 0.12, mid + 0.12);
  seg(o1 - f, o1, sill, top, alu, tag, mid - 0.12, mid + 0.12);
  seg(o0, o1, sill, sill + f, alu, tag, mid - 0.12, mid + 0.12);
  seg(o0, o1, top - f, top, alu, tag, mid - 0.12, mid + 0.12);
  seg(o0, o1, sill - 0.08, sill, M.ledge(), tag, c0 - 0.15, c1 + 0.15);
  const glass = mat('glass');
  if (vent) {
    for (let y = sill + 0.25; y < top - 0.15; y += 0.28) seg(o0 + f, o1 - f, y, y + 0.05, glass, tag, mid - 0.1, mid + 0.1);
    return;
  }
  const g0 = Math.max(sill + f, CUT); // bars start above the cut so cutaway views show no stubs
  seg((o0 + o1) / 2 - 0.05, (o0 + o1) / 2 + 0.05, g0, top, alu, tag, mid - 0.1, mid + 0.1);
  seg(o0 + f, o1 - f, sill + f, top - f, glass, tag, mid - 0.02, mid + 0.02);
  const gk = w.kind === 'ext' ? (w.pos ? c0 + 0.08 : c1 - 0.08) : c0 + 0.08; // grill on the outer face
  for (let a = o0 + 0.35; a < o1 - 0.2; a += 0.38) seg(a - 0.025, a + 0.025, g0, top - f, M.grill(), tag, gk - 0.025, gk + 0.025);
  seg(o0 + f, o1 - f, sill + h / 2 - 0.03, sill + h / 2 + 0.03, M.grill(), tag, gk - 0.03, gk + 0.03);
}

// Wall-embedded wardrobe: shutters flush with the `face` side, carcass recessed into the other side.
function almirah(seg, w, o, o0, o1, tag) {
  const face = o.face ?? 1, t2 = 0.375;
  const front = w.at + w.off + face * w.t / 2, back = front - face * ALMIRAH_D;
  const backOuter = back - face * t2, wallBack = w.at + w.off - face * w.t / 2;
  const K = (p, q) => [Math.min(p, q), Math.max(p, q)];
  const room = face > 0 ? w.neg : w.pos; // room the recess pokes into
  const rm = roomWall(room);
  const mats = w.axis === 'h' ? [M.cap(), M.cap(), M.poche(), M.cap(), rm, rm] : [rm, rm, M.poche(), M.cap(), M.cap(), M.cap()];
  seg(o0 - t2 / 2, o1 + t2 / 2, 0, WALL_H, mats, tag, ...K(back, backOuter));
  seg(o0 - t2 / 2, o0, 0, WALL_H, mats, tag, ...K(wallBack, back));
  seg(o1, o1 + t2 / 2, 0, WALL_H, mats, tag, ...K(wallBack, back));
  seg(o0, o1, 0, WALL_H, mat('cabinet'), tag, ...K(back, front - face * 0.05));
  seg(o0, o1, 0, 0.33, mat('plinth'), tag, ...K(front - face * 0.1, front));
  const n = Math.max(2, Math.round((o1 - o0) / 1.8)), pw = (o1 - o0) / n;
  for (let i = 0; i < n; i++) {
    const a0 = o0 + i * pw + 0.02, a1 = o0 + (i + 1) * pw - 0.02;
    seg(a0, a1, 0.36, 7.2, mat('teak'), tag, ...K(front - face * 0.05, front));
    seg(a0, a1, 7.3, WALL_H - 0.08, mat('walnut'), tag, ...K(front - face * 0.05, front));
    const hx = i % 2 ? a0 + 0.15 : a1 - 0.15;
    seg(hx - 0.03, hx + 0.03, 3.0, 4.4, mat('brass'), tag, ...K(front, front + face * 0.06));
  }
}

function verandah(design, group) {
  const sh = design.shed, W = design.plot.w;
  const ground = new THREE.Mesh(floorGeo(-150, -150, 300 + W, 300 + design.plot.d), M.grass());
  ground.position.y = -0.6; ground.receiveShadow = true; group.add(ground);
  trees(group);
  if (!sh) return null;
  const D = sh.depth;
  group.add(worldBox(0, W, -0.6, -0.15, -D, 0, floorMat('kota')));
  const main = design.openings.find(o => o.main);
  if (main) {
    const path = new THREE.Mesh(floorGeo(main.pos - 2.5, -D - 30, 5, 30), M.paver());
    path.position.y = -0.585; path.receiveShadow = true; group.add(path);
  }
  const frame = new THREE.Group(); group.add(frame);
  const yHi = 9.9, yLo = 8.3, z0 = 0.2, z1 = -D - 0.9, x0 = -0.6, x1 = W + 0.6;
  const yAt = z => yHi + (yLo - yHi) * (z - z0) / (z1 - z0);
  const postZ = -D + 0.4, steel = mat('steel');
  const nPosts = Math.max(2, Math.round(W / 8) + 1);
  for (let i = 0; i < nPosts; i++) {
    const x = 0.4 + i * (W - 0.8) / (nPosts - 1);
    frame.add(worldBox(x - 0.13, x + 0.13, -0.15, yAt(postZ) - 0.3, postZ - 0.13, postZ + 0.13, steel));
  }
  frame.add(worldBox(0, W, yAt(postZ) - 0.3, yAt(postZ), postZ - 0.15, postZ + 0.15, steel));
  for (const z of [-0.6, -D / 2, z1 + 0.5]) frame.add(worldBox(x0, x1, yAt(z) - 0.25, yAt(z) - 0.06, z - 0.08, z + 0.08, steel));
  // corrugated sheet: waves running down the slope, 8 samples per wave
  const PITCH = 0.35, nx = Math.round((x1 - x0) / (PITCH / 8)), geo = new THREE.PlaneGeometry(x1 - x0, 1, nx, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + (x0 + x1) / 2, v = p.getY(i) + 0.5, z = z0 + (z1 - z0) * v;
    p.setXYZ(i, x, yAt(z) + 0.06 * Math.sin(x * Math.PI * 2 / PITCH), z);
  }
  geo.computeVertexNormals();
  const roof = new THREE.Mesh(geo, M.sheet());
  roof.castShadow = roof.receiveShadow = true;
  frame.add(roof);
  return { frame, roof };
}

// Low-poly neem/mango trees around the site for scale.
const TREE_SPOTS = [[-25, -8, 0.95], [-27, 16, 1.1], [-23, 42, 0.9], [57, -6, 1.0], [59, 19, 0.85], [56, 44, 1.05], [3, 60, 0.9], [31, 62, 1.0], [-9, -31, 0.8], [45, -29, 0.9]];
function trees(group) {
  const trunk = once('trunk', () => std({ color: '#6b4a32', roughness: 0.9 }));
  const leaves = ['#5c8744', '#4a7639', '#6d9650'].map((c, i) => once('canopy' + i, () => std({ color: c, roughness: 0.85, flatShading: true })));
  TREE_SPOTS.forEach(([x, z, s], i) => {
    const t = new THREE.Group(); t.position.set(x, -0.6, z); t.scale.setScalar(s); t.rotation.y = i;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 7, 8), trunk); tr.position.y = 3.5; t.add(tr);
    for (const [dx, dy, dz, r] of [[0, 9.5, 0, 3.6], [1.9, 8.4, 1, 2.6], [-1.8, 8.6, -0.8, 2.8], [0.4, 11.4, -0.5, 2.3]]) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leaves[(i + (dx > 0 ? 1 : 0)) % 3]); c.position.set(dx, dy, dz); t.add(c);
    }
    t.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    group.add(t);
  });
}

const fmt0 = v => fmtFt(v);
function dimensions(design, dims, labels) {
  const zs = design.rooms.map(r => r.z + r.d), xs = design.rooms.map(r => r.x + r.w);
  const zMax = Math.max(...zs) + 2.5, xMax = Math.max(...xs) + 2.5, W = design.plot.w, Dd = design.plot.d;
  const line = (a, b) => dims.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), M.dim()));
  const V = (x, z) => new THREE.Vector3(x, 0.05, z);
  line(V(0, zMax), V(W, zMax)); line(V(xMax, 0), V(xMax, Dd));
  for (const x of [0, W]) { line(V(x, zMax - 0.8), V(x, zMax + 0.8)); line(V(x - 0.4, zMax + 0.4), V(x + 0.4, zMax - 0.4)); }
  for (const z of [0, Dd]) { line(V(xMax - 0.8, z), V(xMax + 0.8, z)); line(V(xMax - 0.4, z + 0.4), V(xMax + 0.4, z - 0.4)); }
  for (const [x, z, txt] of [[W / 2, zMax, fmtFt(W)], [xMax, Dd / 2, fmtFt(Dd)]]) {
    const el = document.createElement('div'); el.className = 'dim-label'; el.textContent = txt;
    const l = new CSS2DObject(el); l.position.set(x, 0.1, z); dims.add(l);
  }
  // dashed plot line just outside the facade: shows what sits beyond the 32×32
  const k = 0.45, loop = [V(-k, -k), V(W + k, -k), V(W + k, Dd + k), V(-k, Dd + k), V(-k, -k)];
  const plotLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(loop), once('plotLine', () => new THREE.LineDashedMaterial({ color: '#b4532a', dashSize: 0.8, gapSize: 0.5 })));
  plotLine.computeLineDistances(); dims.add(plotLine);
  const pl = document.createElement('div'); pl.className = 'dim-label plot-label'; pl.textContent = `${fmt0(W)} × ${fmt0(Dd)} plot line`;
  const plo = new CSS2DObject(pl); plo.position.set(W - 4, 0.1, Dd + k + 1.1); dims.add(plo);
  if (design.shed) {
    const el = document.createElement('div'); el.className = 'dim-label shed-label'; el.textContent = 'Tin shed · verandah (existing)';
    const l = new CSS2DObject(el); l.position.set(W * 0.22, 0.1, -design.shed.depth / 2); dims.add(l);
  }
}

// Arrow on the verandah floor + label pointing in through the main door.
function entryMarker(design, group, labels) {
  const o = design.openings.find(q => q.main);
  if (!o) return;
  const inward = Math.abs(o.at) < 1e-6 ? 1 : -1, shape = new THREE.Shape();
  shape.moveTo(-0.45, 0); shape.lineTo(0.45, 0); shape.lineTo(0.45, 1.6); shape.lineTo(1.1, 1.6); shape.lineTo(0, 2.8); shape.lineTo(-1.1, 1.6); shape.lineTo(-0.45, 1.6); shape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), once('entryM', () => new THREE.MeshBasicMaterial({ color: '#b4532a', transparent: true, opacity: 0.85 })));
  arrow.rotation.x = -Math.PI / 2; arrow.rotation.z = o.axis === 'h' ? (inward > 0 ? Math.PI : 0) : (inward > 0 ? Math.PI / 2 : -Math.PI / 2);
  const off = -inward * 4.2;
  arrow.position.set(o.axis === 'h' ? o.pos : o.at + off, -0.12, o.axis === 'h' ? o.at + off : o.pos);
  group.add(arrow);
  const el = document.createElement('div'); el.className = 'entry-label'; el.textContent = 'Entry';
  const l = new CSS2DObject(el); l.position.set(o.axis === 'h' ? o.pos : o.at + off * 1.55, 0.2, o.axis === 'h' ? o.at + off * 1.55 : o.pos);
  group.add(l); labels.push(l);
}
