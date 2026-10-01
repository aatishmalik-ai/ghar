// Pure plan geometry, in feet. x → east, z → south (north is -z), y up.
// Rooms are axis-aligned rectangles on wall centre-lines; walls are derived from their edges.
export const T_EXT = 0.75;   // 9" brick outer wall, sits fully inside the room it bounds
export const T_INT = 0.375;  // 4.5" partition, centred on the line
export const WALL_H = 10;
export const MIN_ROOM = 3;
const E = 1e-6;
const r3 = v => Math.round(v * 1000) / 1000;

export function fmtFt(ft) {
  const neg = ft < 0; ft = Math.abs(ft);
  let f = Math.floor(ft + 1e-9), i = Math.round((ft - f) * 12);
  if (i === 12) { f += 1; i = 0; }
  return (neg ? '-' : '') + f + "'" + (i ? i + '"' : '');
}

// +1 / -1 = which side of this line is inside the plot, 0 = not a plot boundary line.
function plotSide(axis, at, plot) {
  const max = axis === 'h' ? plot.d : plot.w;
  return Math.abs(at) < E ? 1 : Math.abs(at - max) < E ? -1 : 0;
}
export const isLocked = (axis, at, plot) => plotSide(axis, at, plot) !== 0;

export function roomEdges(r) {
  return [
    { axis: 'h', at: r3(r.z), a: r3(r.x), b: r3(r.x + r.w), room: r, which: 'z0', side: 1 },
    { axis: 'h', at: r3(r.z + r.d), a: r3(r.x), b: r3(r.x + r.w), room: r, which: 'z1', side: -1 },
    { axis: 'v', at: r3(r.x), a: r3(r.z), b: r3(r.z + r.d), room: r, which: 'x0', side: 1 },
    { axis: 'v', at: r3(r.x + r.w), a: r3(r.z), b: r3(r.z + r.d), room: r, which: 'x1', side: -1 },
  ];
}

function lines(rooms) {
  const map = new Map();
  for (const r of rooms) for (const e of roomEdges(r)) {
    const k = e.axis + e.at;
    if (!map.has(k)) map.set(k, { axis: e.axis, at: e.at, edges: [] });
    map.get(k).edges.push(e);
  }
  return [...map.values()];
}

// Wall pieces: {axis, at, a, b, kind:'ext'|'int'|'open', t, off, pos, neg, lo, hi}
// 'h' runs along x at z=at; 'v' runs along z at x=at. off = wall centre offset from the line
// (towards +z/+x). pos/neg = room on the +/- side. [lo,hi] = extent of all edges on the line.
export function deriveWalls(design) {
  const out = [];
  for (const { axis, at, edges } of lines(design.rooms)) {
    const inward = plotSide(axis, at, design.plot);
    const pts = [...new Set(edges.flatMap(e => [e.a, e.b]))].sort((p, q) => p - q);
    const lo = pts[0], hi = pts[pts.length - 1];
    let cur = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1], m = (p + q) / 2;
      const pos = edges.find(e => e.side > 0 && e.a < m && e.b > m)?.room || null;
      const neg = edges.find(e => e.side < 0 && e.a < m && e.b > m)?.room || null;
      let kind, t = 0, off = 0;
      if (pos && neg) {
        if (pos.zone && pos.zone === neg.zone) kind = 'open';
        else if (inward) { kind = 'ext'; t = T_EXT; off = inward * T_EXT / 2; }
        else { kind = 'int'; t = T_INT; }
      } else if (pos || neg) { kind = 'ext'; t = T_EXT; off = (pos ? 1 : -1) * T_EXT / 2; }
      else { cur = null; continue; }
      if (cur && cur.b === p && cur.kind === kind && cur.off === off && cur.pos === pos && cur.neg === neg) cur.b = q;
      else out.push(cur = { axis, at, a: p, b: q, kind, t, off, pos, neg, lo, hi });
    }
  }
  return out;
}

// Along-axis extent of a solid wall piece. Partitions overhang half a thickness so
// L-corners close, clamped to the line so they never poke out of the facade.
export function wallSpan(w) {
  const ext = w.kind === 'int' ? w.t / 2 : 0;
  return [Math.max(w.lo, w.a - ext), Math.min(w.hi, w.b + ext)];
}

