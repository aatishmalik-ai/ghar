// Side-by-side comparison: same-scale SVG plans + key metrics for each design.
import * as P from './plan.js';

const SEATS = { sofaLeather: 3, sofaWood: 3, chairWood: 1, plasticChair: 1, twinBed: 3 };
const SWATCH = { marble: '#ece5d8', wood: '#d9b48c', kitchenTile: '#dcd8cf', bathTile: '#c4d3d7', cement: '#cfc9bf', kota: '#b8c0b6' };
const inRoom = (r, x, z) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d;

// Seats in the living zone + standing spots on a 2.5 ft grid that are clear of furniture, walls and door swings.
// Courtyards open to the sky don't count: nobody plans a party around rain.
export function capacity(design, walls, catalog) {
  const living = design.rooms.filter(r => r.zone === 'living' && !r.open);
  const inLiving = it => living.some(r => inRoom(r, it.x, it.z));
  const seated = design.items.reduce((n, it) => n + (inLiving(it) ? SEATS[it.type] || 0 : 0), 0);
  const { solids, swings } = P.obstacles(design, walls);
  const blocks = [
    ...solids.map(P.rectObb), ...swings.map(s => s.box),
    ...design.items.filter(it => catalog[it.type].solid !== false && !catalog[it.type].wall)
      .map(it => P.obb(it.x, it.z, it.w ?? catalog[it.type].w, it.d ?? catalog[it.type].d, it.rot)),
  ];
  const points = [];
  for (const r of living) {
    const c = P.clearRect(walls, r);
    for (let x = c.x0 + 1.25; x <= c.x1 - 1.0; x += 2.5) for (let z = c.z0 + 1.25; z <= c.z1 - 1.0; z += 2.5) {
      const spot = P.obb(x, z, 1.6, 1.6, 0);
      if (!blocks.some(b => P.overlaps(spot, b, 0))) points.push([x, z]);
    }
  }
  return { seated, standing: points.length, points };
}

// Which rooms a room opens onto (doors, arches, open boundaries).
function accessOf(design, walls, id) {
  const byWall = P.assignOpenings(design, walls), out = new Set();
  walls.forEach((w, wi) => {
    const other = w.pos?.id === id ? w.neg : w.neg?.id === id ? w.pos : undefined;
    if (other === undefined) return;
    if (w.kind === 'open' || (byWall.get(wi) || []).some(({ o }) => o.type === 'door' || o.type === 'arch')) out.add(other ? other.name : 'Outside');
  });
  return [...out].join(' + ') || '—';
}

