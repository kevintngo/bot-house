// ===========================================================================
// the press: one cream sheet, printed in riso inks, where every tint is an
// ordered dither instead of a halftone dot. (the look and most of this file
// come from "a small light, room by room"; the screens are what changed.)
//
// shared by the page and by tools/lib/env.js, so it touches nothing but
// HOUSE.env: makeCanvas(w, h) and DOMMatrix.
// ===========================================================================
(function (HS) {
'use strict';
const env = HS.env || (HS.env = {});
if (!env.makeCanvas && typeof document !== 'undefined') env.makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
if (!env.DOMMatrix && typeof DOMMatrix !== 'undefined') env.DOMMatrix = DOMMatrix;
const TAU = Math.PI * 2;

// ---------------- rng ----------------
function mul32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hmix(h, v) { h = Math.imul(h ^ (v | 0), 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); return (h ^ (h >>> 16)) >>> 0; }
function strHash(s) { let h = 0x811C9DC5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function streamOf(...ks) { let h = 0x9E3779B9; for (const k of ks) h = hmix(h, typeof k === 'string' ? strHash(k) : k); const f = mul32(h); for (let i = 0; i < 11; i++) f(); return f; }
const rd = (R, a, b) => a + R() * (b - a);
const ri = (R, a, b) => Math.floor(rd(R, a, b + 1));
const ch = (R, p) => R() < p;
const pk = (R, arr) => arr[(R() * arr.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (t) => t * t * (3 - 2 * t);
const sstep = (a, b, t) => sm(clamp((t - a) / (b - a), 0, 1));
const fract = (v) => v - Math.floor(v);
const tri = (t) => 1 - Math.abs(fract(t) * 2 - 1);
const bump = (a, b, u) => u <= a || u >= b ? 0 : Math.sin((u - a) / (b - a) * Math.PI);

// ---------------- geometry ----------------
function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [[pts[0][0], pts[0][1]]]; let need = step;
  for (let i = 1; i < pts.length; i++) {
    let x0 = pts[i - 1][0], y0 = pts[i - 1][1]; const x1 = pts[i][0], y1 = pts[i][1];
    let d = Math.hypot(x1 - x0, y1 - y0);
    while (d >= need && d > 0) { const t = need / d; x0 += (x1 - x0) * t; y0 += (y1 - y0) * t; out.push([x0, y0]); d -= need; need = step; }
    need -= d;
  }
  const L = pts[pts.length - 1], E = out[out.length - 1];
  if (Math.hypot(L[0] - E[0], L[1] - E[1]) > step * 0.3) out.push([L[0], L[1]]);
  return out;
}
function chaikin(pts, closed, it) {
  let p = pts.slice();
  for (let k = 0; k < it; k++) {
    const q = [], n = p.length;
    if (closed) { for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } }
    else { q.push(p[0]); for (let i = 0; i < n - 1; i++) { const a = p[i], b = p[i + 1]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } q.push(p[n - 1]); }
    p = q;
  }
  return p;
}
const curve = (pts, it = 3) => chaikin(pts, false, it);
const loop = (pts, it = 3) => chaikin(pts, true, it);
function bbox(pts) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return [x0, y0, x1, y1]; }
function pip(P, x, y) { let inside = false; const n = P.length; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
function centroid(P) { let x = 0, y = 0; for (const p of P) { x += p[0]; y += p[1]; } return [x / P.length, y / P.length]; }
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const lerpP = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
function blob(R, cx, cy, rx, ry, rot0) {
  const n = Math.max(12, Math.round((rx + ry) / 3)), pts = []; const rot = rot0 ?? rd(R, 0, TAU);
  const a1 = rd(R, 0.04, 0.1), a2 = rd(R, 0.02, 0.05), p1 = rd(R, 0, 7), p2 = rd(R, 0, 7);
  for (let i = 0; i < n; i++) {
    const t = i / n * TAU, m = 1 + a1 * Math.sin(t * 2 + p1) + a2 * Math.sin(t * 5 + p2);
    const x = Math.cos(t) * rx * m, y = Math.sin(t) * ry * m;
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return pts;
}
function rotPts(pts, cx, cy, rot) { const c = Math.cos(rot), s = Math.sin(rot); return pts.map((p) => { const x = p[0] - cx, y = p[1] - cy; return [cx + x * c - y * s, cy + x * s + y * c]; }); }
function arcPts(cx, cy, rx, ry, a0, a1, n) { const p = []; for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; p.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]); } return p; }
const ell = (cx, cy, rx, ry, n) => { n = n || Math.max(14, Math.round((rx + ry) * 0.6)); return arcPts(cx, cy, rx, ry, 0, TAU, n).slice(0, n); };
const circ = (cx, cy, r, n) => ell(cx, cy, r, r, n);
function polyPts(cx, cy, r, n, rot = 0) { const p = []; for (let i = 0; i < n; i++) { const a = rot + i / n * TAU; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return p; }
function starPts(cx, cy, r1, r2, n, rot = 0) { const p = []; for (let i = 0; i < n * 2; i++) { const a = rot + i / (n * 2) * TAU, r = (i % 2) ? r2 : r1; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return p; }
const tr = (pts, dx, dy) => pts.map((p) => [p[0] + dx, p[1] + dy]);
const sc = (pts, cx, cy, k, ky) => pts.map((p) => [cx + (p[0] - cx) * k, cy + (p[1] - cy) * (ky ?? k)]);
function roundRect(x0, y0, x1, y1, r, n = 4) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  return [].concat(arcPts(x1 - r, y0 + r, r, r, -Math.PI / 2, 0, n), arcPts(x1 - r, y1 - r, r, r, 0, Math.PI / 2, n), arcPts(x0 + r, y1 - r, r, r, Math.PI / 2, Math.PI, n), arcPts(x0 + r, y0 + r, r, r, Math.PI, Math.PI * 1.5, n));
}
// a thick ribbon around a polyline: the width may be a number or a function of t
function ribbon(pts, w) {
  const n = pts.length, L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let nx = -(b[1] - a[1]), ny = b[0] - a[0]; const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
    const ww = (typeof w === 'function' ? w(n > 1 ? i / (n - 1) : 0) : w) / 2; L.push([pts[i][0] + nx * ww, pts[i][1] + ny * ww]); Rr.push([pts[i][0] - nx * ww, pts[i][1] - ny * ww]);
  }
  return L.concat(Rr.reverse());
}

// ---------------- iso ----------------
// a tile is a diamond 64 wide and 32 tall; one unit of height is 32 tall.
// i runs down-right on the screen, j runs down-left, z goes up. the light
// comes from the upper left: tops are lit, faces turned down-left (+j) are in
// half shade and faces turned down-right (+i) in full shade.
const TW = 64, TH = 32, TZ = 32;
const isoX = (i, j) => (i - j) * (TW / 2);
const isoY = (i, j, z) => (i + j) * (TH / 2) - (z || 0) * TZ;
const iso = (i, j, z) => [isoX(i, j), isoY(i, j, z)];

// ===========================================================================
// THE INKS
// ===========================================================================
// four riso drums, a black drum for the bot, and the paper. inks overprint
// (multiply); a tint is an ordered dither; "paper" is the knock-out.
const PAPER = [243, 235, 221];
const INK = {
  blue: [52, 74, 128],     // the key plate: midnight blue
  coral: [238, 104, 82],   // warm clay
  sun: [255, 212, 40],     // yellow
  teal: [0, 140, 138],     // green-blue
  black: [36, 34, 38],     // the bot, screens, a few deep shadows
  paper: PAPER,
};
const INK_NAMES = ['blue', 'coral', 'sun', 'teal', 'black', 'paper'];
// each drum's plate sits a hair off register, a fixed amount
const PLATE = { blue: [0, 0], coral: [-0.5, 0.35], sun: [0.4, 0.55], teal: [-0.35, -0.45], black: [0, 0], paper: [0, 0] };
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// the screen: an 8x8 ordered (Bayer) dither. every drum shares the matrix, so
// a second tint lands on the same dots as the first and darkens them, the way
// overprinted riso ink does, and bare paper stays bare.
const BAYER = (() => {
  const m = [[0, 2], [3, 1]]; let M = m;
  for (let n = 2; n < 8; n *= 2) { const N = []; for (let y = 0; y < 2 * n; y++) { N.push([]); for (let x = 0; x < 2 * n; x++) N[y].push(4 * M[y % n][x % n] + m[(y / n) | 0][(x / n) | 0]); } M = N; }
  return M;
})();
const SHIFT = { blue: [0, 0], coral: [0, 0], sun: [0, 0], teal: [0, 0], black: [0, 0], paper: [4, 4] };
const DP = 1;           // world units per dither pixel ("fine" screens use half; HOUSE.env.dp overrides it, for the share card)
const LEVELS = 64;
const TILES = new Map();
function ditherTile(ink, level) {
  const key = ink + '|' + level; let cv = TILES.get(key); if (cv) return cv;
  cv = env.makeCanvas(8, 8); const c = cv.getContext('2d'), im = c.createImageData(8, 8), col = INK[ink], [sx, sy] = SHIFT[ink];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (BAYER[(y + sy) & 7][(x + sx) & 7] < level) { const o = (y * 8 + x) * 4; im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255; }
  c.putImageData(im, 0, 0); TILES.set(key, cv); return cv;
}
const BANKS = new WeakMap();
function inkPattern(ctx, ink, tone, fine) {
  let bank = BANKS.get(ctx); if (!bank) { bank = new Map(); BANKS.set(ctx, bank); }
  const level = clamp(Math.round(tone * LEVELS), 1, LEVELS), key = ink + '|' + level + '|' + (fine ? 1 : 0);
  let p = bank.get(key);
  if (!p) {
    p = ctx.createPattern(ditherTile(ink, level), 'repeat');
    const s = (fine ? 0.5 : 1) * (env.dp || DP);
    if (p.setTransform && env.DOMMatrix) p.setTransform(new env.DOMMatrix().scaleSelf(s, s));
    bank.set(key, p);
  }
  return p;
}

// ===========================================================================
// THE HAND
// ===========================================================================
// mkHand(ctx, {ox, oy, seed, fine}) makes a hand that prints on ctx. ox, oy
// shift the origin (rooms draw in their own iso coordinates). the dither is
// anchored to the context's own coordinates, so draw a moving thing in its
// own translated space and its screen moves with it.
//
//   H.fill(P, ink, tone)    knock the shape out of what is below, then print it
//   H.tint(P, ink, tone)    overprint only: shadows, glass, light, water
//   H.knock(P)              paper, and nothing else
//   H.line(R, pts, ink, w)  a pen line in that ink
//   H.grad(P, ink, t0, t1, a, b)  a screen that grows from tone t0 at a to t1 at b
//   H.glow(x, y, rx, ry, ink, tone)  a soft dithered halo
//   H.light(x, y, rx, ry)   a halo of paper: light in a dark room
// ===========================================================================
const PAPER_RGB = rgb(PAPER), NO_DASH = [];
function mkHand(cx, o = {}) {
  const H = {};
  const ox = o.ox || 0, oy = o.oy || 0, FINE = !!o.fine;
  const RB = streamOf(o.seed ?? 0, 'hand'); H.RB = RB; H.ox = ox; H.oy = oy; H.ctx = () => cx;
  const path = (c, P, dx = 0, dy = 0) => { c.beginPath(); for (let i = 0; i < P.length; i++) { i ? c.lineTo(P[i][0] + dx, P[i][1] + dy) : c.moveTo(P[i][0] + dx, P[i][1] + dy); } c.closePath(); };
  H.pathOf = path;

  H.p = (i, j, z) => [isoX(i, j) + ox, isoY(i, j, z) + oy];
  H.tile = (i, j, w, d, z) => [H.p(i, j, z), H.p(i + w, j, z), H.p(i + w, j + d, z), H.p(i, j + d, z)];
  // a vertical face along i at a fixed j (it faces +j: half shade when it is a front face)
  H.faceI = (i, j, len, z0, z1) => [H.p(i, j, z0), H.p(i + len, j, z0), H.p(i + len, j, z1), H.p(i, j, z1)];
  // a vertical face along j at a fixed i (it faces +i: full shade when it is a front face)
  H.faceJ = (i, j, len, z0, z1) => [H.p(i, j, z0), H.p(i, j + len, z0), H.p(i, j + len, z1), H.p(i, j, z1)];
  H.path = (pts) => pts.map((p) => H.p(p[0], p[1], p[2] || 0));

  const printInk = (ink, tone, draw, fine) => {
    const k = INK[ink] ? ink : 'blue', j = PLATE[k];
    if (k !== 'paper') cx.globalCompositeOperation = 'multiply';
    draw(inkPattern(cx, k, tone, fine ?? FINE), j[0], j[1]);
    if (k !== 'paper') cx.globalCompositeOperation = 'source-over';
  };
  H.knock = (P, o2 = {}) => { if (P.length < 3) return; const a = o2.a ?? 1; path(cx, P); cx.fillStyle = a === 1 ? PAPER_RGB : rgb(PAPER, a); cx.fill(); };
  H.tint = (P, ink, tone = 1, o2 = {}) => { if (P.length < 3 || tone <= 0) return; printInk(ink, tone, (st, dx, dy) => { path(cx, P, dx, dy); cx.fillStyle = st; cx.fill(); }, o2.fine); };
  H.fill = (P, ink, tone = 1, o2 = {}) => { if (P.length < 3) return; if (o2.knock !== false) H.knock(P); if (tone > 0) H.tint(P, ink, tone, o2); };
  H.fill2 = (P, ink, tone, ink2, tone2, o2) => { H.fill(P, ink, tone, o2); H.tint(P, ink2, tone2, o2); };
  // the eraser (sprites only): lift everything off, for holes
  H.erase = (P) => { cx.globalCompositeOperation = 'destination-out'; path(cx, P); cx.fillStyle = '#000'; cx.fill(); cx.globalCompositeOperation = 'source-over'; };
  // a flat colour, no screen (used sparingly: highlights on glass, the screen of a laptop)
  H.flat = (P, css) => { path(cx, P); cx.fillStyle = css; cx.fill(); };

  // a screen that grows across a shape: thin bands, one dither, read as one gradient
  H.grad = (P, ink, t0, t1, a, b, n = 12, o2 = {}) => {
    if (P.length < 3) return;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, W = 4000;
    cx.save(); path(cx, P); cx.clip();
    for (let k = 0; k < n; k++) {
      const s0 = k / n * L - (k ? 0 : W), s1 = (k + 1) / n * L + (k === n - 1 ? W : 0), t = lerp(t0, t1, (k + 0.5) / n);
      if (t <= 0.02) continue;
      const B = [[a[0] + ux * s0 + nx * W, a[1] + uy * s0 + ny * W], [a[0] + ux * (s1 + 0.5) + nx * W, a[1] + uy * (s1 + 0.5) + ny * W], [a[0] + ux * (s1 + 0.5) - nx * W, a[1] + uy * (s1 + 0.5) - ny * W], [a[0] + ux * s0 - nx * W, a[1] + uy * s0 - ny * W]];
      printInk(ink, t, (st) => { path(cx, B); cx.fillStyle = st; cx.fill(); }, o2.fine);
    }
    cx.restore();
  };
  // a halo, densest at the heart: each band an annulus with its own screen
  const rings = (ink, x, y, rx, ry, n, toneAt) => {
    for (let k = 0; k < n; k++) {
      const f0 = k / n, f1 = (k + 1) / n, t = clamp(toneAt(f0, f1), 0, 1); if (t <= 0.03) continue;
      printInk(ink, t, (st) => { cx.beginPath(); cx.ellipse(x, y, rx * f1, ry * f1, 0, 0, TAU); if (k) { cx.moveTo(x + rx * f0, y); cx.ellipse(x, y, rx * f0, ry * f0, 0, 0, TAU, true); } cx.fillStyle = st; cx.fill('evenodd'); });
    }
  };
  H.glow = (x, y, rx, ry, ink = 'sun', tone = 0.6, n = 8) => { if (tone <= 0.02 || rx <= 0 || ry <= 0) return; rings(ink, x, y, rx, ry, n, (f0, f1) => tone * Math.pow(1 - (f0 + f1) / 2, 1.3)); };
  H.light = (x, y, rx, ry, strength = 1, n = 8) => { if (strength <= 0.02 || rx <= 0 || ry <= 0) return; rings('paper', x, y, rx, ry, n, (f0, f1) => strength * (1.35 - (f0 + f1) / 2 * 1.35)); };

  // the wandering pen
  H.wob = (rs, amp) => {
    const n = rs.length, q = new Array(n);
    const P1 = rd(RB, 0, 7), P2 = rd(RB, 0, 7), F1 = rd(RB, 1.4, 3), F2 = rd(RB, 5, 9);
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0; const A = rs[i > 0 ? i - 1 : 0], B = rs[i < n - 1 ? i + 1 : n - 1];
      let nx = -(B[1] - A[1]), ny = B[0] - A[0]; const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
      const off = amp * (0.65 * Math.sin(t * F1 * 2 + P1) + 0.35 * Math.sin(t * F2 + P2));
      q[i] = [rs[i][0] + nx * off + rd(RB, -0.1, 0.1), rs[i][1] + ny * off + rd(RB, -0.1, 0.1)];
    }
    return q;
  };
  // a line of ink. o2: {tone, amp, taper: 'in'|'out'|true, cap, dash: [on, off], closed}
  H.line = (R, pts, ink = 'blue', w = 1.4, o2 = {}) => {
    if (!pts || pts.length < 2) return;
    const src = o2.closed ? pts.concat([pts[0]]) : pts;
    const rs = resample(src, Math.max(2.5, w * 1.4)); if (rs.length < 2) return;
    const amp = o2.amp ?? Math.min(0.6, w * 0.15 + 0.15);
    const q = amp > 0 ? H.wob(rs, amp) : rs;
    const tone = o2.tone ?? 1, taper = o2.taper;
    if (taper) {
      const P = ribbon(q, (t) => { let e; if (taper === 'out') e = 0.2 + 0.8 * (1 - t); else if (taper === 'in') e = 0.2 + 0.8 * t; else e = 0.25 + 0.75 * Math.min(1, Math.min(t, 1 - t) / 0.25); return Math.max(0.3, w * e); });
      printInk(ink, tone >= 0.75 ? 1 : tone, (st, dx, dy) => { path(cx, P, dx, dy); cx.fillStyle = st; cx.fill(); }, o2.fine);
      return;
    }
    const dash = o2.dash;
    printInk(ink, tone >= 0.75 ? 1 : tone, (st, dx, dy) => {
      cx.strokeStyle = st; cx.lineWidth = w; cx.lineCap = o2.cap || 'round'; cx.lineJoin = 'round'; if (dash) cx.setLineDash(dash);
      cx.beginPath(); cx.moveTo(q[0][0] + dx, q[0][1] + dy); for (let i = 1; i < q.length; i++) cx.lineTo(q[i][0] + dx, q[i][1] + dy); cx.stroke(); if (dash) cx.setLineDash(NO_DASH);
    }, o2.fine);
  };
  H.outline = (R, P, ink = 'blue', w = 1.3, o2 = {}) => H.line(R, P, ink, w, { ...o2, closed: true });
  H.dot = (x, y, r, ink = 'blue', tone = 1, o2 = {}) => { const P = circ(x, y, r, Math.max(8, Math.round(r * 2.5))); if (o2.knock) H.fill(P, ink, tone, o2); else H.tint(P, ink, tone, o2); };
  // a scatter of dots inside a shape
  H.speckle = (R, P, ink, n, r0 = 0.6, r1 = 1.4, tone = 1) => {
    const [x0, y0, x1, y1] = bbox(P); const dots = [];
    for (let k = 0; k < n; k++) { const x = rd(R, x0, x1), y = rd(R, y0, y1); if (pip(P, x, y)) dots.push([x, y, rd(R, r0, r1)]); }
    printInk(ink, tone, (st, dx, dy) => { cx.fillStyle = st; cx.beginPath(); for (const d of dots) { cx.moveTo(d[0] + d[2] + dx, d[1] + dy); cx.arc(d[0] + dx, d[1] + dy, d[2], 0, TAU); } cx.fill(); });
  };
  // everything drawn inside fn is clipped to P
  H.clip = (P, fn) => { cx.save(); path(cx, P); cx.clip(); try { return fn(); } finally { cx.restore(); } };
  H.opacity = (alpha, fn) => { alpha = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1); if (alpha <= 0) return; if (alpha >= 1) return fn(); cx.save(); cx.globalAlpha *= alpha; try { return fn(); } finally { cx.restore(); } };
  H.img = (im, x, y, w, h) => cx.drawImage(im, x, y, w, h);
  return H;
}

HS.P = {
  TAU, mul32, hmix, strHash, streamOf, rd, ri, ch, pk, clamp, lerp, sm, sstep, fract, tri, bump,
  resample, chaikin, curve, loop, bbox, pip, centroid, dist, rect, lerpP, blob, rotPts, arcPts, ell, circ, polyPts, starPts, tr, sc, roundRect, ribbon,
  TW, TH, TZ, isoX, isoY, iso, PAPER, INK, INK_NAMES, rgb, BAYER, DP, ditherTile, inkPattern, mkHand,
};
})(globalThis.HOUSE || (globalThis.HOUSE = {}));