// Plan rectangle {x0,x1,z0,z1} of a wall piece (optionally a sub-range along it).
export function wallRect(w, a = null, b = null) {
  const [sa, sb] = a === null ? wallSpan(w) : [a, b];
  const c0 = w.at + w.off - w.t / 2, c1 = w.at + w.off + w.t / 2;
  return w.axis === 'h' ? { x0: sa, x1: sb, z0: c0, z1: c1 } : { x0: c0, x1: c1, z0: sa, z1: sb };
}

// Distance the walls on one edge of room r eat into it (max along the edge).
function intrusion(walls, axis, at, a, b, side) {
  let m = 0;
  for (const w of walls) {
    if (w.kind === 'open' || w.axis !== axis || Math.abs(w.at - at) > E || w.b <= a + E || w.a >= b - E) continue;
    m = Math.max(m, side > 0 ? w.off + w.t / 2 : w.t / 2 - w.off);
  }
  return m;
}

// Plan rect of a wall almirah: carcass + back wall, from its shutter face to 2'4.5" behind it.
export function almirahRect(w, o) {
  const face = o.face ?? 1, front = w.at + w.off + face * w.t / 2, outer = front - face * 2.375;
  const [k0, k1] = [Math.min(front, outer), Math.max(front, outer)], a0 = o.pos - o.w / 2 - 0.19, a1 = o.pos + o.w / 2 + 0.19;
  return w.axis === 'h' ? { x0: a0, x1: a1, z0: k0, z1: k1 } : { x0: k0, x1: k1, z0: a0, z1: a1 };
}

// Clear rect inside the walls; with `design`, area also excludes any almirah recess in the room.
export function clearRect(walls, r, design = null) {
  const x0 = r.x + intrusion(walls, 'v', r3(r.x), r.z, r.z + r.d, 1);
  const x1 = r.x + r.w - intrusion(walls, 'v', r3(r.x + r.w), r.z, r.z + r.d, -1);
  const z0 = r.z + intrusion(walls, 'h', r3(r.z), r.x, r.x + r.w, 1);
  const z1 = r.z + r.d - intrusion(walls, 'h', r3(r.z + r.d), r.x, r.x + r.w, -1);
  let area = (x1 - x0) * (z1 - z0);
  for (const o of design?.openings || []) {
    const w = o.type === 'almirah' && homeOf(walls, o);
    if (!w) continue;
    const q = almirahRect(w, o), ox = Math.min(x1, q.x1) - Math.max(x0, q.x0), oz = Math.min(z1, q.z1) - Math.max(z0, q.z0);
    if (ox > 0 && oz > 0) area -= ox * oz;
  }
  return { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0, area };
}

// Openings grouped by the wall piece holding their centre. Orphans (no wall) are skipped.
export function assignOpenings(design, walls) {
  const map = new Map();
  design.openings.forEach((o, idx) => {
    const wi = walls.findIndex(w => w.kind !== 'open' && w.axis === o.axis && Math.abs(w.at - o.at) < 1e-3 && o.pos > w.a - E && o.pos < w.b + E);
    if (wi < 0) return;
    if (!map.has(wi)) map.set(wi, []);
    map.get(wi).push({ o, idx });
  });
  return map;
}

// Room edges that move together when the wall line through [a,b] is dragged:
// everything on the same line transitively overlapping the picked piece.
export function lineGroup(design, axis, at, a, b) {
  const edges = design.rooms.flatMap(roomEdges).filter(e => e.axis === axis && Math.abs(e.at - at) < E);
  const group = new Set();
  let lo = a, hi = b, grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) if (!group.has(e) && e.b > lo + E && e.a < hi - E) {
      group.add(e); lo = Math.min(lo, e.a); hi = Math.max(hi, e.b); grew = true;
    }
  }
  return { edges: [...group], lo, hi };
}

const pairKey = w => `${w.pos?.id ?? '-'}|${w.neg?.id ?? '-'}`;
const homeOf = (walls, o) => walls.find(w => w.kind !== 'open' && w.axis === o.axis && Math.abs(w.at - o.at) < 1e-3 && o.pos > w.a - E && o.pos < w.b + E);

