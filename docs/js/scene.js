// ===========================================================================
// the house as a scene. rooms and outdoor spaces sit edge to edge on one
// grid: a room at at = [x, y] covers tiles x*9..x*9+9 along i and y*9.. along
// j. a space only knows its neighbours through here: which of its edges are
// outside walls, low walls, fences or open, and where the doorways are.
//
// drawing a space: the base (floor, walls, rugs, things on the walls) is
// drawn once; then the things that stand, back to front, with the bot.
// the page caches each piece; the tools draw it all in one go.
// ===========================================================================
(function (HS) {
'use strict';
const { streamOf } = HS.P;
const { ROOM, drawShell, drawBulb } = HS.W;
const { drawThing, depthOf } = HS.K;

const kindOf = (kinds, item) => kinds[item.kind] || null;
const itemsIn = (house, roomId) => (house.items || []).filter((it) => it.room === roomId);
const layerOf = (kind) => kind.place === 'rug' ? 'rug' : kind.place === 'wall' ? 'wall' : 'stand';
const key = (x, y) => x + ',' + y;
function cells(house) { const m = new Map(); for (const r of house.rooms) m.set(key(r.at[0], r.at[1]), r); return m; }

// what each edge of a space is. behind it (ne: the space at y-1, nw: at x-1): nothing = an outside wall
// (a fence, outdoors); another space = a low wall with a doorway (nothing, between two outdoor spaces).
// in front (se: x+1, sw: y+1): nothing = the card's cut edge; another space = joined.
function edgesOf(house, rm, m = cells(house)) {
  const [x, y] = rm.at, ne = m.get(key(x, y - 1)), nw = m.get(key(x - 1, y));
  const back = (o) => !o ? (rm.outdoor ? 'fence' : 'wall') : (rm.outdoor && o.outdoor ? 'none' : 'low');
  // a low wall between a room and a garden is the room's wall, cut down: it takes the room's paint
  const paint = (o) => (rm.outdoor ? o && o.walls : rm.walls) || { ink: 'coral', tone: 0.22 };
  return { ne: back(ne), nw: back(nw), se: m.has(key(x + 1, y)) ? 'join' : 'cut', sw: m.has(key(x, y + 1)) ? 'join' : 'cut', paint: { ne: paint(ne), nw: paint(nw) }, out: { ne: !!(ne && ne.outdoor), nw: !!(nw && nw.outdoor) } };
}
// the tiles just inside each doorway (a room's own tiles), which nothing may block
function portals(house, rm, m = cells(house)) {
  const [x, y] = rm.at, n = ROOM, mid = 4, out = [];
  if (m.has(key(x, y - 1))) out.push([mid, 0], [mid, 1]);
  if (m.has(key(x - 1, y))) out.push([0, mid], [1, mid]);
  if (m.has(key(x + 1, y))) out.push([n - 1, mid], [n - 2, mid]);
  if (m.has(key(x, y + 1))) out.push([mid, n - 1], [mid, n - 2]);
  if (rm.door) { const p = Math.floor(rm.door.pos); out.push(...(rm.door.side === 'nw' ? [[0, p], [1, p]] : [[p, 0], [p, 1]])); }
  return out;
}
// can the bot roll from global tile (I, J) to the tile next to it? within a space, yes; between two, only through the doorway
function crossable(m, I, J, I2, J2) {
  const a = m.get(key(Math.floor(I / ROOM), Math.floor(J / ROOM))), b = m.get(key(Math.floor(I2 / ROOM), Math.floor(J2 / ROOM)));
  if (!a || !b) return false; if (a === b) return true;
  if (a.outdoor && b.outdoor) return true;
  const along = I === I2 ? I : J; return ((along % ROOM) + ROOM) % ROOM === 4;
}

// the base: the card, floor, walls, rugs (under the sun patch), and everything hung on the walls
function drawBase(H, house, rm, items, kinds, images, o = {}) {
  const R = streamOf('room', rm.id), E = edgesOf(house, rm);
  const flat = items.filter((it) => kindOf(kinds, it) && layerOf(kindOf(kinds, it)) === 'rug');
  const hung = items.filter((it) => kindOf(kinds, it) && layerOf(kindOf(kinds, it)) === 'wall');
  drawShell(H, R, rm, { edges: E, onFloor: () => { for (const it of flat) if (!o.skip || !o.skip(it)) drawThing(H, streamOf('item', it.id), kindOf(kinds, it), it, images); } });
  for (const it of hung) if (!o.skip || !o.skip(it)) drawThing(H, streamOf('item', it.id), kindOf(kinds, it), it, images);
  drawBulb(H, R, rm, o.lit ?? true, E);
}
// the things that stand, back to front; extras = [{key, draw(H)}] (the bot) sort in among them
function drawStanding(H, rm, items, kinds, images, extras = [], o = {}) {
  const list = items.filter((it) => kindOf(kinds, it) && layerOf(kindOf(kinds, it)) === 'stand' && (!o.skip || !o.skip(it)))
    .map((it) => ({ key: depthOf(kindOf(kinds, it), it), draw: (HH) => drawThing(HH, streamOf('item', it.id), kindOf(kinds, it), it, images) }));
  for (const x of list.concat(extras).sort((a, b) => a.key - b.key)) x.draw(H);
}
function drawRoom(H, house, rm, items, kinds, images, extras, o) { drawBase(H, house, rm, items, kinds, images, o); drawStanding(H, rm, items, kinds, images, extras, o); }
// where a new space can go: next to the others, with a space (or the edge of the plot) behind each of its back
// edges, so the outside walls stay where they are and only ever face out. compact first.
function buildable(rooms, near) {
  const has = (x, y) => rooms.some((r) => r.at[0] === x && r.at[1] === y), out = [], nr = near && rooms.find((r) => r.id === near);
  for (const r of rooms) for (const [x, y] of [[r.at[0] + 1, r.at[1]], [r.at[0], r.at[1] + 1], [r.at[0] - 1, r.at[1]], [r.at[0], r.at[1] - 1]]) {
    if (x < 0 || y < 0 || has(x, y) || out.some((c) => c[0] === x && c[1] === y)) continue;
    if ((x > 0 && !has(x - 1, y)) || (y > 0 && !has(x, y - 1))) continue;
    if (nr && Math.abs(nr.at[0] - x) + Math.abs(nr.at[1] - y) !== 1) continue;
    out.push([x, y]);
  }
  return out.sort((a, b) => Math.max(a[0], a[1]) - Math.max(b[0], b[1]) || a[0] + a[1] - b[0] - b[1] || b[0] - a[0]);
}
// spaces back to front, the order they must be drawn in
const backToFront = (rooms) => rooms.slice().sort((a, b) => a.at[0] + a.at[1] - b.at[0] - b.at[1] || a.at[0] - b.at[0]);

HS.S = { kindOf, itemsIn, layerOf, key, cells, edgesOf, portals, crossable, buildable, drawBase, drawStanding, drawRoom, backToFront };
})(globalThis.HOUSE || (globalThis.HOUSE = {}));
