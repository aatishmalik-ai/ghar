// Procedural furniture, materials and canvas textures. Units: feet. Every item is built
// around its footprint centre at floor level with its front facing local +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// group: mine = user's own furniture, fixture = built-in, suggested = not owned yet.
// wall: mount height (item snaps to walls). solid:false = ignored by clash checks.
// tuck: may slide under a `table`. resize: editable width ('w') or width+depth ('wd').
export const CATALOG = {
  queenBed: { name: 'Queen bed', w: 5.2, d: 6.9, h: 3.6, group: 'mine' },
  twinBed: { name: 'Twin bed', w: 3.3, d: 6.6, h: 3.0, group: 'mine' },
  sofaLeather: { name: 'Black leather sofa', w: 6.8, d: 3.0, h: 2.8, group: 'mine' },
  sofaWood: { name: 'Teak sofa (old-school)', w: 6.2, d: 2.7, h: 2.9, group: 'mine' },
  chairWood: { name: 'Teak armchair', w: 2.3, d: 2.3, h: 2.7, group: 'mine' },
  partyBox: { name: 'JBL PartyBox', w: 1.35, d: 1.5, h: 3.4, group: 'mine' },
  micStand: { name: 'Mic + stand', w: 1.4, d: 1.4, h: 5.2, group: 'mine' },
  fan: { name: 'Pedestal fan', w: 1.5, d: 1.5, h: 4.3, group: 'mine' },
  plasticChair: { name: 'Plastic chair', w: 1.8, d: 1.75, h: 2.8, group: 'mine', tuck: true },
  frame: { name: 'Photo frame', w: 1.4, d: 0.12, h: 1.9, group: 'mine', wall: 5.2, solid: false },
  frameWide: { name: 'Photo frame (wide)', w: 2.4, d: 0.12, h: 1.6, group: 'mine', wall: 5.4, solid: false },
  boxStack: { name: 'Storage boxes', w: 2.0, d: 1.5, h: 2.6, group: 'mine' },
  rack: { name: 'Steel storage rack', w: 3.0, d: 1.25, h: 6.5, group: 'fixture' },
  counter: { name: 'Kitchen counter', w: 2, d: 2.0, h: 2.83, group: 'fixture', resize: 'w' },
  counterSink: { name: 'Counter + sink', w: 3, d: 2.0, h: 2.83, group: 'fixture' },
  counterStove: { name: 'Counter + hob & chimney', w: 2.5, d: 2.0, h: 9.2, group: 'fixture' },
  wc: { name: 'WC', w: 1.35, d: 2.3, h: 2.6, group: 'fixture' },
  basin: { name: 'Wash basin + mirror', w: 1.7, d: 1.4, h: 5.8, group: 'fixture' },
  shower: { name: 'Shower area', w: 3, d: 3, h: 7, group: 'fixture' },
  geyser: { name: 'Geyser', w: 1.3, d: 1.0, h: 1.0, group: 'fixture', wall: 6.4, solid: false },
  fridge: { name: 'Refrigerator', w: 2.3, d: 2.3, h: 5.8, group: 'suggested' },
  diningTable: { name: 'Dining table', w: 4.5, d: 3.0, h: 2.5, group: 'suggested', table: true },
  coffeeTable: { name: 'Coffee table', w: 4.0, d: 2.0, h: 1.4, group: 'suggested', table: true },
  rug: { name: 'Rug', w: 8, d: 6, h: 0.05, group: 'suggested', solid: false, resize: 'wd' },
  tvUnit: { name: 'TV + console', w: 6, d: 1.3, h: 5.5, group: 'suggested' },
  washer: { name: 'Washing machine', w: 2.0, d: 2.0, h: 2.8, group: 'suggested' },
  shoeRack: { name: 'Shoe rack', w: 2.5, d: 1.1, h: 3.0, group: 'suggested' },
  plant: { name: 'Areca palm', w: 1.4, d: 1.4, h: 4.2, group: 'suggested', solid: false },
  jaali: { name: 'Jaali screen', w: 4, d: 0.25, h: 7, group: 'suggested', resize: 'w' },
};
export const GROUP_LABEL = { mine: 'Your furniture', fixture: 'Built-in', suggested: 'Suggested' };

// ---- deterministic noise for textures (visual only, not used for anything security-related)
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
const hash = str => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function tiles(g, S, n, base, jitter, grout, seed, extra, gw = 2) {
  const R = rng(seed), T = S / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (R() - 0.5) * jitter;
    g.fillStyle = `rgb(${base.map(c => Math.round(c + k)).join(',')})`;
    g.fillRect(i * T, j * T, T, T);
    if (extra) { g.save(); g.beginPath(); g.rect(i * T, j * T, T, T); g.clip(); extra(g, i * T, j * T, T, R); g.restore(); }
  }
  g.fillStyle = grout;
  for (let i = 0; i <= n; i++) { g.fillRect(i * T - gw / 2, 0, gw, S); g.fillRect(0, i * T - gw / 2, S, gw); }
}
function speckle(g, S, n, colors, seed, rmax = 1.5) {
  const R = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(R() * colors.length)];
    g.beginPath(); g.arc(R() * S, R() * S, 0.3 + R() * rmax, 0, 7); g.fill();
  }
}

