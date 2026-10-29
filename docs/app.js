'use strict';
// The house, live: every room and everything in it, the bot rolling round acting out what it did since you last
// looked, and its money. The drawing is docs/js (shared with the tools); this file is the camera, the bot's day and the panel.
(() => {
const HS = globalThis.HOUSE, { P, W, K, S, B } = HS;
const $ = (q, el = document) => el.querySelector(q);
const view = $('#view'), stage = $('#stage'), ctx = stage.getContext('2d');
const ZOOMS = [0.25, 0.33, 0.42, 0.5, 0.56, 0.62, 0.75, 0.875, 1, 1.25, 1.5, 2, 2.5, 3];
const MAX_RATIO = 3;                    // caches are never printed finer than this; closer up, the dots just get bigger
const SPEED = 2.2;                      // tiles a second
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE = matchMedia('(pointer: coarse)').matches; // a finger, not a mouse
const SEEN_KEY = 'dither-house.seen';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* fine */ } } };

let house = null, kinds = {}, kindsV = '', images = {}, dpr = 1, vw = 0, vh = 0, zi = 8, lastT = 0, clock = 0;
const rooms = new Map();                 // room id -> {rm, ox, oy, b, items, base, ver}
const sprites = new Map();               // item id -> {ratio, key, cv, x0, y0}
const hidden = new Set();                // items and rooms the bot hasn't acted out yet
const appearing = new Map();             // item or room id -> when its dither-in started
const cam = { x: 0, y: 0, z: 1 };
let fitZi = 0, tween = null, userCam = false, hover = null, found = new Set(), receiptFor = null;