export function metrics(design, base, catalog) {
  const walls = P.deriveWalls(design), area = f => Math.round(design.rooms.filter(f).reduce((s, r) => s + P.clearRect(walls, r, design).area, 0));
  const cap = capacity(design, walls, catalog), bath = design.rooms.find(r => r.id === 'bath'), store = design.rooms.find(r => r.id === 'store');
  const outside = design.rooms.filter(r => r.x < 0 || r.z < 0 || r.x + r.w > design.plot.w || r.z + r.d > design.plot.d);
  const issues = P.findClashes(design, walls, catalog).size + P.openingProblems(design, walls).length + P.unreachableRooms(design, walls).length;
  const sky = [...design.rooms.filter(r => r.open).map(r => `${r.name} ${Math.round(P.clearRect(walls, r, design).area)} sq ft`),
    ...(design.rooms.some(r => r.sky) ? [`${design.rooms.filter(r => r.sky).length} skylight${design.rooms.filter(r => r.sky).length > 1 ? 's' : ''}`] : [])];
  return [
    ['Living zone', `${area(r => r.zone === 'living')} sq ft`],
    ['Bedroom', `${area(r => r.id === 'bed')} sq ft`],
    ['Party capacity', `${cap.seated} seated + ${cap.standing} standing`],
    ['Beds', base.beds],
    ['Bath opens to', bath ? accessOf(design, walls, bath.id) : '—'],
    ['Store opens to', store ? accessOf(design, walls, store.id) : '—'],
    ['Open to the sky', sky.join(' + ') || '—'],
    ['Built outside 32×32', outside.length ? outside.map(r => `${r.name} (${P.fmtFt(r.w)} × ${P.fmtFt(r.d)})`).join(', ') : 'Nothing'],
    ['Vastu', `${base.vastu.filter(v => v[2]).length} of ${base.vastu.length} ✓`],
    ['Fit check', issues ? `${issues} issue${issues > 1 ? 's' : ''}` : '✓ all clear'],
  ];
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = v => Math.round(v * 100) / 100;

// box = [x0, z0, x1, z1] shared by all designs so the plans share one scale.
export function planSVG(design, catalog, box) {
  const walls = P.deriveWalls(design), { solids } = P.obstacles(design, walls), byWall = P.assignOpenings(design, walls);
  const out = [];
  const W = design.plot.w, Dd = design.plot.d;
  if (design.shed) {
    const D = design.shed.depth, cut = design.shed.cut, spans = cut ? [[0, cut[0]], [cut[1], W]].filter(([a, b]) => b - a > 0.5) : [[0, W]];
    for (const [a, b] of spans) out.push(`<rect x="${n(Math.max(0, a))}" y="${-D}" width="${n(Math.min(W, b) - Math.max(0, a))}" height="${D}" fill="#e4e0d6" stroke="#9a9184" stroke-width="0.12" stroke-dasharray="0.6 0.4"/>`);
    const [a, b] = spans.reduce((p, q) => (q[1] - q[0] > p[1] - p[0] ? q : p));
    out.push(`<text x="${n((Math.max(0, a) + Math.min(W, b)) / 2)}" y="${-D / 2 + 0.5}" class="sm">tin shed</text>`);
  }
  // neighbours' walls: a grey band just outside the plot line
  const band = { w: [-1.45, 0, -0.05, Dd, -90], e: [W + 0.05, 0, W + 1.45, Dd, 90], s: [0, Dd + 0.05, W, Dd + 1.45, 0] };
  for (const k of design.plot.neighbours || []) {
    const [x0, z0, x1, z1, rot] = band[k], cx = n((x0 + x1) / 2), cz = n((z0 + z1) / 2);
    out.push(`<rect x="${n(x0)}" y="${n(z0)}" width="${n(x1 - x0)}" height="${n(z1 - z0)}" fill="#c9c3b8"/><text x="${cx}" y="${n(cz + 0.3)}" class="sm" transform="rotate(${rot} ${cx} ${cz})" style="font-size:0.8px">neighbour</text>`);
  }
  for (const r of design.rooms) out.push(`<rect x="${r.x}" y="${r.z}" width="${r.w}" height="${r.d}" fill="${SWATCH[r.floor] || '#eee'}"/>`);
  const dash = 'fill="none" stroke="#5d564d" stroke-width="0.06" stroke-dasharray="0.5 0.35"';
  for (const r of design.rooms) {
    if (r.open) out.push(`<path d="M${r.x + 0.6} ${r.z + 0.6} L${r.x + r.w - 0.6} ${r.z + r.d - 0.6} M${r.x + r.w - 0.6} ${r.z + 0.6} L${r.x + 0.6} ${r.z + r.d - 0.6}" ${dash}/>`);
    if (r.sky) out.push(`<rect x="${r.sky.x}" y="${r.sky.z}" width="${r.sky.w}" height="${r.sky.d}" ${dash}/>`);
  }
  for (const it of design.items) {
    const c = catalog[it.type];
    if (c.wall) continue;
    const pts = P.obbCorners(P.obb(it.x, it.z, it.w ?? c.w, it.d ?? c.d, it.rot)).map(([x, z]) => `${n(x)},${n(z)}`).join(' ');
    out.push(`<polygon points="${pts}" fill="${it.type === 'rug' ? '#c9867a' : '#fbf8f2'}" fill-opacity="${it.type === 'rug' ? 0.45 : 1}" stroke="#7d7468" stroke-width="0.07"/>`);
  }
  for (const s of solids) out.push(`<rect x="${n(s.x0)}" y="${n(s.z0)}" width="${n(s.x1 - s.x0)}" height="${n(s.z1 - s.z0)}" fill="#2e2a26"/>`);
  walls.forEach((w, wi) => {
    for (const { o } of byWall.get(wi) || []) {
      const c0 = w.at + w.off - w.t / 2, a0 = o.pos - o.w / 2;
      if (o.type === 'window' || o.type === 'vent') {
        out.push(w.axis === 'h' ? `<rect x="${a0}" y="${n(c0)}" width="${o.w}" height="${w.t}" fill="#bcdbe6"/>` : `<rect x="${n(c0)}" y="${a0}" width="${w.t}" height="${o.w}" fill="#bcdbe6"/>`);
      } else if (o.type === 'door') {
        const lw = o.w - 0.28, hinge = o.hinge ?? -1, swing = o.swing ?? 1, hA = hinge < 0 ? a0 + 0.14 : a0 + o.w - 0.14;
        const face = w.at + w.off + swing * w.t / 2, dir = hinge < 0 ? 1 : -1;
        const P0 = w.axis === 'h' ? [hA + dir * lw, face] : [face, hA + dir * lw], P1 = w.axis === 'h' ? [hA, face + swing * lw] : [face + swing * lw, hA], H = w.axis === 'h' ? [hA, face] : [face, hA];
        const sweep = (w.axis === 'h' ? dir * swing > 0 : dir * swing < 0) ? 1 : 0;
        out.push(`<path d="M${n(H[0])} ${n(H[1])} L${n(P1[0])} ${n(P1[1])} M${n(P0[0])} ${n(P0[1])} A${n(lw)} ${n(lw)} 0 0 ${sweep} ${n(P1[0])} ${n(P1[1])}" fill="none" stroke="#6b6156" stroke-width="0.08"/>`);
      }
    }
  });
  for (const r of design.rooms) {
    if (r.label === false) continue;
    const c = P.clearRect(walls, r, design), x = (c.x0 + c.x1) / 2 + (r.lx || 0), z = (c.z0 + c.z1) / 2 + (r.lz || 0);
    const fs = n(Math.min(1.05, (c.w * 0.9) / (r.name.length * 0.72))); // shrink long names to fit narrow rooms
    out.push(`<text x="${n(x)}" y="${n(z)}" class="nm" style="font-size:${fs}px">${esc(r.name.toUpperCase())}</text><text x="${n(x)}" y="${n(z + fs + 0.35)}" class="sm" style="font-size:${n(Math.min(0.9, fs * 0.9))}px">${Math.round(c.area)} sq ft</text>`);
  }
  const m = design.openings.find(o => o.main);
  if (m) out.push(`<path d="M${m.pos - 0.9} -3.2 L${m.pos + 0.9} -3.2 L${m.pos} -1.3 Z" fill="#b4532a"/>`);
  const [x0, z0, x1, z1] = box;
  return `<svg viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(design.name)} plan"><style>.nm{font:700 1.05px sans-serif;letter-spacing:.08px;text-anchor:middle;fill:#221f1b}.sm{font:500 0.9px sans-serif;text-anchor:middle;fill:#5d564d}</style>${out.join('')}</svg>`;
}
