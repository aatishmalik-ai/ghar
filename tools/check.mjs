// Self-check for plan geometry + design data. Run: node tools/check.mjs
import assert from 'node:assert/strict';
import * as P from '../src/plan.js';
import { DESIGNS } from '../src/designs.js';
import { CATALOG } from '../src/models.js';

const clone = o => JSON.parse(JSON.stringify(o));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);
const d1 = clone(DESIGNS[0]);
const walls = P.deriveWalls(d1);
const find = (axis, at, a, b) => walls.find(w => w.axis === axis && w.at === at && w.a === a && w.b === b);

// wall classification
assert.equal(find('h', 15, 16, 32).kind, 'open', 'hall|dining share a zone → no wall');
assert.equal(find('v', 16, 15, 22).kind, 'int', 'bedroom|dining partition');
const north = walls.filter(w => w.axis === 'h' && w.at === 0);
assert.ok(north.every(w => w.kind === 'ext' && w.off === P.T_EXT / 2), 'north facade sits inside the plot');
// clear sizes: bedroom = 16 wide minus 9" outer + half 4.5" partition
const bed = d1.rooms.find(r => r.id === 'bed');
near(P.clearRect(walls, bed).w, 16 - 0.75 - 0.1875, 'bedroom clear width');
near(P.clearRect(walls, bed).d, 17 - 0.1875 - 0.75, 'bedroom clear depth');
// outside bath: shared plot-line wall belongs to the house, not the bath
const d2 = clone(DESIGNS[1]), w2 = P.deriveWalls(d2);
const bath2 = d2.rooms.find(r => r.id === 'bath');
near(P.clearRect(w2, bath2).d, 6.5 - 0.75, 'extension bath depth');

// wall moves
assert.equal(P.moveLine(d1, 'h', 0, 10, 32, 1), 'locked', 'plot boundary is locked');
assert.equal(P.moveLine(d1, 'v', 16, 15, 32, 1), true, 'move bedroom/kitchen wall east');
near(bed.w, 17, 'bedroom grew'); near(d1.rooms.find(r => r.id === 'kitchen').x, 17, 'kitchen moved');
near(d1.rooms.find(r => r.id === 'kitchen').w, 15, 'kitchen shrank');
const before = JSON.stringify(d1.rooms);
assert.equal(P.moveLine(d1, 'v', 17, 15, 32, 20), 'small', 'cannot crush a room');
assert.equal(JSON.stringify(d1.rooms), before, 'failed move leaves rooms untouched');
const store = d1.openings.find(o => o.axis === 'v' && o.at === 10 && o.type === 'door' && !o.bath);
assert.equal(P.moveLine(d1, 'v', 10, 0, 15, -1), true); near(store.at, 9, 'door rides along with its wall');
// shrinking the bedroom must not strand its door on the open hall|dining line
const d1b = clone(DESIGNS[0]), bedDoor = d1b.openings.find(o => o.type === 'door' && o.axis === 'h' && o.at === 15 && !o.bath);
assert.equal(P.moveLine(d1b, 'v', 16, 15, 32, -3), 'opening', 'blocked: door would lose its wall');
near(bedDoor.pos, 13.5, 'blocked move leaves the door alone');
assert.equal(P.moveLine(d1b, 'v', 16, 15, 32, -2), true, '2 ft still fits the door');
near(bedDoor.pos, 12.3, 'door slid west to stay on the hall|bedroom wall');
assert.ok([...P.assignOpenings(d1b, P.deriveWalls(d1b)).values()].flat().some(x => x.o === bedDoor), 'door still on a wall');

// access rules: shipped designs are clean; a too-wide bath door and a missing bedroom door are caught
for (const d of DESIGNS) {
  const dd = clone(d), wl = P.deriveWalls(dd);
  assert.deepEqual(P.openingProblems(dd, wl), [], `${d.id}: door swings clear`);
  assert.deepEqual(P.unreachableRooms(dd, wl).map(r => r.id), [], `${d.id}: every room reachable`);
}
const d2b = clone(DESIGNS[1]), bathDoor = d2b.openings.find(o => o.bath);
Object.assign(bathDoor, { pos: 17.9, w: 2.5 });
assert.equal(P.openingProblems(d2b, P.deriveWalls(d2b)).length, 1, 'bath door sweeping into the wall is flagged');
d2b.openings = d2b.openings.filter(o => !(o.type === 'door' && o.axis === 'h' && o.at === 17 && o.pos === 17.7));
assert.deepEqual(P.unreachableRooms(d2b, P.deriveWalls(d2b)).map(r => r.id).sort(), ['bath', 'bed'], 'no bedroom door → bedroom and its bath unreachable');

// doorway approach: furniture parked on the non-swing side of a door is flagged
const d1c = clone(DESIGNS[0]);
d1c.items = [{ id: 'tv', type: 'tvUnit', x: 10.84, z: 4.0, rot: 90 }];
assert.deepEqual(P.findClashes(d1c, P.deriveWalls(d1c), CATALOG).get('tv'), ['blocks a doorway'], 'console in front of the store door');
// almirah recess is not counted as bath floor
const d1a = clone(DESIGNS[0]), wa = P.deriveWalls(d1a), bathA = P.clearRect(wa, d1a.rooms.find(r => r.id === 'bath'), d1a).area;
assert.ok(bathA > 57 && bathA < 58, `bath usable area ${bathA.toFixed(1)} excludes the recess`);

// footprint maths
assert.ok(P.overlaps(P.obb(0, 0, 2, 2, 45), P.obb(1.6, 0, 1, 1, 0)), 'rotated square reaches over');
assert.ok(!P.overlaps(P.obb(0, 0, 2, 2, 0), P.obb(2.05, 0, 2, 2, 0)), 'touching is not a clash');

// every shipped design must be clash-free
for (const d of DESIGNS) {
  const dd = clone(d);
  dd.items.forEach((it, i) => { it.id = it.type + '-' + i; });
  const wl = P.deriveWalls(dd);
  const cl = P.findClashes(dd, wl, CATALOG);
  const orphans = dd.openings.filter((o, i) => ![...P.assignOpenings(dd, wl).values()].flat().some(x => x.idx === i));
  for (const [id, why] of cl) console.log(`  ${d.id}: ${id} (${dd.items.find(i => i.id === id).x},${dd.items.find(i => i.id === id).z}) → ${why.join('; ')}`);
  assert.equal(orphans.length, 0, `${d.id}: openings not on any wall: ${JSON.stringify(orphans)}`);
  assert.equal(cl.size, 0, `${d.id} has clashes`);
}
console.log('plan checks passed');