// Mutates design: shifts the wall line by delta. Returns true, or a reason string and
// changes nothing: 'locked' (plot boundary), 'small' (a room would drop below MIN_ROOM),
// 'opening' (a door/window would lose the wall between its two rooms).
export function moveLine(design, axis, at, a, b, delta) {
  if (!delta) return 'small';
  if (isLocked(axis, at, design.plot)) return 'locked';
  const { edges, lo, hi } = lineGroup(design, axis, at, a, b);
  const size = { x0: -delta, x1: delta, z0: -delta, z1: delta };
  const next = new Map();
  for (const e of edges) {
    const r = e.room, dim = e.which[0] === 'x' ? 'w' : 'd';
    const v = (next.get(r)?.[dim] ?? r[dim]) + size[e.which];
    if (v < MIN_ROOM - E) return 'small';
    next.set(r, { ...next.get(r), [dim]: v });
  }
  const before = deriveWalls(design);
  const homes = design.openings.map(o => { const w = homeOf(before, o); return w && pairKey(w); });
  const saved = design.rooms.map(r => [r.x, r.z, r.w, r.d]), savedO = design.openings.map(o => [o.at, o.pos]);
  for (const e of edges) {
    const r = e.room;
    if (e.which === 'x0') r.x = r3(r.x + delta);
    if (e.which === 'z0') r.z = r3(r.z + delta);
  }
  for (const [r, v] of next) { if (v.w !== undefined) r.w = r3(v.w); if (v.d !== undefined) r.d = r3(v.d); }
  for (const o of design.openings) {
    if (o.axis === axis && Math.abs(o.at - at) < 1e-3 && o.pos > lo - E && o.pos < hi + E) o.at = r3(o.at + delta);
  }
  // Keep every opening on a wall between the same two rooms, sliding it along if needed.
  const after = deriveWalls(design);
  for (const [i, o] of design.openings.entries()) {
    if (!homes[i]) continue;
    const fits = after.filter(w => w.kind !== 'open' && w.axis === o.axis && Math.abs(w.at - o.at) < 1e-3 && pairKey(w) === homes[i] && w.b - w.a >= o.w + 0.4);
    const w = fits.sort((p, q) => Math.abs((p.a + p.b) / 2 - o.pos) - Math.abs((q.a + q.b) / 2 - o.pos))[0];
    if (!w) {
      design.rooms.forEach((r, k) => { [r.x, r.z, r.w, r.d] = saved[k]; });
      design.openings.forEach((q, k) => { [q.at, q.pos] = savedO[k]; });
      return 'opening';
    }
    o.pos = r3(Math.min(w.b - o.w / 2 - 0.2, Math.max(w.a + o.w / 2 + 0.2, o.pos)));
  }
  return true;
}

// ---- footprints & clashes -------------------------------------------------------------
// Rotation about +y by rot degrees (three.js convention): local +x → (cos, -sin), local +z → (sin, cos).
export function obb(x, z, w, d, rot) {
  const a = rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x, z, hw: w / 2, hd: d / 2, ux: [c, -s], uz: [s, c] };
}
export const rectObb = r => obb((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, r.z1 - r.z0, 0);

export function overlaps(A, B, tol = 0.05) {
  const dx = B.x - A.x, dz = B.z - A.z;
  for (const n of [A.ux, A.uz, B.ux, B.uz]) {
    const ra = A.hw * Math.abs(A.ux[0] * n[0] + A.ux[1] * n[1]) + A.hd * Math.abs(A.uz[0] * n[0] + A.uz[1] * n[1]);
    const rb = B.hw * Math.abs(B.ux[0] * n[0] + B.ux[1] * n[1]) + B.hd * Math.abs(B.uz[0] * n[0] + B.uz[1] * n[1]);
    if (Math.abs(dx * n[0] + dz * n[1]) >= ra + rb - tol) return false;
  }
  return true;
}

export function obbCorners(b) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => [
    b.x + i * b.hw * b.ux[0] + k * b.hd * b.uz[0],
    b.z + i * b.hw * b.ux[1] + k * b.hd * b.uz[1],
  ]);
}