// Texture world sizes (ft covered by one repeat) are in TEX_FT.
export const TEX_FT = { marble: 4, wood: 4, kitchenTile: 4, bathTile: 4, cement: 8, kota: 4, grass: 16, wallTile: 4, plaster: 8, paver: 6 };
const PAINT = {
  marble: () => canvasTex(512, (g, S) => tiles(g, S, 2, [229, 221, 207], 9, '#b3a591', 3, (g, x, y, T, R) => {
    for (let i = 0; i < 10; i++) {
      const cx = x + R() * T, cy = y + R() * T, gr = g.createRadialGradient(cx, cy, 0, cx, cy, 40 + R() * 80);
      gr.addColorStop(0, R() > 0.5 ? 'rgba(214,205,192,0.12)' : 'rgba(252,250,245,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x, y, T, T);
    }
    for (let v = 0; v < 4; v++) {
      g.strokeStyle = `rgba(150,138,124,${0.06 + R() * 0.1})`; g.lineWidth = 0.4 + R() * 1.1;
      g.beginPath(); g.moveTo(x + R() * T, y);
      g.bezierCurveTo(x + R() * T, y + T * 0.3, x + R() * T, y + T * 0.7, x + R() * T, y + T); g.stroke();
    }
  }, 4)),
  wood: () => canvasTex(512, (g, S) => {
    const R = rng(11), P = S / 8;
    for (let j = 0; j < 8; j++) {
      let x = -R() * S * 0.5;
      while (x < S) {
        const len = S * (0.35 + R() * 0.55), t = R();
        g.fillStyle = `rgb(${172 - t * 34},${124 - t * 28},${82 - t * 22})`;
        g.fillRect(x, j * P, len, P);
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = `rgba(70,40,20,${0.05 + R() * 0.12})`; g.lineWidth = 0.5 + R();
          const yy = j * P + R() * P; g.beginPath(); g.moveTo(x, yy);
          g.bezierCurveTo(x + len * 0.3, yy + (R() - 0.5) * 6, x + len * 0.6, yy + (R() - 0.5) * 6, x + len, yy); g.stroke();
        }
        g.fillStyle = 'rgba(40,24,12,0.55)'; g.fillRect(x, j * P, 1.5, P);
        x += len;
      }
      g.fillStyle = 'rgba(40,24,12,0.5)'; g.fillRect(0, j * P, S, 1.5);
    }
  }),
  kitchenTile: () => canvasTex(512, (g, S) => tiles(g, S, 4, [214, 210, 202], 8, '#b9b3a8', 5, (g, x, y, T, R) => speckle(g, T, 60, ['rgba(120,110,100,0.15)'], R() * 1e6 | 0, 1))),
  bathTile: () => canvasTex(512, (g, S) => tiles(g, S, 4, [176, 194, 199], 10, '#93a5aa', 9, (g, x, y, T, R) => {
    g.save(); g.translate(x, y); speckle(g, T, 220, ['rgba(255,255,255,0.18)', 'rgba(40,60,70,0.12)'], R() * 1e6 | 0, 1.2); g.restore();
  })),
  cement: () => canvasTex(512, (g, S) => { g.fillStyle = '#b9b3a8'; g.fillRect(0, 0, S, S); speckle(g, S, 5000, ['rgba(90,85,78,0.12)', 'rgba(255,255,255,0.12)'], 13, 1.4); }),
  kota: () => canvasTex(512, (g, S) => tiles(g, S, 2, [138, 150, 140], 14, '#6f7a70', 17, (g, x, y, T, R) => {
    g.save(); g.translate(x, y); speckle(g, T, 900, ['rgba(80,95,88,0.2)', 'rgba(190,200,190,0.15)'], R() * 1e6 | 0, 2); g.restore();
  })),
  grass: () => canvasTex(512, (g, S) => {
    g.fillStyle = '#7f9a5c'; g.fillRect(0, 0, S, S);
    const R = rng(19);
    for (let i = 0; i < 9000; i++) {
      const t = R();
      g.strokeStyle = `rgba(${70 + t * 70},${105 + t * 60},${45 + t * 30},0.55)`; g.lineWidth = 1;
      const x = R() * S, y = R() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 3, y - 2 - R() * 5); g.stroke();
    }
  }),
  paver: () => canvasTex(512, (g, S) => tiles(g, S, 3, [178, 164, 142], 18, '#8c7f6c', 23)),
  wallTile: () => canvasTex(512, (g, S) => {
    const R = rng(29);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) {
      const k = 243 + (R() - 0.5) * 6; g.fillStyle = `rgb(${k},${k},${k - 2})`; g.fillRect(i * 128, j * 64, 128, 64);
    }
    g.fillStyle = '#c9ccce';
    for (let i = 0; i <= 4; i++) g.fillRect(i * 128 - 1, 0, 2, S);
    for (let j = 0; j <= 8; j++) g.fillRect(0, j * 64 - 1, S, 2);
  }),
  plaster: () => canvasTex(512, (g, S) => { g.fillStyle = '#e3d2b3'; g.fillRect(0, 0, S, S); speckle(g, S, 7000, ['rgba(150,120,80,0.08)', 'rgba(255,255,255,0.12)'], 31, 1.6); }),
  teak: () => canvasTex(256, (g, S) => {
    g.fillStyle = '#8a5530'; g.fillRect(0, 0, S, S);
    const R = rng(37);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(${R() > 0.5 ? '60,30,12' : '170,110,60'},${0.08 + R() * 0.16})`; g.lineWidth = 0.5 + R() * 2;
      const y = R() * S; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y + (R() - 0.5) * 14, S * 0.7, y + (R() - 0.5) * 14, S, y); g.stroke();
    }
  }),
  sofaPattern: () => canvasTex(256, (g, S) => { // blue-grey block print, like the reference sofa
    const T = S / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * T, y = j * T, c = x + T / 2, m = y + T / 2;
      g.fillStyle = (i + j) % 2 ? '#dcdad3' : '#cfd3d6'; g.fillRect(x, y, T, T);
      g.fillStyle = '#34465f'; g.beginPath(); g.moveTo(c, y + 4); g.lineTo(x + T - 4, m); g.lineTo(c, y + T - 4); g.lineTo(x + 4, m); g.fill();
      g.fillStyle = '#8b9bb0'; g.beginPath(); g.moveTo(c, y + 14); g.lineTo(x + T - 14, m); g.lineTo(c, y + T - 14); g.lineTo(x + 14, m); g.fill();
      g.fillStyle = '#eeebe4'; g.beginPath(); g.arc(c, m, 6, 0, 7); g.fill();
      g.fillStyle = '#34465f'; for (const [a, b] of [[x + 3, y + 3], [x + T - 3, y + 3], [x + 3, y + T - 3], [x + T - 3, y + T - 3]]) { g.beginPath(); g.arc(a, b, 4, 0, 7); g.fill(); }
    }
  }),
  granite: () => canvasTex(256, (g, S) => { g.fillStyle = '#232326'; g.fillRect(0, 0, S, S); speckle(g, S, 2600, ['rgba(200,200,205,0.35)', 'rgba(120,95,80,0.4)', 'rgba(0,0,0,0.5)'], 41, 1.3); }),
  cardboard: () => canvasTex(128, (g, S) => { g.fillStyle = '#b98a57'; g.fillRect(0, 0, S, S); speckle(g, S, 600, ['rgba(90,60,30,0.12)', 'rgba(240,210,160,0.1)'], 43, 1); }),
  grill: () => canvasTex(128, (g, S) => { g.fillStyle = '#141416'; g.fillRect(0, 0, S, S); g.fillStyle = '#2b2b30'; for (let y = 4; y < S; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < S; x += 8) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); } }),
  jaali: () => canvasTex(256, (g, S) => { // alpha map: white = solid
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.fillStyle = '#000';
    const T = S / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const c = i * T + T / 2, m = j * T + T / 2;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.ellipse(c + Math.cos(a) * T * 0.24, m + Math.sin(a) * T * 0.24, T * 0.16, T * 0.07, a, 0, 7); g.fill(); }
      g.beginPath(); g.arc(c, m, T * 0.08, 0, 7); g.fill();
    }
  }, false),
  rug: () => canvasTex(512, (g, S) => {
    g.fillStyle = '#7b2432'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#1e2b48'; g.lineWidth = 46; g.strokeRect(23, 23, S - 46, S - 46);
    g.strokeStyle = '#c9a45c'; g.lineWidth = 4; g.strokeRect(50, 50, S - 100, S - 100); g.strokeRect(8, 8, S - 16, S - 16);
    g.fillStyle = '#c9a45c';
    for (let i = 0; i < 12; i++) for (const [x, y] of [[48 + i * 38, 23], [48 + i * 38, S - 23], [23, 48 + i * 38], [S - 23, 48 + i * 38]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
    const c = S / 2;
    g.fillStyle = '#1e2b48'; g.beginPath(); g.moveTo(c, 110); g.lineTo(S - 110, c); g.lineTo(c, S - 110); g.lineTo(110, c); g.fill();
    g.fillStyle = '#c9a45c'; g.beginPath(); g.moveTo(c, 150); g.lineTo(S - 150, c); g.lineTo(c, S - 150); g.lineTo(150, c); g.fill();
    g.fillStyle = '#7b2432'; g.beginPath(); g.arc(c, c, 40, 0, 7); g.fill();
    g.fillStyle = '#e8dcc2'; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g.beginPath(); g.arc(c + Math.cos(a) * 24, c + Math.sin(a) * 24, 7, 0, 7); g.fill(); }
  }),
  tv: () => canvasTex(512, (g, S) => {
    const gr = g.createLinearGradient(0, 0, S, S); gr.addColorStop(0, '#1b1440'); gr.addColorStop(1, '#3a1d5c');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) { const R = rng(i + 50); g.fillStyle = `rgba(255,${150 + R() * 100},${200 * R()},0.25)`; g.beginPath(); g.arc(R() * S, R() * S * 0.6, 2 + R() * 10, 0, 7); g.fill(); }
    g.textAlign = 'center'; g.font = 'bold 44px Georgia, serif'; g.fillStyle = '#ffd36e'; g.fillText('♪ KARAOKE NIGHT ♪', S / 2, 170);
    g.font = '30px Georgia, serif'; g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText('Tujhe dekha to ye jaana sanam', S / 2, 290);
    g.fillStyle = '#7ef0ff'; g.fillText('pyaar hota hai deewana sanam', S / 2, 345);
  }),
  bedMaroon: () => ogee('#7a2a36', '#e2bd6e', '#f3e6c8'),
  bedIndigo: () => ogee('#2b3f63', '#d9e2ee', '#e2bd6e'),
  bedMustard: () => ogee('#b8892e', '#7a2a36', '#fff3d6'),
};
// Ogee-lattice bedsheet print (tileable): two families of waves crossing into leaf-shaped cells.
function ogee(base, ink, dot) {
  return canvasTex(256, (g, S) => {
    const T = S / 4;
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    g.strokeStyle = ink; g.lineWidth = 3;
    for (let k = -1; k <= 4; k++) for (const sg of [1, -1]) {
      g.beginPath();
      for (let y = 0; y <= S; y += 4) { const x = k * T + sg * Math.sin(y / T * Math.PI) * T * 0.4; if (y) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    g.fillStyle = dot;
    for (let j = 0; j < 2; j++) for (let k = 0; k <= 4; k++) {
      for (const [x, y] of [[k * T, T / 2 + 2 * j * T], [(k + 0.5) * T, 1.5 * T + 2 * j * T]]) { g.beginPath(); g.ellipse(x, y, 5, 9, 0, 0, 7); g.fill(); }
    }
  });
}
const texCache = {};
export const tex = name => texCache[name] || (texCache[name] = PAINT[name]());

// Framed pictures: generated scenes so the walls have something personal-looking.
const PHOTOS = [
  (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#f6b26b'); gr.addColorStop(0.55, '#e0677b'); gr.addColorStop(1, '#5b3a73'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(W * 0.62, H * 0.52, W * 0.12, 0, 7); g.fill(); g.fillStyle = '#3b2346'; g.beginPath(); g.moveTo(0, H); g.lineTo(0, H * 0.7); g.quadraticCurveTo(W * 0.3, H * 0.52, W * 0.55, H * 0.72); g.quadraticCurveTo(W * 0.8, H * 0.6, W, H * 0.68); g.lineTo(W, H); g.fill(); },
  (g, W, H) => { g.fillStyle = '#c9a77c'; g.fillRect(0, 0, W, H); g.fillStyle = '#6e5238'; for (const [x, s] of [[0.28, 1], [0.5, 1.15], [0.72, 0.95]]) { g.beginPath(); g.arc(W * x, H * 0.42, W * 0.08 * s, 0, 7); g.fill(); g.beginPath(); g.ellipse(W * x, H * 0.85, W * 0.14 * s, H * 0.28, 0, Math.PI, 0); g.fill(); } },
  (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#8fd3f4'); gr.addColorStop(0.55, '#3a8fc2'); gr.addColorStop(0.56, '#1f6f99'); gr.addColorStop(0.75, '#e9d7a8'); gr.addColorStop(1, '#d9c28c'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(W * 0.3, H * 0.2, W * 0.12, H * 0.04, 0, 0, 7); g.fill(); },
  (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#fbd786'); gr.addColorStop(1, '#f7797d'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = '#fff6ea'; g.beginPath(); g.arc(W / 2, H * 0.55, W * 0.2, Math.PI, 0); g.fill(); g.fillRect(W * 0.28, H * 0.55, W * 0.44, H * 0.3); g.fillRect(W * 0.12, H * 0.35, W * 0.05, H * 0.5); g.fillRect(W * 0.83, H * 0.35, W * 0.05, H * 0.5); g.fillStyle = '#b86b77'; g.fillRect(0, H * 0.85, W, H * 0.15); },
  (g, W, H) => { g.fillStyle = '#efe6d6'; g.fillRect(0, 0, W, H); const R = rng(71); for (let i = 0; i < 14; i++) { g.fillStyle = ['#d1495b', '#edae49', '#00798c', '#30638e'][i % 4]; g.globalAlpha = 0.75; g.beginPath(); g.arc(R() * W, R() * H, W * (0.06 + R() * 0.12), 0, 7); g.fill(); } g.globalAlpha = 1; },
  (g, W, H) => { g.fillStyle = '#b89572'; g.fillRect(0, 0, W, H); g.fillStyle = '#5d4630'; for (const x of [0.38, 0.62]) { g.beginPath(); g.arc(W * x, H * 0.36, W * 0.1, 0, 7); g.fill(); g.beginPath(); g.ellipse(W * x, H * 0.9, W * 0.16, H * 0.36, 0, Math.PI, 0); g.fill(); } g.strokeStyle = '#e8b04a'; g.lineWidth = 6; g.beginPath(); g.arc(W * 0.5, H * 0.52, W * 0.2, 0.2, Math.PI - 0.2); g.stroke(); },
];
function photoTex(v) {
  const key = 'photo' + v;
  return texCache[key] || (texCache[key] = canvasTex(256, (g, S) => PHOTOS[v % PHOTOS.length](g, S, S)));
}

// ---- materials -------------------------------------------------------------------------
const std = (o) => new THREE.MeshStandardMaterial(o);
const phys = (o) => new THREE.MeshPhysicalMaterial(o);
const MATS = {
  teak: () => std({ map: tex('teak'), roughness: 0.55 }),
  walnut: () => std({ color: '#5a3a24', map: tex('teak'), roughness: 0.5 }),
  leather: () => phys({ color: '#1a1a1c', roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35 }),
  fabricGrey: () => std({ color: '#a7adb0', roughness: 0.95 }),
  sofaPattern: () => std({ map: tex('sofaPattern'), roughness: 0.9, side: THREE.DoubleSide }),
  barrelPattern: () => { const t = tex('sofaPattern').clone(); t.repeat.set(3.5, 1.15); t.needsUpdate = true; return std({ map: t, roughness: 0.9, side: THREE.DoubleSide }); },
  white: () => std({ color: '#f3f1ec', roughness: 0.9 }),
  pillow: () => std({ color: '#f7f4ee', roughness: 0.95 }),
  headboard: () => std({ color: '#8c7b6a', roughness: 0.95 }),
  chrome: () => std({ color: '#e1e3e6', metalness: 1, roughness: 0.18 }),
  steel: () => std({ color: '#8a9096', metalness: 0.6, roughness: 0.45 }),
  stainless: () => std({ color: '#c9cdd1', metalness: 0.75, roughness: 0.32 }),
  blackPlastic: () => std({ color: '#141416', roughness: 0.55 }),
  grill: () => std({ map: tex('grill'), roughness: 0.9 }),
  led: () => std({ color: '#111', emissive: '#ff3fa4', emissiveIntensity: 2.2 }),
  orange: () => std({ color: '#ff5a1f', roughness: 0.4 }),
  whitePlastic: () => std({ color: '#f2f1ec', roughness: 0.45 }),
  fanBlade: () => std({ color: '#8ec5e6', roughness: 0.3, transparent: true, opacity: 0.85 }),
  cardboard: () => std({ map: tex('cardboard'), roughness: 0.95 }),
  tape: () => std({ color: '#d8b98a', roughness: 0.6 }),
  granite: () => std({ map: tex('granite'), roughness: 0.25 }),
  cabinet: () => std({ color: '#ebe4d6', roughness: 0.6 }),
  cabinetDark: () => std({ color: '#7a5a43', roughness: 0.6 }),
  plinth: () => std({ color: '#3a3632', roughness: 0.8 }),
  ceramic: () => phys({ color: '#fbfbf9', roughness: 0.12, clearcoat: 0.6 }),
  glass: () => phys({ color: '#cfe6ee', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false }),
  mirror: () => std({ color: '#dfe7ec', metalness: 1, roughness: 0.04 }),
  screen: () => std({ color: '#000', emissive: '#ffffff', emissiveMap: tex('tv'), emissiveIntensity: 0.9, roughness: 0.2 }),
  rug: () => std({ map: tex('rug'), roughness: 1 }),
  leaf: () => std({ color: '#4a8a3c', roughness: 0.7, side: THREE.DoubleSide }),
  pot: () => std({ color: '#b5562f', roughness: 0.85 }),
  soil: () => std({ color: '#3b2a1e', roughness: 1 }),
  brass: () => std({ color: '#c9a44c', metalness: 0.9, roughness: 0.3 }),
  jaali: () => std({ color: '#8a5530', map: tex('teak'), alphaMap: tex('jaali'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }),
  frameGold: () => std({ color: '#b08a45', metalness: 0.7, roughness: 0.35 }),
  frameDark: () => std({ color: '#2b211b', roughness: 0.5 }),
  mat: () => std({ color: '#f4efe6', roughness: 0.9 }),
  blanket: () => std({ color: '#c96d4a', roughness: 0.95 }),
  bedMaroon: () => sheet('bedMaroon'),
  bedIndigo: () => sheet('bedIndigo'),
  bedMustard: () => sheet('bedMustard'),
  suitcase: () => std({ color: '#2f4f6f', roughness: 0.5 }),
  blanketBlue: () => std({ color: '#3f6f8f', roughness: 0.95 }),
};
function sheet(name) { const t = tex(name).clone(); t.repeat.set(2, 2); t.needsUpdate = true; return std({ map: t, roughness: 0.95 }); }
const matCache = {};
export const mat = name => matCache[name] || (matCache[name] = MATS[name]());
const photoMats = {};
const photoMat = v => photoMats[v] || (photoMats[v] = std({ map: photoTex(v), roughness: 0.6 }));

// ---- primitive helpers (y = bottom of the shape) ------------------------------------------
function add(parent, geo, m, x, y, z) {
  const mesh = new THREE.Mesh(geo, typeof m === 'string' ? mat(m) : m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
const box = (p, w, h, d, m, x = 0, y = 0, z = 0) => add(p, new THREE.BoxGeometry(w, h, d), m, x, y + h / 2, z);
const rbox = (p, w, h, d, r, m, x = 0, y = 0, z = 0) => add(p, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), m, x, y + h / 2, z);
const cyl = (p, rt, rb, h, m, x = 0, y = 0, z = 0, seg = 20) => add(p, new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y + h / 2, z);
const tube = (p, pts, r, m) => add(p, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(q => new THREE.Vector3(...q))), 40, r, 8), m, 0, 0, 0);
function cabriole(p, x, z, top, sx, sz) { // splayed, tapered teak leg
  const leg = cyl(p, 0.075, 0.045, top, 'teak', x, 0, z, 10);
  leg.rotation.set(-sz * 0.12, 0, sx * 0.12);
}

// ---- builders --------------------------------------------------------------------------------
const B = {};
B.queenBed = (g, it) => bed(g, 5.2, 6.9, 3.6, it.v === 1 ? 'bedIndigo' : 'bedMaroon', 2);
B.twinBed = (g, it) => bed(g, 3.3, 6.6, 3.0, 'bedMustard', 1);
function bed(g, w, d, hh, sheet, pillows) {
  box(g, w - 0.3, 0.18, d - 0.3, 'plinth');
  rbox(g, w, 0.95, d, 0.06, 'teak', 0, 0.15, 0);
  rbox(g, w - 0.2, 0.62, d - 0.45, 0.18, 'white', 0, 1.08, 0.12);
  rbox(g, w - 0.14, 0.64, (d - 0.45) * 0.7, 0.18, sheet, 0, 1.08, 0.12 + (d - 0.45) * 0.15);
  rbox(g, w - 0.3, 0.14, 1.0, 0.06, 'blanket', 0, 1.72, d / 2 - 0.8);
  const pw = (w - 0.6) / pillows - 0.12;
  for (let i = 0; i < pillows; i++) {
    const p = rbox(g, pw, 0.34, 1.1, 0.15, 'pillow', -w / 2 + 0.3 + pw / 2 + i * (pw + 0.12) + 0.06, 1.62, -d / 2 + 0.95);
    p.rotation.x = -0.25;
  }
  box(g, w + 0.1, hh - 0.15, 0.28, 'teak', 0, 0.15, -d / 2 + 0.14);
  rbox(g, w - 0.5, hh - 1.6, 0.14, 0.06, 'headboard', 0, 1.35, -d / 2 + 0.33);
}

B.sofaLeather = (g) => {
  const w = 6.8, d = 3.0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.06, 0.04, 0.3, 'chrome', sx * (w / 2 - 0.35), 0, sz * (d / 2 - 0.35), 10);
  rbox(g, w, 0.9, d - 0.1, 0.12, 'leather', 0, 0.3, 0);
  const cw = (w - 1.3) / 3;
  for (let i = -1; i <= 1; i++) {
    rbox(g, cw - 0.06, 0.45, d - 0.95, 0.14, 'leather', i * cw, 1.15, 0.3);
    const back = rbox(g, cw - 0.06, 1.25, 0.6, 0.2, 'leather', i * cw, 1.3, -d / 2 + 0.72);
    back.rotation.x = -0.14;
  }
  rbox(g, w, 1.65, 0.45, 0.15, 'leather', 0, 1.15, -d / 2 + 0.23);
  for (const sx of [-1, 1]) rbox(g, 0.62, 1.15, d, 0.2, 'leather', sx * (w / 2 - 0.31), 1.1, 0);
};

B.sofaWood = (g) => {
  const w = 6.2, d = 2.7, hw = w / 2 - 0.22, hd = d / 2 - 0.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cabriole(g, sx * hw, sz * hd, 1.2, sx, sz);
  box(g, w - 0.1, 0.25, d - 0.15, 'teak', 0, 1.02, 0);
  rbox(g, w - 0.85, 0.34, d - 0.55, 0.12, 'fabricGrey', 0, 1.27, 0.12);
  const arch = new THREE.Shape();
  arch.moveTo(-hw + 0.05, 1.3); arch.lineTo(hw - 0.05, 1.3); arch.lineTo(hw - 0.05, 2.0);
  arch.quadraticCurveTo(0, 3.72, -hw + 0.05, 2.0); arch.closePath();
  add(g, new THREE.ExtrudeGeometry(arch, { depth: 0.1, bevelEnabled: false }), 'sofaPattern', 0, 0, -hd - 0.02);
  tube(g, [[-hw, 2.0, -hd], [-hw * 0.6, 2.55, -hd - 0.05], [0, 2.9, -hd - 0.08], [hw * 0.6, 2.55, -hd - 0.05], [hw, 2.0, -hd]], 0.085, 'teak');
  for (const sx of [-1, 1]) {
    tube(g, [[sx * hw, 2.05, -hd], [sx * (hw + 0.05), 2.05, 0], [sx * (hw + 0.02), 2.0, hd - 0.1], [sx * hw, 1.2, hd]], 0.07, 'teak');
    box(g, 0.1, 0.72, d - 0.6, 'sofaPattern', sx * hw, 1.28, -0.05);
    cyl(g, 0.05, 0.05, 1.0, 'teak', sx * hw, 1.1, -hd, 8);
  }
};

B.chairWood = (g) => {
  const r = 1.0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cabriole(g, sx * 0.85, sz * 0.85, 1.1, sx, sz);
  box(g, 1.95, 0.2, 1.95, 'teak', 0, 1.0, 0);
  rbox(g, 1.75, 0.34, 1.7, 0.14, 'fabricGrey', 0, 1.2, 0.1);
  const barrel = add(g, new THREE.CylinderGeometry(r, r * 0.97, 1.15, 28, 1, true, Math.PI * 0.45, Math.PI * 1.1), 'barrelPattern', 0, 1.3 + 0.575, 0);
  barrel.castShadow = true;
  const rim = new THREE.Group(); rim.rotation.y = -0.05 * Math.PI; rim.position.y = 2.47; g.add(rim);
  const t = add(rim, new THREE.TorusGeometry(r, 0.07, 8, 36, Math.PI * 1.1), 'teak', 0, 0, 0);
  t.rotation.x = -Math.PI / 2;
};

B.partyBox = (g) => {
  const w = 1.35, d = 1.5, h = 3.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.2, 0.1, 0.2, 'blackPlastic', sx * 0.5, 0, sz * 0.55);
  rbox(g, w, h - 0.1, d, 0.12, 'blackPlastic', 0, 0.1, 0);
  box(g, w - 0.12, h - 0.75, 0.02, 'grill', 0, 0.3, d / 2 + 0.005);
  for (const [y, r] of [[0.95, 0.46], [2.0, 0.46], [2.78, 0.17]]) {
    const cone = add(g, new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.05, 32), 'blackPlastic', 0, y, d / 2 + 0.03);
    cone.rotation.x = Math.PI / 2;
    const ring = add(g, new THREE.TorusGeometry(r, 0.035, 8, 40), 'led', 0, y, d / 2 + 0.05);
    ring.castShadow = false;
  }
  box(g, 0.3, 0.1, 0.02, 'orange', 0, h - 0.32, d / 2 + 0.01);
  box(g, w * 0.55, 0.1, 0.28, 'blackPlastic', 0, h + 0.12, 0);
  for (const sx of [-1, 1]) box(g, 0.1, 0.14, 0.28, 'blackPlastic', sx * w * 0.24, h - 0.02, 0);
};

B.micStand = (g) => {
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3 + 0.5, leg = cyl(g, 0.025, 0.025, 1.05, 'blackPlastic', Math.sin(a) * 0.32, 0.02, Math.cos(a) * 0.32, 6);
    leg.rotation.set(-Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
  }
  cyl(g, 0.035, 0.035, 3.5, 'blackPlastic', 0, 0.7, 0, 8);
  tube(g, [[0, 4.15, 0], [0, 4.6, 0.35], [0, 4.95, 0.75]], 0.025, 'blackPlastic');
  const mic = new THREE.Group(); mic.position.set(0, 4.95, 0.75); mic.rotation.x = 1.05; g.add(mic);
  cyl(mic, 0.055, 0.04, 0.55, 'blackPlastic', 0, -0.3, 0, 12);
  add(mic, new THREE.SphereGeometry(0.1, 16, 12), 'chrome', 0, 0.3, 0);
};

B.fan = (g) => {
  cyl(g, 0.62, 0.66, 0.12, 'whitePlastic', 0, 0, 0, 32);
  cyl(g, 0.05, 0.06, 3.25, 'whitePlastic', 0, 0.12, 0, 12);
  const head = new THREE.Group(); head.position.set(0, 3.55, 0); g.add(head);
  const motor = add(head, new THREE.CylinderGeometry(0.2, 0.24, 0.5, 20), 'whitePlastic', 0, 0, -0.2); motor.rotation.x = Math.PI / 2;
  for (const z of [0.12, 0.38]) add(head, new THREE.TorusGeometry(0.68, 0.015, 6, 48), 'chrome', 0, 0, z);
  for (let k = 0; k < 12; k++) {
    const a = k * Math.PI / 6, s = add(head, new THREE.CylinderGeometry(0.008, 0.008, 0.68, 4), 'chrome', Math.cos(a) * 0.34, Math.sin(a) * 0.34, 0.38);
    s.rotation.z = a + Math.PI / 2;
  }
  const blades = new THREE.Group(); blades.position.z = 0.25; blades.userData.spin = 9; head.add(blades);
  for (let k = 0; k < 3; k++) {
    const b = add(blades, new THREE.SphereGeometry(0.3, 14, 8), 'fanBlade', 0, 0, 0);
    b.scale.set(1, 0.42, 0.06); b.position.set(Math.cos(k * 2.094) * 0.34, Math.sin(k * 2.094) * 0.34, 0); b.rotation.z = k * 2.094;
  }
  add(blades, new THREE.SphereGeometry(0.1, 12, 8), 'whitePlastic', 0, 0, 0.02);
};

B.plasticChair = (g) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = cyl(g, 0.07, 0.09, 1.5, 'whitePlastic', sx * 0.66, 0, sz * 0.6, 10);
    leg.rotation.set(-sz * 0.07, 0, sx * 0.07);
  }
  rbox(g, 1.55, 0.1, 1.45, 0.05, 'whitePlastic', 0, 1.45, 0.05);
  const back = new THREE.Group(); back.position.set(0, 1.5, -0.66); back.rotation.x = -0.18; g.add(back);
  for (const y of [0.3, 0.62, 0.94, 1.22]) rbox(back, 1.45, 0.16, 0.08, 0.04, 'whitePlastic', 0, y, 0);
  for (const sx of [-1, 1]) {
    box(back, 0.1, 1.35, 0.1, 'whitePlastic', sx * 0.7, 0, 0);
    tube(g, [[sx * 0.74, 2.45, -0.72], [sx * 0.8, 2.25, -0.1], [sx * 0.78, 2.1, 0.45], [sx * 0.7, 1.5, 0.62]], 0.055, 'whitePlastic');
  }
};

function picture(g, w, h, y, v) {
  box(g, w, h, 0.1, 'frameDark', 0, y - h / 2, 0);
  box(g, w - 0.14, h - 0.14, 0.02, 'mat', 0, y - h / 2 + 0.07, 0.05);
  box(g, w - 0.4, h - 0.4, 0.01, photoMat(v), 0, y - h / 2 + 0.2, 0.06);
}
B.frame = (g, it) => picture(g, 1.4, 1.9, 5.2, it.v || 0);
B.frameWide = (g, it) => picture(g, 2.4, 1.6, 5.4, it.v || 0);

B.geyser = (g) => {
  const tank = add(g, new THREE.CylinderGeometry(0.42, 0.42, 1.2, 24), 'whitePlastic', 0, 6.4, 0.05);
  tank.rotation.z = Math.PI / 2;
  box(g, 0.25, 0.08, 0.05, 'blackPlastic', 0.3, 6.25, 0.46);
  cyl(g, 0.03, 0.03, 1.4, 'chrome', -0.35, 4.9, -0.2, 6);
  cyl(g, 0.03, 0.03, 1.4, 'chrome', 0.35, 4.9, -0.2, 6);
};

B.boxStack = (g, it) => {
  const R = rng(hash(it.id || 'b'));
  let y = 0;
  for (const [w, h, d] of [[2.0, 1.1, 1.5], [1.7, 0.85, 1.3], [1.3, 0.65, 1.1]]) {
    const b = box(g, w, h, d, 'cardboard', (R() - 0.5) * 0.2, y, (R() - 0.5) * 0.15);
    b.rotation.y = (R() - 0.5) * 0.12;
    box(g, 0.25, 0.01, d + 0.01, 'tape', b.position.x, y + h, b.position.z).rotation.y = b.rotation.y;
    y += h;
  }
};

B.rack = (g, it) => {
  const w = 3.0, d = 1.25, h = 6.5, R = rng(hash(it.id || 'r'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.12, h, 0.12, 'steel', sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06));
  for (const y of [0.3, 1.8, 3.3, 4.8, 6.3]) box(g, w, 0.05, d, 'steel', 0, y, 0);
  for (const y of [0.35, 1.85, 3.35, 4.85]) {
    let x = -w / 2 + 0.1;
    while (x < w / 2 - 0.7) {
      const bw = 0.6 + R() * 0.7, bh = 0.5 + R() * 0.8, kind = R();
      if (x + bw > w / 2 - 0.05) break;
      if (kind < 0.62) box(g, bw, bh, d - 0.2, 'cardboard', x + bw / 2, y, 0);
      else if (kind < 0.82) rbox(g, bw, 0.45, d - 0.25, 0.12, R() > 0.5 ? 'blanketBlue' : 'blanket', x + bw / 2, y, 0);
      else rbox(g, bw, Math.min(bh + 0.3, 1.4), d - 0.3, 0.06, 'suitcase', x + bw / 2, y, 0);
      x += bw + 0.08;
    }
  }
};

function counterBase(g, w) {
  box(g, w, 0.33, 1.7, 'plinth', 0, 0, -0.1);
  box(g, w, 2.4, 1.92, 'cabinet', 0, 0.33, -0.04);
  const n = Math.max(1, Math.round(w / 1.5));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    if (i) box(g, 0.02, 2.3, 0.01, 'plinth', -w / 2 + i * (w / n), 0.38, 0.93);
    box(g, 0.45, 0.05, 0.05, 'chrome', x, 2.35, 0.95);
  }
  box(g, w, 0.1, 2.0, 'granite', 0, 2.73, 0);
  box(g, w, 0.3, 0.06, 'granite', 0, 2.83, -0.97);
}
B.counter = (g, it) => counterBase(g, it.w ?? 2);
B.counterSink = (g) => {
  counterBase(g, 3);
  box(g, 2.0, 0.02, 1.35, 'stainless', 0, 2.83, 0.05);
  box(g, 1.7, 0.01, 1.1, 'blackPlastic', 0, 2.845, 0.05);
  cyl(g, 0.05, 0.05, 0.9, 'chrome', 0, 2.83, -0.72, 10);
  tube(g, [[0, 3.7, -0.72], [0, 3.85, -0.5], [0, 3.55, -0.25]], 0.035, 'chrome');
};
B.counterStove = (g) => {
  counterBase(g, 2.5);
  box(g, 2.2, 0.06, 1.5, 'blackPlastic', 0, 2.83, 0.05);
  for (const [x, z] of [[-0.62, 0.35], [0.62, 0.35], [0, -0.3]]) {
    const ring = add(g, new THREE.TorusGeometry(0.2, 0.04, 8, 24), 'brass', x, 2.92, z); ring.rotation.x = Math.PI / 2;
  }
  const chimney = [box(g, 2.5, 0.35, 1.6, 'stainless', 0, 6.4, -0.2), add(g, new THREE.CylinderGeometry(0.45, 1.2, 0.8, 4, 1), 'stainless', 0, 6.75 + 0.4, -0.4), box(g, 0.8, 2.0, 0.7, 'stainless', 0, 7.15, -0.6)];
  chimney[1].rotation.y = Math.PI / 4; chimney[1].scale.set(1, 1, 0.55);
  for (const m of chimney) m.userData.high = true;
};

B.fridge = (g) => {
  rbox(g, 2.3, 5.7, 2.2, 0.08, 'stainless', 0, 0.1, -0.05);
  box(g, 2.28, 0.03, 0.02, 'blackPlastic', 0, 4.25, 1.06);
  for (const [y, h] of [[1.2, 2.6], [4.5, 1.0]]) box(g, 0.08, h, 0.12, 'chrome', 0.95, y, 1.1);
  box(g, 2.1, 0.1, 2.0, 'blackPlastic', 0, 0, 0);
};

B.diningTable = (g) => {
  rbox(g, 4.5, 0.14, 3.0, 0.05, 'teak', 0, 2.36, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(g, 0.1, 0.08, 2.36, 'teak', sx * 1.95, 0, sz * 1.2, 12);
  box(g, 3.8, 0.25, 0.08, 'teak', 0, 2.1, 1.2); box(g, 3.8, 0.25, 0.08, 'teak', 0, 2.1, -1.2);
};

B.coffeeTable = (g) => {
  const top = add(g, new THREE.CylinderGeometry(1, 1, 0.12, 40), 'teak', 0, 1.34, 0); top.scale.set(2, 1, 1);
  const shelf = add(g, new THREE.CylinderGeometry(0.8, 0.8, 0.06, 40), 'teak', 0, 0.45, 0); shelf.scale.set(2, 1, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cabriole(g, sx * 1.45, sz * 0.55, 1.28, sx, sz);
  add(g, new THREE.SphereGeometry(0.16, 16, 12), 'ceramic', 0.8, 1.56, 0.1);
  box(g, 0.8, 0.12, 0.55, 'bedIndigo', -0.6, 1.4, 0);
};

B.rug = (g, it) => box(g, it.w ?? 8, 0.03, it.d ?? 6, 'rug', 0, 0.005, 0).castShadow = false;

B.tvUnit = (g) => {
  box(g, 6, 0.25, 1.1, 'plinth', 0, 0, 0);
  box(g, 6, 1.35, 1.3, 'walnut', 0, 0.25, 0);
  for (const x of [-1.5, 0, 1.5]) box(g, 0.02, 1.2, 0.01, 'plinth', x, 0.32, 0.655);
  box(g, 4.05, 2.35, 0.12, 'blackPlastic', 0, 3.1, -0.5);
  box(g, 3.9, 2.2, 0.01, 'screen', 0, 3.175, -0.435);
};

B.wc = (g) => {
  rbox(g, 1.3, 1.25, 0.55, 0.08, 'ceramic', 0, 1.25, -0.87);
  const bowl = add(g, new THREE.CylinderGeometry(0.58, 0.42, 1.3, 28), 'ceramic', 0, 0.65, 0.1); bowl.scale.set(1, 1, 1.35);
  const seat = add(g, new THREE.CylinderGeometry(0.62, 0.62, 0.08, 28), 'whitePlastic', 0, 1.34, 0.1); seat.scale.set(1, 1, 1.35);
  box(g, 0.25, 0.04, 0.12, 'chrome', 0, 2.5, -0.87);
};

B.basin = (g) => {
  box(g, 1.7, 1.8, 1.3, 'walnut', 0, 0.6, -0.05);
  rbox(g, 1.7, 0.24, 1.4, 0.06, 'ceramic', 0, 2.4, 0);
  box(g, 1.1, 0.02, 0.8, 'chrome', 0, 2.63, 0.08);
  tube(g, [[0, 2.64, -0.55], [0, 3.05, -0.5], [0, 2.95, -0.25]], 0.035, 'chrome');
  box(g, 1.6, 2.2, 0.05, 'mirror', 0, 3.35, -0.68).userData.high = true;
};

B.shower = (g) => {
  box(g, 3, 0.08, 3, 'ceramic', 0, 0, 0);
  box(g, 0.04, 6.4, 3, 'glass', 1.48, 0.08, 0).castShadow = false;
  box(g, 1.6, 6.4, 0.04, 'glass', 0.7, 0.08, 1.48).castShadow = false;
  box(g, 0.05, 6.4, 0.05, 'chrome', 1.48, 0.08, 1.48);
  cyl(g, 0.03, 0.03, 4.0, 'chrome', -1.35, 2.8, -1.35, 8);
  tube(g, [[-1.35, 6.8, -1.35], [-1.1, 6.95, -1.1], [-0.8, 6.9, -0.8]], 0.03, 'chrome');
  const head = add(g, new THREE.CylinderGeometry(0.3, 0.3, 0.04, 24), 'chrome', -0.7, 6.85, -0.7); head.castShadow = false;
  cyl(g, 0.12, 0.12, 0.02, 'chrome', 0, 0.08, 0, 16);
};

B.washer = (g) => {
  rbox(g, 2.0, 2.75, 2.0, 0.08, 'whitePlastic', 0, 0.05, 0);
  const door = add(g, new THREE.TorusGeometry(0.55, 0.09, 12, 32), 'chrome', 0, 1.25, 1.02); door.castShadow = false;
  const glassDoor = add(g, new THREE.CylinderGeometry(0.52, 0.52, 0.04, 32), 'blackPlastic', 0, 1.25, 1.0); glassDoor.rotation.x = Math.PI / 2;
  box(g, 1.9, 0.35, 0.02, 'blackPlastic', 0, 2.3, 1.0);
};

B.shoeRack = (g) => {
  box(g, 2.5, 3.0, 1.1, 'teak', 0, 0, 0);
  for (let i = 0; i < 9; i++) box(g, 1.1, 0.04, 0.02, 'walnut', -0.6, 0.4 + i * 0.28, 0.56);
  for (let i = 0; i < 9; i++) box(g, 1.1, 0.04, 0.02, 'walnut', 0.6, 0.4 + i * 0.28, 0.56);
};

B.plant = (g, it) => {
  cyl(g, 0.55, 0.4, 1.1, 'pot', 0, 0, 0, 24);
  cyl(g, 0.5, 0.5, 0.05, 'soil', 0, 1.02, 0, 20);
  const R = rng(hash(it.id || 'p'));
  for (let k = 0; k < 9; k++) {
    const a = k * 0.7 + R(), lean = 0.25 + R() * 0.45, len = 2.2 + R() * 1.1;
    const frond = new THREE.Group(); frond.position.y = 1.05; frond.rotation.set(Math.cos(a) * lean, 0, Math.sin(a) * lean); g.add(frond);
    cyl(frond, 0.02, 0.03, len, 'leaf', 0, 0, 0, 5);
    for (let i = 3; i < 12; i++) for (const s of [-1, 1]) {
      const l = add(frond, new THREE.PlaneGeometry(0.1, 0.62), 'leaf', s * 0.18, len * i / 12, 0);
      l.rotation.set(0.3, 0, s * 1.05); l.castShadow = true;
    }
  }
};

B.jaali = (g, it) => {
  const w = it.w ?? 4;
  box(g, w, 7, 0.14, 'jaali', 0, 0, 0).castShadow = true;
  for (const sx of [-1, 1]) box(g, 0.16, 7, 0.22, 'teak', sx * (w / 2 - 0.08), 0, 0);
  box(g, w, 0.16, 0.22, 'teak', 0, 6.84, 0); box(g, w, 0.16, 0.22, 'teak', 0, 0, 0);
};

const HIGH = new Set(['frame', 'frameWide', 'geyser']); // wall-mounted: hidden in the cut plan
export function buildItem(it) {
  const g = new THREE.Group();
  B[it.type](g, it);
  if (HIGH.has(it.type)) g.traverse(o => { if (o.isMesh) o.userData.high = true; });
  g.position.set(it.x, 0, it.z);
  g.rotation.y = it.rot * Math.PI / 180;
  g.userData.itemId = it.id;
  g.traverse(o => { o.userData.itemId = it.id; });
  return g;
}

// Animation hook: PartyBox LED colour cycle and fan blades (spinners collected by the caller).
export function tickModels(t, spinners) {
  if (matCache.led) matCache.led.emissive.setHSL((t * 0.00012) % 1, 0.95, 0.55);
  for (const o of spinners) o.rotation.z = t * 0.001 * o.userData.spin;
}