// ---------------- data ----------------
const num = (id) => Number(String(id || '').replace(/^\D+/, '')) || 0;
const kindOf = (it) => kinds[it.kind];
async function fetchJSON(f) { const r = await fetch(`${f}?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); }
let shownHouse = { rooms: [] }, cellMap = new Map(), blocked = null;
function index() {
  const keep = new Map(rooms);
  rooms.clear();
  shownHouse = { rooms: house.rooms.filter((r) => !hidden.has(r.id)) }; cellMap = S.cells(shownHouse); blocked = null;
  for (const rm of house.rooms) {
    const [ox, oy] = W.roomOrigin(rm.at), items = S.itemsIn(house, rm.id).filter((it) => kindOf(it));
    const old = keep.get(rm.id), ver = JSON.stringify(rm) + JSON.stringify(S.edgesOf(shownHouse, rm)) + items.filter((it) => S.layerOf(kindOf(it)) !== 'stand').map((it) => it.id + JSON.stringify(it.at) + (hidden.has(it.id) ? 'h' : '') + (images[it.image] ? 'i' : '')).join('|');
    rooms.set(rm.id, { rm, ox, oy, b: W.roomBounds(rm), items, base: old && old.ver === ver ? old.base : null, ver });
  }
}
function loadImages() {
  for (const it of house.items) if (it.image && !(it.image in images)) {
    images[it.image] = null; const im = new Image(); im.decoding = 'async';
    im.onload = () => { images[it.image] = im; sprites.delete(it.id); index(); };
    im.src = it.image;
  }
}

// ---------------- printing ----------------
// caches are printed at whole device pixels per dot (1, 2 or 3), then shrunk smoothly to the zoom, so the screens never beat
const ratioNow = () => { const z = cam.z * dpr; return z <= 1 ? 1 : Math.min(MAX_RATIO, Math.ceil(z - 0.01)); };
function printed(w, h, ratio, x0, y0, draw) {
  const cv = HS.env.makeCanvas(Math.max(1, Math.ceil(w * ratio)), Math.max(1, Math.ceil(h * ratio))), c = cv.getContext('2d');
  c.imageSmoothingEnabled = false; c.setTransform(ratio, 0, 0, ratio, -x0 * ratio, -y0 * ratio); draw(c); return cv;
}
function baseOf(R) {
  const ratio = ratioNow();
  if (!R.base || R.base.ratio !== ratio) {
    const b = R.b, skip = (it) => hidden.has(it.id) || appearing.has(it.id);
    R.base = { ratio, cv: printed(b.x1 - b.x0, b.y1 - b.y0, ratio, b.x0, b.y0, (c) => S.drawBase(P.mkHand(c, { seed: 1 }), shownHouse, R.rm, R.items, kinds, images, { skip })) };
  }
  return R.base;
}
function spriteOf(it) {
  const ratio = ratioNow(), key = ratio + JSON.stringify(it.at) + (images[it.image] ? 'i' : ''), have = sprites.get(it.id);
  if (have && have.key === key) return have;
  const k = kindOf(it), bx = K.screenBox(k, it);
  const s = { ratio, key, x0: bx.x0, y0: bx.y0, w: bx.x1 - bx.x0, h: bx.y1 - bx.y0, hi: null };
  s.cv = printed(s.w, s.h, ratio, bx.x0, bx.y0, (c) => K.drawThing(P.mkHand(c, { seed: 1 }), P.streamOf('item', it.id), k, it, images));
  sprites.set(it.id, s); return s;
}
// a highlighter outline: the sprite's own shape in sun, slightly bigger all round
function hiOf(s) {
  if (s.hi) return s.hi;
  const cv = HS.env.makeCanvas(s.cv.width, s.cv.height), c = cv.getContext('2d');
  c.drawImage(s.cv, 0, 0); c.globalCompositeOperation = 'source-in'; c.fillStyle = '#ffd428'; c.fillRect(0, 0, cv.width, cv.height);
  return (s.hi = cv);
}
// the dither-in: a thing appears dot by dot, in the order of the 8x8 screen
const MASKS = new Map();
function maskPattern(level, ratio) {
  const key = level + '|' + ratio; let p = MASKS.get(key); if (p) return p;
  p = ctx.createPattern(P.ditherTile('black', Math.max(1, Math.min(64, level))), 'repeat');
  if (p.setTransform) p.setTransform(new DOMMatrix().scaleSelf(ratio * P.DP, ratio * P.DP));
  MASKS.set(key, p); return p;
}
let scratch = null;
function dithered(cv, level, ratio) {
  if (level >= 64) return cv;
  if (!scratch || scratch.width < cv.width || scratch.height < cv.height) scratch = HS.env.makeCanvas(Math.max(cv.width, scratch ? scratch.width : 0), Math.max(cv.height, scratch ? scratch.height : 0));
  const c = scratch.getContext('2d'); c.globalCompositeOperation = 'source-over'; c.clearRect(0, 0, scratch.width, scratch.height); c.drawImage(cv, 0, 0);
  c.globalCompositeOperation = 'destination-in'; c.fillStyle = maskPattern(level, ratio); c.fillRect(0, 0, cv.width, cv.height); c.globalCompositeOperation = 'source-over';
  return { cv: scratch, w: cv.width, h: cv.height };
}

// ---------------- the camera ----------------
const zr = () => cam.z * dpr;
const devX = (wx) => (wx - cam.x) * zr() + stage.width / 2, devY = (wy) => (wy - cam.y) * zr() + stage.height / 2;
const toWorld = (px, py) => [(px * dpr - stage.width / 2) / zr() + cam.x, (py * dpr - stage.height / 2) / zr() + cam.y];
function worldBounds(onlyShown) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const R of rooms.values()) { if (onlyShown && hidden.has(R.rm.id)) continue; x0 = Math.min(x0, R.ox + R.b.x0); y0 = Math.min(y0, R.oy + R.b.y0); x1 = Math.max(x1, R.ox + R.b.x1); y1 = Math.max(y1, R.oy + R.b.y1); }
  return { x0, y0, x1, y1 };
}
function fitTo(b, animate) {
  const pad = vw < 600 ? 14 : 40, room = (z) => (b.x1 - b.x0) * z <= vw - pad * 2 && (b.y1 - b.y0) * z <= vh - pad * 2 - (vw < 600 ? 40 : 30);
  let k = 0; for (let n = 0; n < ZOOMS.length - 3; n++) if (room(ZOOMS[n])) k = n;
  fitZi = k; moveTo({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 + 8, zi: k }, animate);
}
// on a phone, a swipe over the whole house scrolls the page; once you've zoomed in, it moves the house instead
const atFit = () => zi <= fitZi;
function touchMode() { stage.style.touchAction = COARSE && atFit() ? 'pan-y' : 'none'; }
function moveTo(to, animate) {
  if (to.zi !== undefined && to.zi !== zi) { zi = to.zi; cam.z = ZOOMS[zi]; forgetOtherSizes(); }
  touchMode();
  if (!animate || REDUCE) { cam.x = to.x; cam.y = to.y; tween = null; return; }
  tween = { x0: cam.x, y0: cam.y, x1: to.x, y1: to.y, t0: clock, d: 0.9 };
}
function forgetOtherSizes() { const r = ratioNow(); for (const [id, sp] of sprites) if (sp.ratio !== r) sprites.delete(id); for (const R of rooms.values()) if (R.base && R.base.ratio !== r) R.base = null; }
function zoomBy(step, px, py) {
  const n = Math.max(0, Math.min(ZOOMS.length - 1, zi + step)); if (n === zi) return;
  const [wx, wy] = px === undefined ? [cam.x, cam.y] : toWorld(px, py);
  const z0 = cam.z; zi = n; cam.z = ZOOMS[n]; tween = null; userCam = true;
  cam.x = wx - (wx - cam.x) * z0 / cam.z; cam.y = wy - (wy - cam.y) * z0 / cam.z;
  forgetOtherSizes(); touchMode();
}
function roomInView(R) { const w = stage.width / zr() / 2, h = stage.height / zr() / 2; return R.ox + R.b.x1 > cam.x - w && R.ox + R.b.x0 < cam.x + w && R.oy + R.b.y1 > cam.y - h && R.oy + R.b.y0 < cam.y + h; }
function follow(R) { if (userCam || !R || roomInView(R) && rooms.size > 1) return; const b = worldBounds(false); fitTo(b, true); }

function resize() {
  const r = view.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
  vw = r.width; vh = r.height; stage.width = Math.round(vw * d); stage.height = Math.round(vh * d);
  if (d !== dpr) { dpr = d; sprites.clear(); for (const R of rooms.values()) R.base = null; }
  if (!userCam && house) fitTo(worldBounds(true), false);
}

// ---------------- the bot's day ----------------
// the bot lives on the house's one grid of tiles (I, J): a room at [x, y] holds tiles x*9.. and y*9..
const N = W.ROOM;
const bot = { I: 1.5, J: 1.5, face: 'se', act: 'idle', u: 0, mood: '', roll: 0, carry: false, queue: [], task: null, on: false };
const roomAt = (I, J) => cellMap.get(S.key(Math.floor(I / N), Math.floor(J / N)));
const botRoom = () => { const rm = roomAt(bot.I, bot.J); return rm && rooms.get(rm.id); };
const global = (rm, i, j) => [rm.at[0] * N + i, rm.at[1] * N + j];
function blockedTiles() {
  if (blocked) return blocked;
  blocked = new Set();
  for (const R of rooms.values()) { if (hidden.has(R.rm.id)) continue; for (const it of R.items) { const k = kindOf(it); if (hidden.has(it.id) || !k || !(k.place === 'floor' || k.place === 'surface' && !it.on || k.place === 'rug' && k.solid)) continue; for (const [i, j] of K.footprint(k, it)) blocked.add(S.key(...global(R.rm, i, j))); } }
  return blocked;
}
const free = (a, b) => roomAt(a + 0.5, b + 0.5) && !blockedTiles().has(S.key(a, b));
function nearestFree(I, J) {
  let best = null, bd = Infinity;
  for (const rm of shownHouse.rooms) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const [a, b] = global(rm, i, j); if (!free(a, b)) continue; const d = Math.hypot(a + 0.5 - I, b + 0.5 - J); if (d < bd) { bd = d; best = [a, b]; } }
  return best;
}
function pathTo(from, to) {
  const s0 = nearestFree(from[0], from[1]), e = nearestFree(to[0], to[1]); if (!s0 || !e) return [];
  const prev = new Map([[S.key(...s0), null]]), q = [s0];
  while (q.length) { const [a, b] = q.shift(); if (a === e[0] && b === e[1]) break; for (const [x, y] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]]) { const k2 = S.key(x, y); if (prev.has(k2) || !free(x, y) || !S.crossable(cellMap, a, b, x, y)) continue; prev.set(k2, [a, b]); q.push([x, y]); } }
  if (!prev.has(S.key(...e))) return [];
  const out = []; let c = e; while (c) { out.unshift([c[0] + 0.5, c[1] + 0.5]); c = prev.get(S.key(...c)); }
  return out;
}
const roomOfItem = (it) => house.rooms.find((r) => r.id === it.room);
// where the bot stands to look at or set down a thing: just in front of it (house tiles)
function frontOf(it) {
  const k = kindOf(it), [w, d] = it.size || k.size, a = it.at, host = it.on && house.items.find((x) => x.id === it.on), rm = roomOfItem(it);
  if (host) return frontOf(host);
  const l = k.place === 'wall' ? (a.face === 'ne' ? [a.i + w / 2, 1.2] : [1.2, a.j + w / 2]) : k.place === 'rug' ? (a.face === 'ne' || a.face === 'sw' ? [a.i + w / 2, a.j + d / 2] : [a.i + d / 2, a.j + w / 2]) : a.face === 'ne' ? [a.i + w / 2, a.j + d + 0.6] : a.face === 'sw' ? [a.i + w / 2, a.j - 0.6] : a.face === 'se' ? [a.i - 0.6, a.j + w / 2] : [a.i + d + 0.6, a.j + w / 2];
  return global(rm, ...l);
}
function centerOf(it) {
  const k = kindOf(it), [w, d] = it.size || k.size, a = it.at, rm = roomOfItem(it);
  return global(rm, ...(k.place === 'wall' ? (a.face === 'ne' ? [a.i + w / 2, 0] : [0, a.j + w / 2]) : a.face === 'ne' || a.face === 'sw' ? [a.i + w / 2, a.j + d / 2] : [a.i + d / 2, a.j + w / 2]));
}
// deliveries come in at the front door
function frontDoor() { const rm = house.rooms[0], d = rm.door; if (!d) return global(rm, 1.5, N - 1.5); const p = Math.floor(d.pos) + 0.5; return global(rm, ...(d.side === 'nw' ? [0.5, p] : [p, 0.5])); }
const faceTo = (di, dj) => Math.abs(di) > Math.abs(dj) ? (di > 0 ? 'se' : 'nw') : (dj > 0 ? 'sw' : 'ne');
function plan(...tasks) { bot.queue.push(...tasks); }
function randomSpot(inRoom) {
  const list = inRoom ? [inRoom] : shownHouse.rooms;
  for (let n = 0; n < 30; n++) { const rm = list[(Math.random() * list.length) | 0], [a, b] = global(rm, (Math.random() * N) | 0, (Math.random() * N) | 0); if (free(a, b)) return [a + 0.5, b + 0.5]; }
  return null;
}
function idle() {
  const R = botRoom(); if (!R) return;
  const hour = new Date().getHours(), bed = house.items.find((it) => /bed|mattress|sleeping/.test(it.kind) && !hidden.has(it.id) && !hidden.has(it.room));
  if ((hour >= 1 && hour < 7) && bed) return plan({ do: 'go', to: frontOf(bed) }, { do: 'act', act: 'idle', mood: 'sleep', dur: 25 });
  const r = Math.random(), shown = house.items.filter((it) => kindOf(it) && !hidden.has(it.id) && !appearing.has(it.id) && !hidden.has(it.room));
  if (r < 0.45) { const t = randomSpot(Math.random() < 0.6 ? R.rm : null); if (t) plan({ do: 'go', to: t }, { do: 'act', act: 'idle', dur: 1.5 + Math.random() * 2.5 }); }
  else if (r < 0.66 && shown.length) { const it = shown[(Math.random() * shown.length) | 0]; plan({ do: 'go', to: frontOf(it) }, { do: 'look', item: it }, { do: 'act', act: 'idle', mood: Math.random() < 0.5 ? 'happy' : 'think', dur: 2 }); }
  else if (r < 0.76) plan({ do: 'act', act: 'wave', face: 'se', dur: 2.2 });
  else if (r < 0.88) plan({ do: 'act', act: 'browse', dur: 3.5 });
  else plan({ do: 'act', act: 'idle', dur: 2 + Math.random() * 3 });
}
function stepBot(dt) {
  if (!bot.on) return;
  let T = bot.task;
  if (!T) { if (!bot.queue.length) idle(); T = bot.task = bot.queue.shift() || { do: 'act', act: 'idle', dur: 1 }; T.t = 0; }
  T.t += dt;
  if (T.do === 'go') {
    if (!T.path) { T.path = pathTo([bot.I, bot.J], T.to); if (!T.path.length) { bot.task = null; return; } }
    const tgt = T.path[0]; if (!tgt) { bot.task = null; bot.act = 'idle'; return; }
    // long trips across the house go a bit faster
    const di = tgt[0] - bot.I, dj = tgt[1] - bot.J, d = Math.hypot(di, dj), step = (SPEED + Math.min(2, T.path.length / 8)) * dt;
    bot.act = bot.carry ? 'carry' : 'roll';
    if (d <= step) { bot.I = tgt[0]; bot.J = tgt[1]; T.path.shift(); bot.roll += d; if (!T.path.length) { bot.task = null; bot.act = 'idle'; } }
    else { bot.I += di / d * step; bot.J += dj / d * step; bot.roll += step; bot.face = faceTo(di, dj); }
    return;
  }
  if (T.do === 'act') {
    bot.act = T.act; bot.u = Math.min(1, T.t / T.dur); if (T.face) bot.face = T.face; bot.mood = T.mood || (T.act === 'cheer' ? 'happy' : '');
    if (T.t >= T.dur) { bot.task = null; bot.mood = ''; bot.act = bot.carry ? 'carry' : 'idle'; if (T.then) T.then(); }
    return;
  }
  if (T.do === 'look') { const [ci, cj] = centerOf(T.item); bot.face = faceTo(ci - bot.I + 0.001, cj - bot.J); bot.task = null; return; }
  if (T.do === 'call') { T.fn(); bot.task = null; return; }
  bot.task = null;
}

// ---------------- acting out what happened ----------------
function reveal(id, room) { hidden.delete(id); appearing.set(id, clock); blocked = null; if (room) { const R = rooms.get(room); if (R) R.base = null; } }
function actOut(events) {
  let earned = 0;
  for (const e of events) {
    const mark = () => plan({ do: 'call', fn: () => markFeed(e.id) });
    if (e.type === 'earn') { earned++; if (earned <= 2) plan({ do: 'call', fn: () => { markFeed(e.id); bumpBalance(); } }, { do: 'act', act: 'cheer', mood: 'happy', face: 'se', dur: 1.3 }); }
    else if (e.type === 'browse') { mark(); plan({ do: 'act', act: 'browse', dur: 2.6 }); }
    else if (e.type === 'look' || e.type === 'think' || e.type === 'goal' || e.type === 'idea') { mark(); plan({ do: 'act', act: 'think', mood: 'think', dur: 1.8 }); }
    else if (e.type === 'build') {
      const id = e.room; mark();
      plan({ do: 'call', fn: () => { reveal(id); index(); follow(rooms.get(id)); } }, { do: 'act', act: 'cheer', mood: 'happy', face: 'se', dur: 1.2 },
        { do: 'go', to: () => { const rm = house.rooms.find((r) => r.id === id); return global(rm, N / 2, N / 2); } }, { do: 'act', act: 'cheer', mood: 'happy', face: 'se', dur: 1.4 });
    } else if (e.type === 'buy') {
      const it = house.items.find((x) => x.id === e.item); if (!it || !kindOf(it)) continue;
      const base = S.layerOf(kindOf(it)) !== 'stand';
      plan({ do: 'call', fn: () => { markFeed(e.id); follow(rooms.get(house.rooms[0].id)); } },
        { do: 'go', to: frontDoor }, { do: 'act', act: 'lift', dur: 0.7, then: () => { bot.carry = true; } }, { do: 'call', fn: () => follow(rooms.get(it.room)) },
        { do: 'go', to: () => frontOf(it) }, { do: 'look', item: it }, { do: 'act', act: 'place', dur: 1.1, then: () => { bot.carry = false; reveal(it.id, base ? it.room : null); index(); } },
        { do: 'act', act: 'idle', mood: 'happy', dur: 1.4 });
    }
  }
}
// tasks whose target is only known once the bot gets there
const _shift = bot.queue.shift.bind(bot.queue);
bot.queue.shift = () => { const T = _shift(); if (T && typeof T.to === 'function') T.to = T.to(); return T; };

function hideFresh(events) {
  for (const e of events) {
    if (e.type === 'buy' && e.item) hidden.add(e.item);
    if (e.type === 'build' && e.room) hidden.add(e.room);
  }
}
function toActOut(seen) {
  const feed = house.feed; if (!feed.length) return [];
  if (!seen) {
    // a first visit: the last few things it bought, from the first of them on
    const buys = feed.filter((e) => e.type === 'buy'); if (!buys.length) return feed.slice(-2);
    const from = num(buys[Math.max(0, buys.length - 3)].id); return feed.filter((e) => num(e.id) >= from);
  }
  return feed.filter((e) => num(e.id) > seen).slice(-14);
}

// ---------------- the panel ----------------
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
let shownBalance = 0, targetBalance = 0;
function bumpBalance() { targetBalance = house.balance; const el = $('.balance'); el.classList.add('is-up'); setTimeout(() => el.classList.remove('is-up'), 1600); }
function stepBalance(dt) {
  if (shownBalance === targetBalance) return;
  const d = targetBalance - shownBalance, step = Math.max(1, Math.abs(d) * Math.min(1, dt * 3.5));
  shownBalance = Math.abs(d) <= step ? targetBalance : shownBalance + Math.sign(d) * step;
  $('.balance-n').textContent = money(shownBalance);
}
function wallet() {
  const h = house;
  for (const el of document.querySelectorAll('.bot-name')) el.textContent = h.name || 'Dither';
  document.title = `${h.name || 'Dither'}'s house`;
  if (h.post) for (const a of document.querySelectorAll('.post-link')) a.href = h.post;
  $('.earned').textContent = money(h.earned); $('.spent').textContent = money(h.spent);
  for (const el of document.querySelectorAll('.rate-n')) {
    const n = h.counts[el.dataset.count] || 0, l = el.parentNode.querySelector('.rate-l');
    el.textContent = n.toLocaleString('en-US'); l.textContent = n === 1 ? l.dataset.one : l.dataset.many;
  }
  const r = h.rates, xs = document.querySelectorAll('.rate-x'); [r.like, r.reply, r.repost, r.follow].forEach((v, n) => { xs[n].textContent = `${money(v)} each`; });
  const goal = h.goal || { name: 'the next room', price: h.next.room }, pct = Math.max(0, Math.min(100, h.balance / goal.price * 100));
  $('.goal-name').textContent = goal.name; $('.goal-n').textContent = `${money(Math.min(h.balance, goal.price))} of ${money(goal.price)}`;
  $('.bar-fill').style.width = pct.toFixed(1) + '%'; $('.bar').setAttribute('aria-valuenow', String(Math.round(pct)));
  const n = h.ideas || 0, el = $('.ideas'); el.replaceChildren();
  if (n) { el.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${ICON.idea}</svg>`; el.append(`${n.toLocaleString('en-US')} ${n === 1 ? 'idea' : 'ideas'} from the replies so far`); }
  trip();
}
function trip() {
  const el = $('.trip'), t = $('.trip-t'); if (!house || !t) return;
  if (!house.checked) { t.textContent = `Checks the post every ${house.every} min`; el.classList.remove('is-now'); return; }
  const next = Date.parse(house.checked) + house.every * 60000 + 90000, left = Math.round((next - Date.now()) / 1000);
  t.textContent = left > 0 ? `Next check in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Checking the post now';
  el.classList.toggle('is-now', left <= 0);
}
const ICON = {
  earn: '<circle cx="10" cy="10" r="7"/><path d="M10 6v8M7.5 8.5c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.4-2.5 1.5-2.5.6-2.5 1.6 1 1.6 2.5 1.6 2.5-.6 2.5-1.6"/>',
  browse: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.3 12.3 17 17"/>',
  look: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.2"/>',
  buy: '<path d="M4 7h12l-1 10H5z"/><path d="M7.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>',
  place: '<path d="M3 8l7-4 7 4-7 4z"/><path d="M3 8v6l7 4 7-4V8M10 12v6"/>',
  build: '<path d="M3 10l7-6 7 6M5 9v8h10V9"/><path d="M8.5 17v-4h3v4"/>',
  think: '<path d="M5 13a4 4 0 0 1 1-7.5A4.5 4.5 0 0 1 14.5 6 3.5 3.5 0 0 1 15 13z"/><circle cx="6" cy="16.5" r="1"/><circle cx="3.5" cy="18.5" r=".6"/>',
  goal: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3.5"/><circle cx="10" cy="10" r=".6"/>',
  note: '<path d="M4 3h9l3 3v11H4z"/><path d="M7 9h6M7 12h6"/>',
  idea: '<path d="M7.2 13.2c-1.6-1.1-2.7-2.9-2.7-4.9a5.5 5.5 0 0 1 11 0c0 2-1.1 3.8-2.7 4.9V15H7.2z"/><path d="M7.8 17.5h4.4"/>',
};
const ago = (t) => { const s = (Date.now() - Date.parse(t)) / 1000; if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

// ---------------- the feed, told as short entries ----------------
// the raw feed has a line for every little thing the bot did. here each visit to the post becomes one group: what it
// earned in one line, each purchase as a card (what it went looking for, what it passed on, what it bought, its
// thought, where it went), and short lines for the rest.
const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);
// store names often shout (KLEPPSTAD bed frame): words of four or more capitals read as ordinary words; TV and LED stay
const soft = (x) => String(x).replace(/(?<!\p{L})(\p{Lu})(\p{Lu}{3,})(?!\p{L})/gu, (m, a, b) => a + b.toLowerCase());
// a product's short name: up to the first comma (or ' with ', ' - ', ' | ', ' ('), and no longer than about forty letters
function splitName(name) {
  const cuts = [',', ' with ', ' - ', ' | ', ' ('].map((c) => name.indexOf(c)).filter((k) => k > 0), k = cuts.length ? Math.min(...cuts) : -1;
  let main = k > 0 ? name.slice(0, k) : name, rest = k > 0 ? name.slice(k).replace(/^,\s*/, '').trim() : '';
  if (main.length > 42) { const w = main.lastIndexOf(' ', 38); rest = (main.slice(w + 1) + ' ' + rest).trim(); main = main.slice(0, w) + '…'; }
  return [main, rest];
}
const shortOf = (name) => splitName(name)[0];
const tail = (e) => String(e.text).split(' · ').slice(1);
const and = (xs) => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
function groupsOf(feed) {
  const groups = []; let g = null, last = 0;
  for (const e of feed) { const t = Date.parse(e.t); if (!g || t - last > 150000) groups.push(g = { events: [] }); g.events.push(e); last = t; }
  return groups.map((x) => ({ t: x.events[x.events.length - 1].t, entries: entriesOf(x.events) }));
}
function entriesOf(evs) {
  const out = []; let pending = [], earn = null;
  const flush = () => { if (earn) { out.push(earn); earn = null; } };
  const takeIdea = (item) => { const k = pending.findIndex((p) => p.type === 'idea' && p.acted && p.item === item); return k < 0 ? null : pending.splice(k, 1)[0]; };
  const loose = () => { for (const p of pending) out.push({ kind: p.type, ids: [p.id], e: p }); pending = []; };
  for (let n = 0; n < evs.length; n++) {
    const e = evs[n];
    if (e.type === 'earn') { if (!earn) earn = { kind: 'earn', ids: [], amount: 0, bits: [] }; earn.ids.push(e.id); earn.amount += e.amount || 0; earn.bits.push(tail(e).join(' · ')); continue; }
    flush();
    if (e.type === 'browse' || e.type === 'look' || (e.type === 'idea' && e.acted && e.item)) { pending.push(e); continue; }
    if (e.type === 'buy') {
      const c = { kind: 'card', ids: [e.id], e, item: house.items.find((x) => x.id === e.item), browse: null, passed: [], idea: takeIdea(e.item), place: null, thought: null };
      if (c.idea) c.ids.push(c.idea.id);
      for (const p of pending) { c.ids.push(p.id); if (p.type === 'browse') c.browse = p; else if (p.type === 'look') c.passed.push(p); }
      pending = pending.filter((p) => p.type === 'idea');
      if (evs[n + 1] && evs[n + 1].type === 'place' && evs[n + 1].item === e.item) { c.place = evs[++n]; c.ids.push(c.place.id); }
      if (evs[n + 1] && evs[n + 1].type === 'think') { c.thought = evs[++n]; c.ids.push(c.thought.id); }
      out.push(c); continue;
    }
    if (e.type === 'place') { const idea = takeIdea(e.item); loose(); out.push({ kind: 'move', ids: idea ? [idea.id, e.id] : [e.id], e, idea }); continue; }
    loose(); out.push({ kind: e.type, ids: [e.id], e });
  }
  flush(); loose();
  return out;
}
const svgOf = (k) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICON[k] || ICON.note}</svg>`;
const link = (href, text) => { const a = document.createElement('a'); a.href = href; a.textContent = text; a.rel = 'noopener nofollow'; a.target = '_blank'; return a; };
const el = (tag, cls, ...kids) => { const x = document.createElement(tag); if (cls) x.className = cls; for (const k of kids) if (k !== null && k !== undefined && k !== '') x.append(k); return x; };
function ideaTag() { const t = el('span', 'tag'); t.innerHTML = svgOf('idea'); t.append("someone's idea"); return t; }
function lineEntry(kind, ...kids) { const li = el('li', 'en en-' + kind); li.innerHTML = svgOf(kind); li.append(el('p', '', ...kids)); return li; }
function renderEntry(x) {
  const e = x.e;
  if (x.kind === 'earn') { const li = lineEntry('earn', el('span', 'amt', '+' + money(x.amount)), ' ', el('span', 'muted', 'from ' + and(x.bits))); return li; }
  if (x.kind === 'card') {
    const it = x.item, li = el('li', 'card'), name = soft(it ? it.name : String(e.text).replace(/^bought /, '').split(' · ')[0]);
    const [main, rest] = splitName(name);
    const kick = el('p', 'card-kicker');
    const bm = x.browse && /^browsing (.+) at (.+)$/.exec(x.browse.text);
    kick.append(bm ? el('span', '', `Shopping for ${bm[1]} at `, x.browse.url ? link(x.browse.url, bm[2]) : bm[2]) : el('span', '', 'Bought'));
    if (x.idea) kick.append(ideaTag());
    const title = el('h3', 'card-title');
    if (it) { const b = el('button', 'it', main); b.type = 'button'; b.addEventListener('click', () => focusItem(it)); title.append(b); } else title.append(main);
    if (rest) title.append(' ', el('span', 'card-sub', rest));
    const meta = el('p', 'card-meta', el('span', 'price', money(it ? it.price : e.amount || 0)));
    if (it && it.store) meta.append(' from ', it.url ? link(it.url, it.store) : it.store);
    li.append(kick, title, meta);
    if (x.thought) li.append(el('p', 'card-quote', `“${cap(x.thought.text)}”`));
    if (x.place) li.append(el('p', 'card-note', cap(x.place.text) + '.'));
    for (const p of x.passed) { const [nm, price, why] = [soft(String(p.text).replace(/^looking at /, '').split(' · ')[0]), ...tail(p)]; li.append(el('p', 'card-note', `Passed on ${nm}${price ? ` (${price})` : ''}${why ? `: ${why}` : ''}.`)); }
    return li;
  }
  if (x.kind === 'move') { const it = house.items.find((y) => y.id === e.item), text = it ? String(e.text).replace(it.name, shortOf(it.name)) : String(e.text); const li = lineEntry('place', cap(soft(text)) + '.'); if (x.idea) li.querySelector('p').append(' ', ideaTag()); return li; }
  if (x.kind === 'browse') { const m = /^browsing (.+) at (.+)$/.exec(e.text); return m ? lineEntry('browse', `Browsing ${m[1]} at `, e.url ? link(e.url, m[2]) : m[2]) : lineEntry('browse', cap(e.text)); }
  if (x.kind === 'look') { const [nm, price, why] = [soft(String(e.text).replace(/^looking at /, '').split(' · ')[0]), ...tail(e)]; return lineEntry('look', `Looked at ${nm}${price ? ` (${price})` : ''}`, why ? el('span', 'muted', `: ${why}`) : ''); }
  if (x.kind === 'goal') { const [what, price] = [String(e.text).split(' · ')[0], tail(e)[0]]; return lineEntry('goal', cap(what), price ? el('span', 'muted', ` (${price})`) : ''); }
  if (x.kind === 'build') { const [what, price] = [String(e.text).split(' · ')[0], tail(e)[0]]; return lineEntry('build', cap(what), price ? el('span', 'muted', ` for ${price}`) : ''); }
  if (x.kind === 'idea') { const [what, why] = [String(e.text).split(' · ')[0], tail(e)[0]]; return lineEntry('idea', cap(what) + (why ? '. ' : '.'), why ? el('span', 'muted', cap(why) + '.') : ''); }
  if (x.kind === 'think') return lineEntry('think', `“${cap(e.text)}”`);
  return lineEntry('note', cap(e.text) + '.');
}
let groupsShown = 6;
function renderFeed() {
  const ol = $('#feed'), now = ol.querySelector('.is-now'), nowIds = now ? now.dataset.ids : '', groups = groupsOf(house.feed).reverse();
  ol.replaceChildren(...groups.slice(0, groupsShown).map((g) => {
    const li = el('li', 'grp', el('p', 'grp-t', ago(g.t)));
    const list = el('ol', 'grp-l'); for (const x of g.entries) { const node = renderEntry(x); node.dataset.ids = ' ' + x.ids.join(' ') + ' '; list.append(node); }
    li.append(list); return li;
  }));
  if (nowIds) { const id = nowIds.trim().split(' ')[0]; markFeed(id); }
  $('#more').hidden = groups.length <= groupsShown;
}
function markFeed(id) { for (const x of document.querySelectorAll('.feed .is-now')) x.classList.remove('is-now'); const x = document.querySelector(`.feed [data-ids~="${id}"]`); if (x) x.classList.add('is-now'); }

// the receipt: what a thing is, what it cost, what paid for it (counts only, never who)
function showReceipt(it) {
  const k = kindOf(it), el = $('#receipt'); receiptFor = it;
  $('.receipt-kind', el).textContent = it.artist ? `a print · ${it.artist}` : k.label;
  $('.receipt-name', el).textContent = soft(it.name);
  const pr = $('.receipt-price', el); pr.replaceChildren(it.free ? 'it came with the room' : `${money(it.price)}`);
  if (it.store) { pr.append(it.url ? ' from ' : ` from ${it.store}`); if (it.url) { const a = document.createElement('a'); a.href = it.url; a.textContent = it.store; a.rel = 'noopener nofollow'; a.target = '_blank'; pr.append(a); } }
  const by = $('.receipt-by', el); by.replaceChildren();
  if (it.by && it.by.length) { by.append('Paid for by '); it.by.forEach((w, n) => { if (n) by.append(n === it.by.length - 1 ? ' and ' : ', '); by.append(w); }); by.append('.'); }
  $('.receipt-when', el).textContent = (it.idea ? 'Someone in the replies suggested it. ' : '') + (it.bought ? `Bought ${ago(it.bought)}.` : '');
  el.hidden = false;
}
function hideReceipt() { $('#receipt').hidden = true; receiptFor = null; }
function focusItem(it) {
  const R = rooms.get(it.room); if (!R) return;
  const k = kindOf(it), b = K.screenBox(k, it); userCam = true;
  if (zi < 8) { zi = 8; cam.z = ZOOMS[zi]; forgetOtherSizes(); touchMode(); }
  moveTo({ x: R.ox + (b.x0 + b.x1) / 2 + (vw > 820 ? 0 : 0), y: R.oy + (b.y0 + b.y1) / 2 }, true);
  found = new Set([it.id]); setTimeout(() => { found.delete(it.id); }, 3200); showReceipt(it);
}

// ---------------- drawing a frame ----------------
// a cached print, put where it belongs on the screen (whole device pixels, so the dither stays crisp)
function blit(src, ratio, wx, wy) { const cv = src.cv || src, w = src.w || cv.width, h = src.h || cv.height, k = zr() / ratio; ctx.imageSmoothingEnabled = k < 0.999; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cv, 0, 0, w, h, Math.round(devX(wx)), Math.round(devY(wy)), Math.round(w * k), Math.round(h * k)); ctx.imageSmoothingEnabled = false; }
function draw(t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, stage.width, stage.height); ctx.imageSmoothingEnabled = false;
  const list = [...rooms.values()].filter((R) => !hidden.has(R.rm.id)).sort((a, b) => a.rm.at[0] + a.rm.at[1] - b.rm.at[0] - b.rm.at[1]);
  ghostRoom();
  for (const R of list) {
    if (!roomInView(R)) continue;
    const base = baseOf(R), ra = appearing.get(R.rm.id), level = ra === undefined ? 64 : Math.floor((clock - ra) / 0.9 * 64);
    blit(level < 64 ? dithered(base.cv, level, base.ratio) : base.cv, base.ratio, R.ox + R.b.x0, R.oy + R.b.y0);
    if (ra !== undefined && level >= 64) appearing.delete(R.rm.id);
    const things = [];
    for (const it of R.items) {
      const k = kindOf(it), layer = S.layerOf(k), a = appearing.get(it.id);
      if (hidden.has(it.id)) continue;
      if (layer !== 'stand' && a === undefined) continue;
      things.push({ key: layer === 'stand' ? K.depthOf(k, it) : -2, it, a });
    }
    const BR = botRoom(); if (bot.on && BR === R) things.push({ key: bot.I - R.rm.at[0] * N + bot.J - R.rm.at[1] * N + 0.01, bot: true });
    things.sort((a, b) => a.key - b.key);
    for (const th of things) {
      if (th.bot) { drawBot(R, t); continue; }
      const s = spriteOf(th.it), wx = R.ox + s.x0, wy = R.oy + s.y0;
      if (hover === th.it.id || found.has(th.it.id)) { const hi = hiOf(s), k = zr() / s.ratio, o = 2.5 * dpr; for (const [dx, dy] of [[o, 0], [-o, 0], [0, o], [0, -o]]) ctx.drawImage(hi, Math.round(devX(wx) + dx), Math.round(devY(wy) + dy), Math.round(s.cv.width * k), Math.round(s.cv.height * k)); }
      let cv = s.cv;
      if (th.a !== undefined) { const level = Math.floor((clock - th.a) / 0.8 * 64); if (level >= 64) { appearing.delete(th.it.id); if (S.layerOf(kindOf(th.it)) !== 'stand') { R.base = null; } } else cv = dithered(s.cv, level, s.ratio); }
      blit(cv, s.ratio, wx, wy);
    }
  }
}
function ghostRoom() {
  // the next room's spot: a dashed card waiting on the paper
  if (!house) return;
  const at = S.buildable(house.rooms)[0]; if (!at) return;
  const [ox, oy] = W.roomOrigin(at), n = W.ROOM, pts = [P.iso(0, 0, 0), P.iso(n, 0, 0), P.iso(n, n, 0), P.iso(0, n, 0)].map(([x, y]) => [devX(ox + x), devY(oy + y)]);
  ctx.save(); ctx.setLineDash([6 * dpr, 6 * dpr]); ctx.lineWidth = 1.3 * dpr; ctx.strokeStyle = 'rgba(52,74,128,.45)';
  ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); ctx.restore();
}
function drawBot(R, t) {
  const [gx, gy] = P.iso(bot.I - R.rm.at[0] * N, bot.J - R.rm.at[1] * N, 0);
  ctx.save();
  ctx.setTransform(zr() * B.SCALE, 0, 0, zr() * B.SCALE, Math.round(devX(R.ox + gx)), Math.round(devY(R.oy + gy)));
  B.drawBot(P.mkHand(ctx, { fine: true, seed: 5 }), null, { t, face: bot.face, act: bot.act, u: bot.u, mood: bot.mood, roll: bot.roll, carry: bot.carry });
  ctx.restore();
}

// ---------------- pointing ----------------
function hullOf(it) {
  const k = kindOf(it), pl = K.placer(it.at), [w, d] = it.size || k.size, wall = k.place === 'wall', pts = [];
  for (const u of [0, w]) for (const v of [0, wall ? 0.1 : d]) for (const z of [0, wall ? d : Math.max(0.05, k.height || 0.2)]) pts.push(P.iso(...pl.W(u, v, z)));
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function thingAt(px, py) {
  const [wx, wy] = toWorld(px, py); let best = null, bk = -Infinity;
  for (const R of rooms.values()) {
    if (hidden.has(R.rm.id)) continue;
    for (const it of R.items) { if (hidden.has(it.id)) continue; const k = kindOf(it), key = S.layerOf(k) === 'stand' ? K.depthOf(k, it) : S.layerOf(k) === 'wall' ? -1 : -3; if (key > bk && P.pip(hullOf(it), wx - R.ox, wy - R.oy)) { best = it; bk = key; } }
  }
  return best;
}
// where a pointer is on the canvas, in CSS px (offsetX is unreliable under zoom and transforms)
const at = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const pointers = new Map(); let drag = null, pinch = null, moved = 0;
stage.addEventListener('pointerdown', (e) => { try { stage.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ } pointers.set(e.pointerId, [...at(e)]); moved = 0; if (pointers.size === 1) drag = { x: at(e)[0], y: at(e)[1] }; else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; drag = null; } });
stage.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [...at(e)]);
  if (pinch && pointers.size === 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d / pinch.d > 1.22) { zoomBy(1, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch.d = d; } else if (d / pinch.d < 0.82) { zoomBy(-1, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch.d = d; } moved = 99; return; }
  if (drag) { const [ex, ey] = at(e), dx = ex - drag.x, dy = ey - drag.y; moved += Math.abs(dx) + Math.abs(dy); if (moved > 4 && !(e.pointerType !== 'mouse' && atFit())) { cam.x -= dx / cam.z; cam.y -= dy / cam.z; userCam = true; tween = null; stage.classList.add('is-drag'); } drag = { x: at(e)[0], y: at(e)[1] }; return; }
  if (e.pointerType === 'mouse') { const it = thingAt(...at(e)); hover = it ? it.id : null; stage.classList.toggle('is-point', !!it); }
});
const up = (e) => {
  pointers.delete(e.pointerId); stage.classList.remove('is-drag');
  if (pointers.size < 2) pinch = null;
  if (drag && moved <= 4) { const it = thingAt(...at(e)); if (it) { showReceipt(it); found = new Set([it.id]); setTimeout(() => found.delete(it.id), 1800); } else hideReceipt(); }
  drag = null;
};
stage.addEventListener('pointerup', up);
stage.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); stage.classList.remove('is-drag'); if (pointers.size < 2) pinch = null; drag = null; });
stage.addEventListener('pointerleave', () => { hover = null; stage.classList.remove('is-point'); });
let wheelAcc = 0;
stage.addEventListener('wheel', (e) => { e.preventDefault(); wheelAcc += e.deltaY * (e.deltaMode ? 30 : 1); if (Math.abs(wheelAcc) > 60) { zoomBy(wheelAcc < 0 ? 1 : -1, ...at(e)); wheelAcc = 0; } }, { passive: false });
stage.addEventListener('dblclick', (e) => { const [wx, wy] = toWorld(...at(e)); for (const R of rooms.values()) if (wx > R.ox + R.b.x0 && wx < R.ox + R.b.x1 && wy > R.oy + R.b.y0 && wy < R.oy + R.b.y1) { userCam = true; fitTo({ x0: R.ox + R.b.x0, y0: R.oy + R.b.y0, x1: R.ox + R.b.x1, y1: R.oy + R.b.y1 }, true); return; } });
for (const b of document.querySelectorAll('[data-zoom]')) b.addEventListener('click', () => { const z = b.dataset.zoom; if (z === 'fit') { userCam = false; fitTo(worldBounds(true), true); } else zoomBy(z === 'in' ? 1 : -1); });
$('.receipt-x').addEventListener('click', hideReceipt);
addEventListener('keydown', (e) => { if (e.key === 'Escape') hideReceipt(); });
$('#more').addEventListener('click', () => { groupsShown += 8; renderFeed(); });

// ---------------- running ----------------
function paperTile() {
  // the stock: a faint fibre and a few specks, and the dither tiles the panel uses
  const tile = (ink, tone, scale) => { const t = P.ditherTile(ink, Math.round(tone * 64)), cv = HS.env.makeCanvas(8 * scale, 8 * scale), c = cv.getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(t, 0, 0, 8 * scale, 8 * scale); return `url(${cv.toDataURL()})`; };
  const rs = document.documentElement.style;
  rs.setProperty('--dither-coral', tile('coral', 0.72, 1)); rs.setProperty('--dither-sun', tile('sun', 0.35, 1));
}
let rafAt = 0;
function frame(now) { requestAnimationFrame(frame); rafAt = performance.now(); tick(now); }
// some embedded views say they're visible but never run animation frames: keep the bot moving on a timer there
setInterval(() => { if (!document.hidden && performance.now() - rafAt > 400) tick(performance.now()); }, 1000 / 30);
function tick(now) {
  if (document.hidden || !house) return;
  const t = now / 1000; if (lastT && t - lastT < 1 / 50) return; const dt = Math.min(0.1, lastT ? t - lastT : 0.016); lastT = t; clock += dt;
  if (tween) { const u = Math.min(1, (clock - tween.t0) / tween.d), e = P.sm(u); cam.x = P.lerp(tween.x0, tween.x1, e); cam.y = P.lerp(tween.y0, tween.y1, e); if (u >= 1) tween = null; }
  try { stepBot(dt); stepBalance(dt); draw(clock); } catch (err) { if (!frame.failed) { frame.failed = true; console.error(err); } }
}
async function refresh(first) {
  let h; try { h = await fetchJSON('house.json'); } catch (err) { if (first) $('#loading').textContent = "The house didn't load. Try again in a moment."; return; }
  if (!first && h.updated === house.updated) return;
  if (h.kindsV !== kindsV || first) { kinds = await fetchJSON('kinds.json'); kindsV = h.kindsV; sprites.clear(); for (const R of rooms.values()) R.base = null; }
  const known = house ? num(house.feed.length ? house.feed[house.feed.length - 1].id : 0) : 0;
  house = h; loadImages();
  const seen = Number(store.get(SEEN_KEY)) || 0;
  const fresh = first ? toActOut(seen) : house.feed.filter((e) => num(e.id) > known);
  hideFresh(fresh); index();
  if (first) {
    $('#loading').hidden = true;
    const [di, dj] = frontDoor(); bot.I = di + 1.5; bot.J = dj; bot.on = true;
    shownBalance = targetBalance = fresh.some((e) => e.type === 'earn') ? Math.max(0, house.balance - fresh.filter((e) => e.type === 'earn').reduce((s, e) => s + (e.amount || 0), 0) + fresh.filter((e) => e.type === 'buy' || e.type === 'build').reduce((s, e) => s + (e.amount || 0), 0)) : house.balance;
    $('.balance-n').textContent = money(shownBalance);
    resize();
  }
  wallet(); renderFeed(); if (!first || !fresh.some((e) => e.type === 'earn')) targetBalance = house.balance;
  if (fresh.length) actOut(fresh);
  if (house.feed.length) store.set(SEEN_KEY, String(num(house.feed[house.feed.length - 1].id)));
}

globalThis.__house = { cam, bot, rooms, hidden, appearing, get house() { return house; }, pathTo }; // for poking at in the console
function hint() {
  const h = $('#hint'); if (!h) return;
  h.textContent = COARSE ? 'Tap anything to see what it is. Pinch to look closer.' : 'Click anything to see what it is. Scroll to zoom.';
  h.hidden = false; const gone = () => { h.classList.add('is-gone'); setTimeout(() => { h.hidden = true; }, 700); };
  setTimeout(gone, 7000); stage.addEventListener('pointerdown', gone, { once: true }); stage.addEventListener('wheel', gone, { once: true, passive: true });
}
paperTile();
new ResizeObserver(() => resize()).observe(view);
refresh(true).then(() => { if (house) { draw(clock); hint(); } requestAnimationFrame(frame); }); // the first picture doesn't wait for the animation
setInterval(() => { if (!document.hidden) refresh(false); }, 60000);
setInterval(trip, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
})();