// Solid wall rectangles (door/arch gaps removed) and door swing squares.
export function obstacles(design, walls) {
  const solids = [], swings = [];
  const byWall = assignOpenings(design, walls);
  walls.forEach((w, wi) => {
    if (w.kind === 'open') return;
    const [sa, sb] = wallSpan(w);
    let cuts = [];
    for (const { o, idx } of byWall.get(wi) || []) {
      if (o.type === 'almirah') solids.push(almirahRect(w, o)); // wall stays solid; the carcass pokes into the room behind
      if (o.type !== 'door' && o.type !== 'arch') continue;
      cuts.push([o.pos - o.w / 2, o.pos + o.w / 2]);
      if (o.type === 'door') { // leaf sweep on the swing side + 2 ft to walk up to it on the other side
        const face = w.at + w.off + o.swing * w.t / 2, c = face + o.swing * o.w / 2, c2 = face - o.swing * (w.t + 1);
        swings.push({ idx, kind: 'swing', box: w.axis === 'h' ? obb(o.pos, c, o.w, o.w, 0) : obb(c, o.pos, o.w, o.w, 0) });
        swings.push({ idx, kind: 'approach', box: w.axis === 'h' ? obb(o.pos, c2, o.w - 0.2, 2, 0) : obb(c2, o.pos, 2, o.w - 0.2, 0) });
      }
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let s = sa;
    for (const [c0, c1] of cuts) { if (c0 > s + E) solids.push(wallRect(w, s, c0)); s = Math.max(s, c1); }
    if (sb > s + E) solids.push(wallRect(w, s, sb));
  });
  return { solids, swings };
}

// Openings that can't work: a door leaf sweeping into another wall. Returns [{idx, msg}].
export function openingProblems(design, walls) {
  const { solids, swings } = obstacles(design, walls), out = [];
  for (const sw of swings) {
    if (sw.kind !== 'swing') continue;
    const o = design.openings[sw.idx], face = sw.box, inner = obb(face.x, face.z, face.hw * 2 - 0.1, face.hd * 2 - 0.1, 0);
    if (solids.some(s => overlaps(inner, rectObb(s), 0.02))) out.push({ idx: sw.idx, msg: `${o.main ? 'Main door' : 'Door'} swings into a wall — make it narrower or move it` });
  }
  return out;
}

// Rooms nobody can walk into from outside through doors, arches or open boundaries.
export function unreachableRooms(design, walls) {
  const links = new Map(), link = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { if (!links.has(p)) links.set(p, new Set()); links.get(p).add(q); } };
  const byWall = assignOpenings(design, walls);
  walls.forEach((w, wi) => {
    const a = w.pos?.id ?? 'outside', b = w.neg?.id ?? 'outside';
    if (w.kind === 'open' || (byWall.get(wi) || []).some(({ o }) => o.type === 'door' || o.type === 'arch')) link(a, b);
  });
  const seen = new Set(['outside']), todo = ['outside'];
  while (todo.length) for (const n of links.get(todo.pop()) || []) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  return design.rooms.filter(r => !seen.has(r.id));
}

// catalog[type] → {w,d,solid,tuck,table}. Returns Map itemId → [reason strings].
export function findClashes(design, walls, catalog) {
  const out = new Map();
  const add = (id, msg) => { if (!out.has(id)) out.set(id, []); out.get(id).push(msg); };
  const { solids, swings } = obstacles(design, walls);
  const items = design.items.filter(it => catalog[it.type]?.solid !== false);
  const box = it => { const c = catalog[it.type]; return obb(it.x, it.z, it.w ?? c.w, it.d ?? c.d, it.rot); };
  const boxes = items.map(box);
  items.forEach((it, i) => {
    for (const s of solids) if (overlaps(boxes[i], rectObb(s))) { add(it.id, 'runs into a wall'); break; }
    const hit = swings.find(sw => overlaps(boxes[i], sw.box));
    if (hit) add(it.id, hit.kind === 'swing' ? 'blocks a door swing' : 'blocks a doorway');
    for (let j = i + 1; j < items.length; j++) {
      const a = catalog[it.type], b = catalog[items[j].type];
      if ((a.tuck && b.table) || (b.tuck && a.table)) continue;
      if (overlaps(boxes[i], boxes[j])) {
        add(it.id, 'overlaps ' + b.name); add(items[j].id, 'overlaps ' + a.name);
      }
    }
  });
  return out;
}
