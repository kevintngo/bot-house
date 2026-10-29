// ===========================================================================
// things: every piece of furniture, art and junk in the house is a "kind",
// a list of simple shapes in the thing's own space (docs/kinds.json, made by
// tools/house.js from tools/kinds/*.json). the bot adds new kinds as data;
// this file only knows how to print the shapes.
//
// a thing's own space: u runs along its back (the wall it stands against),
// v comes out towards you, z goes up; one unit is one floor tile. a thing at
// at = {i, j, z, face} has its back corner on tile (i, j): face 'ne' puts u
// along i (its back to the right-hand wall), 'nw' puts u along j (its back to
// the left-hand wall). things hung on a wall use the same space, with v ~ 0.
// ===========================================================================
(function (HS) {
'use strict';
const { TAU, streamOf, rd, ri, pk, clamp, lerp, lerpP, centroid, ell, arcPts, blob, ribbon, curve, loop, bbox, sc, circ } = HS.P;
const { boxAt, shadowAt, shadowBox, twinkle } = HS.W;

// named colours, each a riso mix [ink, tone, ink2, tone2]. the bot picks names, never inks.
const SWATCH = {
  white: ['paper', 1], cream: ['sun', 0.14], beige: ['sun', 0.26, 'coral', 0.1], tan: ['sun', 0.42, 'coral', 0.22],
  oak: ['sun', 0.55, 'coral', 0.22], walnut: ['coral', 0.6, 'blue', 0.42], brown: ['coral', 0.7, 'blue', 0.55], terracotta: ['coral', 0.82, 'sun', 0.35],
  yellow: ['sun', 0.9], mustard: ['sun', 0.85, 'coral', 0.3], orange: ['sun', 0.85, 'coral', 0.65], coral: ['coral', 0.75], red: ['coral', 1, 'blue', 0.15],
  pink: ['coral', 0.35], blush: ['coral', 0.2], plum: ['coral', 0.65, 'blue', 0.6], purple: ['blue', 0.55, 'coral', 0.5],
  navy: ['blue', 0.92], blue: ['blue', 0.62], sky: ['blue', 0.24, 'teal', 0.12], aqua: ['teal', 0.5, 'blue', 0.22], teal: ['teal', 0.72], green: ['teal', 0.7, 'sun', 0.55], leaf: ['teal', 0.78, 'sun', 0.35],
  sage: ['teal', 0.38, 'sun', 0.25], mint: ['teal', 0.3], olive: ['sun', 0.65, 'blue', 0.45],
  silver: ['blue', 0.16], grey: ['blue', 0.32], charcoal: ['black', 0.72], black: ['black', 0.95], brass: ['sun', 0.8, 'coral', 0.25], glass: ['teal', 0.14, 'blue', 0.1],
};
const SHAPES = ['box', 'legs', 'cyl', 'cone', 'ball', 'pole', 'panel', 'plant', 'books', 'flat', 'glow', 'lines', 'dot'];
const PLANTS = ['leafy', 'tall', 'round', 'spiky', 'cactus', 'trailing', 'palm', 'tree', 'flowers'];
const PATTERNS = ['plain', 'stripes', 'border', 'dots', 'check', 'fringe', 'round', 'water'];
const shapeType = (s) => SHAPES.find((k) => Array.isArray(s[k]));

// from a thing's own space to the room's tiles
function placer(at) {
  const nw = at.face === 'nw', z0 = at.z || 0;
  return { nw, W: (u, v, z) => nw ? [at.i + v, at.j + u, z0 + z] : [at.i + u, at.j + v, z0 + z], size: (w, d) => nw ? [d, w] : [w, d] };
}
const R2 = Math.SQRT2;
const RX = 32 * R2, RY = 16 * R2;   // a circle of radius 1 tile on the floor, on screen

function paint(H, P, col, shade, o) { H.fill(P, col[0], col[1], o); if (col[2]) H.tint(P, col[2], col[3], o); if (shade) H.tint(P, 'blue', shade, o); }
const KEY = { tone: 0.9, amp: 0.15 };

const PRIM = {
  box(H, R, s, c) {
    const [u, v, z, w, d, h] = s.box, [i, j, zz] = c.pl.W(u, v, z), [wi, dj] = c.pl.size(w, d), col = c.col(s.color);
    const o = { shadow: s.shadow ?? false, top: s.top ? c.col(s.top) : null, line: s.line !== false, fine: c.fine, lw: c.lw };
    if (!s.soft) return boxAt(H, R, i, j, wi, dj, zz, h, col, o);
    // a soft box: a cushion, a mattress, a bean bag: the same faces, the corners rounded off
    if (o.shadow && h > 0.05) shadowBox(H, i, j, wi, dj, zz, h, 0.2);
    const A = H.p(i, j, zz + h), B = H.p(i + wi, j, zz + h), C = H.p(i + wi, j + dj, zz + h), D = H.p(i, j + dj, zz + h), B0 = H.p(i + wi, j, zz), C0 = H.p(i + wi, j + dj, zz), D0 = H.p(i, j + dj, zz);
    const hull = loop([A, B, B0, C0, D0, D], 2), top = loop([A, B, C, D], 2);
    paint(H, hull, col, 0.18, o);
    H.clip(hull, () => H.tint([B, B0, C0, C], 'blue', 0.24, o));
    paint(H, top, o.top || col, 0, o);
    H.outline(R, hull, 'blue', c.lw ?? 1, KEY); H.line(R, curve([lerpP(D, C, 0.1), C, lerpP(C, B, 0.12)], 2), 'blue', 0.8, { tone: 0.6, amp: 0.1 });
  },
  legs(H, R, s, c) {
    const [u, v, z, w, d, h] = s.legs, t = s.thick ?? 0.07, n = s.inset ?? 0.05, col = c.col(s.color);
    for (const [a, b] of [[n, n], [w - n - t, n], [n, d - n - t], [w - n - t, d - n - t]]) { const [i, j, zz] = c.pl.W(u + a, v + b, z), [wi, dj] = c.pl.size(t, t); boxAt(H, R, i, j, wi, dj, zz, h, col, { shadow: false, lw: 0.7, fine: true }); }
  },
  cyl(H, R, s, c) { cone(H, R, c, s.cyl[0], s.cyl[1], s.cyl[2], s.cyl[3], s.cyl[3], s.cyl[4], c.col(s.color), s.top ? c.col(s.top) : null, s); },
  cone(H, R, s, c) { cone(H, R, c, s.cone[0], s.cone[1], s.cone[2], s.cone[3], s.cone[4], s.cone[5], c.col(s.color), s.top ? c.col(s.top) : null, s); },
  ball(H, R, s, c) {
    const [u, v, z, r] = s.ball, [x, y] = H.p(...c.pl.W(u, v, z)), rr = r * 36, col = c.col(s.color);
    if (s.shadow) { const g = H.p(...c.pl.W(u, v, 0)); shadowAt(H, g[0] + rr * 0.3, g[1] + 2, rr * 0.9, rr * 0.4, 0.2); }
    const P = circ(x, y, rr, Math.max(16, Math.round(rr * 1.4)));
    paint(H, P, col, 0, c);
    H.clip(P, () => { const Q = circ(x + rr * 0.45, y + rr * 0.5, rr * 1.05); H.tint(Q, 'blue', 0.3, c); });
    H.dot(x - rr * 0.35, y - rr * 0.38, Math.max(0.8, rr * 0.18), 'paper', 1, { knock: true });
    H.outline(R, P, 'blue', c.lw ?? 0.9, KEY);
  },
  pole(H, R, s, c) {
    const [u0, v0, z0, u1, v1, z1] = s.pole, col = c.col(s.color), a = H.p(...c.pl.W(u0, v0, z0)), b = H.p(...c.pl.W(u1, v1, z1)), w = s.w ?? 2;
    H.line(R, [a, b], 'blue', w + 1.2, { amp: 0.05 });
    if (col[0] !== 'black') H.line(R, [a, b], col[0], Math.max(0.6, w - 0.6), { amp: 0.05, tone: Math.max(col[1], 0.8) });
  },
  panel(H, R, s, c) {
    const [u, v, z, w, h] = s.panel, onPlane = (a, b, dv = 0) => H.p(...c.pl.W(a, v + dv, b));
    const rectOn = (a0, b0, a1, b1, dv) => s.round ? HS.P.arcPts(0, 0, 1, 1, 0, TAU, 40).slice(0, 40).map(([x, y]) => onPlane((a0 + a1) / 2 + x * (a1 - a0) / 2, (b0 + b1) / 2 + y * (b1 - b0) / 2, dv)) : [onPlane(a0, b0, dv), onPlane(a1, b0, dv), onPlane(a1, b1, dv), onPlane(a0, b1, dv)];
    const P = rectOn(u, z, u + w, z + h, 0), shade = c.pl.nw ? 0.12 : 0;
    if (s.drop) H.tint(P.map((p) => [p[0] + 3, p[1] + 3]), 'blue', 0.22);
    let inner = P; const m = s.frame ? (s.inset ?? 0.08) : 0, a0 = u + m, b0 = z + m, a1 = u + w - m, b1 = z + h - m;
    if (s.frame) { paint(H, P, c.col(s.frame), shade, c); inner = rectOn(a0, b0, a1, b1, 0.005); }
    const img = s.image && c.images && c.images[s.image === 'item' ? c.item.image : s.image];
    if (img) {
      // the picture lies flat on the panel: along it and up it, never mirrored
      const cx = H.ctx(), iw = img.width, ih = img.height, ww = a1 - a0, hh = b1 - b0, tl = c.pl.nw ? onPlane(a1, b1, 0.006) : onPlane(a0, b1, 0.006);
      H.knock(inner); H.clip(inner, () => { cx.save(); cx.imageSmoothingEnabled = false; cx.transform(32 * ww / iw, (c.pl.nw ? -16 : 16) * ww / iw, 0, 32 * hh / ih, tl[0], tl[1]); cx.drawImage(img, 0, 0); cx.restore(); });
      if (c.pl.nw) H.tint(inner, 'blue', 0.08);
    } else if (s.color) paint(H, inner, c.col(s.color), shade, c);
    if (s.art === 'abstract') H.clip(inner, () => abstract(H, R, c, a0, b0, a1, b1, (a, b) => onPlane(a, b, 0.008)));
    if (s.shine) H.clip(inner, () => { const p = (a, b) => onPlane(lerp(a0, a1, a), lerp(b0, b1, b), 0.01); H.line(R, [p(0.15, 0.25), p(0.55, 0.95)], 'paper', 2.6, { amp: 0, tone: 0.55 }); H.line(R, [p(0.45, 0.15), p(0.7, 0.6)], 'paper', 1.4, { amp: 0, tone: 0.4 }); });
    H.outline(R, P, 'blue', c.lw ?? 1, KEY); if (inner !== P) H.outline(R, inner, 'blue', 0.7, { tone: 0.6, amp: 0.05 });
  },
  plant(H, R, s, c) { plant(H, R, c, s); },
  books(H, R, s, c) {
    const [u, v, z, len, hh] = s.books, BR = streamOf('books', c.item.id || '', u, v, z), pal = ['coral', 'teal', 'blue', 'mustard', 'pink', 'navy', 'sage', 'cream', 'terracotta'];
    let p = u + 0.03;
    while (p < u + len - 0.08) {
      const bw = rd(BR, 0.08, 0.16), bh = (hh ?? 0.45) * rd(BR, 0.62, 1), [i, j, zz] = c.pl.W(p, v, z), [wi, dj] = c.pl.size(bw, 0.32);
      boxAt(H, BR, i, j, wi, dj, zz, bh, SWATCH[pk(BR, pal)], { shadow: false, lw: 0.6, fine: true });
      p += bw + (BR() < 0.15 ? rd(BR, 0.05, 0.15) : 0.01);
    }
  },
  flat(H, R, s, c) {
    const [u, v, z, w, d] = s.flat, [i, j, zz] = c.pl.W(u, v, z + 0.01), [wi, dj] = c.pl.size(w, d), col = c.col(s.color), col2 = c.col(s.color2 || 'cream'), pat = s.pattern || 'plain';
    let P = H.tile(i, j, wi, dj, zz);
    if (pat === 'round') { const ci = i + wi / 2, cj = j + dj / 2; P = []; for (let k = 0; k < 44; k++) { const t = k / 44 * TAU; P.push(H.p(ci + Math.cos(t) * wi / 2, cj + Math.sin(t) * dj / 2, zz)); } }
    // a pool has a stone edge round the water
    const C = pat === 'water' ? [H.p(i - 0.22, j - 0.22, zz), H.p(i + wi + 0.22, j - 0.22, zz), H.p(i + wi + 0.22, j + dj + 0.22, zz), H.p(i - 0.22, j + dj + 0.22, zz)] : null;
    if (C) { H.fill(C, 'paper', 1); H.tint(C, 'blue', 0.06); H.outline(R, C, 'blue', 0.9, { tone: 0.8, amp: 0.1 }); }
    paint(H, P, col, 0, c);
    H.clip(P, () => {
      if (pat === 'stripes') for (let a = 0.3; a < w; a += 0.45) { const [i2, j2] = c.pl.W(u + a, v, z), [ww, dd] = c.pl.size(0.18, d); H.tint(H.tile(i2, j2, ww, dd, zz), col2[0], col2[1]); }
      if (pat === 'border') { const [i2, j2] = c.pl.W(u + 0.22, v + 0.22, z), [ww, dd] = c.pl.size(w - 0.44, d - 0.44); H.outline(R, H.tile(i2, j2, ww, dd, zz), col2[0], 2.2, { tone: Math.max(0.8, col2[1]) }); }
      if (pat === 'check') for (let a = 0; a < w; a += 0.5) for (let b = 0; b < d; b += 0.5) if ((Math.round(a / 0.5) + Math.round(b / 0.5)) % 2) { const [i2, j2] = c.pl.W(u + a, v + b, z), [ww, dd] = c.pl.size(0.5, 0.5); H.tint(H.tile(i2, j2, ww, dd, zz), col2[0], col2[1]); }
      if (pat === 'dots') for (let a = 0.3; a < w; a += 0.5) for (let b = 0.3; b < d; b += 0.5) { const [x, y] = H.p(...c.pl.W(u + a, v + b, z)); H.dot(x, y, 2.2, col2[0], Math.max(0.6, col2[1])); }
      if (pat === 'water') {
        // the far walls of the pool, in shade, then ripples on the water
        H.tint([H.p(i, j, zz), H.p(i + wi, j, zz), H.p(i + wi, j + 0.35, zz), H.p(i + 0.35, j + 0.35, zz), H.p(i + 0.35, j + dj, zz), H.p(i, j + dj, zz)], 'blue', 0.35);
        const WR = streamOf('ripples', c.item.id || '');
        for (let n = 0; n < Math.round(wi * dj * 1.6); n++) { const a0 = rd(WR, 0.5, wi - 0.6), b0 = rd(WR, 0.5, dj - 0.4), p0 = H.p(i + a0, j + b0, zz); H.line(R, [[p0[0] - 6, p0[1]], [p0[0] - 2, p0[1] - 1.6], [p0[0] + 2, p0[1]], [p0[0] + 6, p0[1] - 1.6]], 'paper', 1.1, { tone: 0.85, amp: 0.1 }); }
      }
    });
    if (pat === 'fringe') for (const a of [0, w]) for (let b = 0.1; b < d; b += 0.16) { const p0 = H.p(...c.pl.W(u + a, v + b, z)), p1 = H.p(...c.pl.W(u + a + (a ? 0.14 : -0.14), v + b, z)); H.line(R, [p0, p1], 'blue', 0.6, { tone: 0.6, amp: 0 }); }
    H.outline(R, P, 'blue', 0.9, { tone: 0.7, amp: 0.15 });
  },
  glow(H, R, s, c) { const [u, v, z] = s.glow, [x, y] = H.p(...c.pl.W(u, v, z)), r = s.r ?? 1.2, col = c.col(s.color || 'yellow'); H.glow(x, y, r * 40, r * 30, col[0] === 'paper' ? 'sun' : col[0], s.tone ?? 0.45); },
  lines(H, R, s, c) { const col = c.col(s.color || 'black'); H.line(R, s.lines.map((p) => H.p(...c.pl.W(p[0], p[1], p[2] || 0))), col[0] === 'paper' ? 'paper' : col[0], s.w ?? 1, { tone: Math.max(0.8, col[1]), amp: 0.1, dash: s.dash ? [2.5, 2] : null, cap: s.dash ? 'butt' : 'round' }); },
  dot(H, R, s, c) { const [x, y] = H.p(...c.pl.W(s.dot[0], s.dot[1], s.dot[2] || 0)), col = c.col(s.color || 'black'); H.dot(x, y, s.r ?? 1.4, col[0], Math.max(col[1], 0.8), { knock: true }); },
};

// a modern-art print, different for every item: a ground, a sun or two, an arch, some bars
function abstract(H, R, c, a0, b0, a1, b1, at) {
  const AR = streamOf('abstract', c.item.id || c.item.name || ''), pal = ['coral', 'yellow', 'teal', 'blue', 'pink', 'mustard', 'navy', 'sage', 'terracotta'], w = a1 - a0, h = b1 - b0;
  const poly = (pts) => pts.map(([a, b]) => at(a0 + a * w, b0 + b * h)), col = () => SWATCH[pk(AR, pal)] || SWATCH.coral;
  const fill = (P) => { const k = col(); H.fill(P, k[0], k[1]); if (k[2]) H.tint(P, k[2], k[3]); };
  if (AR() < 0.6) fill(poly([[0, 0], [1, 0], [1, rd(AR, 0.25, 0.5)], [0, rd(AR, 0.25, 0.5)]]));
  for (let n = ri(AR, 1, 3); n > 0; n--) {
    const t = AR(), x = rd(AR, 0.2, 0.8), y = rd(AR, 0.3, 0.8), r = rd(AR, 0.12, 0.28);
    if (t < 0.45) fill(poly(HS.P.arcPts(x, y, r * h / w, r, 0, TAU, 28).slice(0, 28)));
    else if (t < 0.7) fill(poly([[x - r, 0], [x - r, y], ...HS.P.arcPts(x, y, r, r * w / h, Math.PI, 0, 14), [x + r, y], [x + r, 0]]));
    else for (let k = 0; k < 3; k++) fill(poly([[x - r + k * r * 0.7, 0.1], [x - r + k * r * 0.7 + r * 0.4, 0.1], [x - r + k * r * 0.7 + r * 0.4, y], [x - r + k * r * 0.7, y]]));
  }
}

// a cylinder or a cone (r0 at the bottom, r1 at the top), standing on its centre (u, v)
function cone(H, R, c, u, v, z, r0, r1, h, col, top, s) {
  const [cx, yb] = H.p(...c.pl.W(u, v, z)), yt = yb - h * 32, a = r0 * RX, b = r0 * RY, a1 = r1 * RX, b1 = r1 * RY;
  if (s.shadow && h > 0.05) shadowAt(H, cx + a * 0.35, yb + 2, a * 1.05, b * 1.05, 0.2);
  // its outline: the hull round the bottom ring and the top ring (so a wide, flat cone shows all of itself)
  const pts = arcPts(cx, yb, a, b, 0, TAU, 40).concat(arcPts(cx, yt, Math.max(a1, 0.01), Math.max(b1, 0.01), 0, TAU, 40));
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]), lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const side = lo.slice(0, -1).concat(hi.slice(0, -1));
  paint(H, side, col, 0, c);
  H.grad(side, 'blue', 0.02, 0.42, [cx - Math.max(a, a1), yb], [cx + Math.max(a, a1), yb], 8, c);
  // a cone that opens upward (a pot, a cup) shows its mouth; one that narrows to a point shows its rim edge in front
  const T = ell(cx, yt, a1, b1, 24);
  if (s.open) paint(H, T, col, 0.45, c); else if (r1 > 0.01 && r1 >= r0 * 0.55) paint(H, T, top || col, 0, c);
  if (r1 < r0 * 0.55 && h < r0 * 0.9) H.line(R, arcPts(cx, yb, a, b, 0.15, Math.PI - 0.15, 18), 'blue', 0.8, { tone: 0.7, amp: 0.05 });
  H.outline(R, side, 'blue', c.lw ?? 0.9, KEY); if (r1 > 0.01 && (s.open || r1 >= r0 * 0.55)) H.outline(R, T, 'blue', 0.8, KEY);
}

// a pot plant's leaves, standing on (u, v, z): the top of the soil
function plant(H, R, c, s) {
  const [u, v, z] = s.plant, k = s.size ?? 1, style = s.style || 'leafy', col = c.col(s.color || 'leaf'), PR = streamOf('plant', c.item.id || '', u, v, z, style);
  const [x, y] = H.p(...c.pl.W(u, v, z)), L = (P, tone) => { H.fill(P, col[0], clamp(col[1] * tone, 0.2, 1), c); if (col[2]) H.tint(P, col[2], col[3], c); H.outline(R, P, 'blue', 0.7, { tone: 0.8, amp: 0.15 }); };
  const leaf = (x0, y0, x1, y1, w) => ribbon(curve([[x0, y0], [lerp(x0, x1, 0.5) + rd(PR, -2, 2), lerp(y0, y1, 0.5) - 2], [x1, y1]], 2), (t) => w * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)));
  if (style === 'leafy') for (let n = 0; n < 9; n++) { const a = -Math.PI / 2 + (n - 4) * 0.36 + rd(PR, -0.1, 0.1), l = rd(PR, 12, 20) * k; L(leaf(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l * 0.95, 6 * k), rd(PR, 0.8, 1.1)); }
  if (style === 'tall') { const top = y - 56 * k; H.line(R, curve([[x, y], [x + 2 * k, y - 25 * k], [x - 1, top]], 2), 'blue', 1.6, { tone: 0.9 }); for (let n = 0; n < 11; n++) { const t = 0.18 + n / 11 * 0.82, py = lerp(y, top, t), side = n % 2 ? 1 : -1, l = rd(PR, 9, 13) * k * (1.1 - t * 0.3); L(leaf(x, py, x + side * l, py - l * 0.55, 9 * k), rd(PR, 0.85, 1.1)); } }
  if (style === 'round') { const r = 14 * k, P = blob(PR, x, y - r * 0.85, r * 1.1, r * 0.95, 0); L(P, 1); H.clip(P, () => { for (let n = 0; n < 7; n++) H.tint(blob(PR, x + rd(PR, -r, r), y - r + rd(PR, -r * 0.6, r * 0.5), r * 0.35, r * 0.25), 'blue', 0.25, c); }); }
  if (style === 'spiky') for (let n = 0; n < 7; n++) { const a = -Math.PI / 2 + (n - 3) * 0.13 + rd(PR, -0.05, 0.05), l = rd(PR, 24, 38) * k; const P = ribbon(curve([[x + (n - 3) * 1.6 * k, y], [x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5], [x + Math.cos(a) * l, y + Math.sin(a) * l]], 2), (t) => 5 * k * (1 - t * 0.85)); L(P, rd(PR, 0.85, 1.15)); }
  if (style === 'cactus') { const col2 = (P) => { L(P, 1); }; col2(loop([[x - 6 * k, y], [x - 6 * k, y - 34 * k], [x, y - 40 * k], [x + 6 * k, y - 34 * k], [x + 6 * k, y]], 2)); col2(loop([[x + 5 * k, y - 16 * k], [x + 14 * k, y - 18 * k], [x + 14 * k, y - 28 * k], [x + 10 * k, y - 30 * k], [x + 10 * k, y - 21 * k], [x + 5 * k, y - 20 * k]], 2)); for (let n = -1; n <= 1; n++) H.line(R, [[x + n * 3 * k, y - 2], [x + n * 3 * k, y - 36 * k]], 'blue', 0.6, { tone: 0.5, amp: 0.1 }); }
  if (style === 'trailing') for (let n = 0; n < 7; n++) { const sd = n % 2 ? 1 : -1, l = rd(PR, 10, 30) * k, px = x + sd * rd(PR, 3, 9) * k; let py = y - 4; for (let m = 0; m < l / 6; m++) { L(ell(px + sd * m * 0.8, py, 3.4 * k, 2.6 * k, 10), rd(PR, 0.8, 1.1)); py += 5; } }
  if (style === 'tree') {
    // a trunk and a crown of overlapping clumps, shaded on the side away from the light
    const top = y - 62 * k;
    const trunk = HS.P.ribbon(curve([[x, y], [x + 2 * k, y - 30 * k], [x - 1, top + 14 * k]], 2), (t) => (5 - t * 2.4) * k); H.fill(trunk, 'coral', 0.6, c); H.tint(trunk, 'blue', 0.45, c); H.outline(R, trunk, 'blue', 0.8, { tone: 0.9, amp: 0.1 });
    const clumps = [[0, -8, 20], [-15, 2, 15], [15, 1, 16], [-7, 12, 14], [9, 12, 15], [0, 4, 17]];
    for (const [dx, dy, r] of clumps) { const B = blob(PR, x + dx * k, top + dy * k, r * k, r * 0.86 * k, 0); L(B, rd(PR, 0.85, 1.05)); H.clip(B, () => H.tint(blob(PR, x + dx * k + r * 0.4 * k, top + dy * k + r * 0.45 * k, r * 0.85 * k, r * 0.65 * k, 0), 'blue', 0.3, c)); }
  }
  if (style === 'flowers') {
    const pal = ['coral', 'yellow', 'pink', 'white', 'purple'];
    for (let n = 0; n < 9; n++) { const fx = x + rd(PR, -15, 15) * k, fy = y + rd(PR, -5, 5) * k, h = rd(PR, 9, 16) * k; H.line(R, [[fx, fy], [fx + rd(PR, -1.5, 1.5), fy - h]], 'teal', 1, { tone: 0.9, amp: 0.05 }); L(leaf(fx, fy - 2, fx + rd(PR, -5, 5) * k, fy - 6 * k, 2.8 * k), 1); const fc = SWATCH[pk(PR, pal)] || ['paper', 1]; const F = HS.P.starPts(fx, fy - h, 4 * k, 2.2 * k, 5, rd(PR, 0, 1)); H.fill(F, fc[0], Math.max(0.8, fc[1])); H.outline(R, F, 'blue', 0.6, { tone: 0.8, amp: 0 }); H.dot(fx, fy - h, 1.1 * k, fc[0] === 'sun' ? 'coral' : 'sun', 1, { knock: true }); }
  }
  if (style === 'palm') for (let n = 0; n < 7; n++) { const a = -Math.PI / 2 + (n - 3) * 0.42, l = rd(PR, 26, 34) * k, tip = [x + Math.cos(a) * l * 1.2, y - 18 * k + Math.sin(a) * l * 0.7 + 10 * k]; H.line(R, curve([[x, y], [x + Math.cos(a) * l * 0.4, y - 26 * k], tip], 3), 'blue', 0.9, { tone: 0.9 }); for (let m = 1; m < 7; m++) { const p = lerpP([x + Math.cos(a) * l * 0.4, y - 24 * k], tip, m / 7); L(leaf(p[0], p[1], p[0] + 4 * k, p[1] + 7 * k, 2.4 * k), 1); L(leaf(p[0], p[1], p[0] - 4 * k, p[1] + 7 * k, 2.4 * k), 1); } }
}

// ---------------- a whole thing ----------------
const colOf = (kind, item) => (name) => SWATCH[(item.colors && item.colors[name]) || (kind.colors && kind.colors[name]) || name] || SWATCH.grey;
// "$name" in a shape is the item's own choice (item.options, or the kind's default); "$w" "$h" "$d" are its size
function resolve(s, kind, item) {
  const size = item.size || kind.size, opt = { ...(kind.options || {}), ...(item.options || {}) };
  const val = (x) => typeof x !== 'string' || x[0] !== '$' ? x : x === '$w' ? size[0] : x === '$h' || x === '$d' ? size[1] : opt[x.slice(1)];
  const out = {}; for (const k in s) out[k] = Array.isArray(s[k]) && k !== 'lines' ? s[k].map(val) : val(s[k]); return out;
}
function sizeOf(kind, item) { return item.size || kind.size; }
function drawThing(H, R, kind, item, images, o = {}) {
  const c = { pl: placer(item.at), col: colOf(kind, item), item, kind, images, fine: o.fine ?? (kind.fine || false), lw: o.lw };
  if (kind.place !== 'wall' && kind.place !== 'rug' && kind.shadow !== false) { const [w, d] = c.pl.size(...sizeOf(kind, item)); shadowBox(H, item.at.i, item.at.j, w, d, item.at.z || 0, (kind.height ?? 1) * 0.7, 0.2); }
  for (const s0 of kind.shapes || []) { const t = shapeType(s0); if (t && PRIM[t]) PRIM[t](H, R, resolve(s0, kind, item), c); }
}

// where a thing stands: the floor tiles it covers (whole tiles), its depth for sorting, and the box on screen it can cover
function footprint(kind, item) {
  if (kind.place === 'wall' || (kind.place === 'rug' && !kind.solid)) return [];
  const [w, d] = placer(item.at).size(...sizeOf(kind, item)), out = [];
  for (let i = Math.floor(item.at.i + 1e-6); i < Math.ceil(item.at.i + w - 1e-6); i++) for (let j = Math.floor(item.at.j + 1e-6); j < Math.ceil(item.at.j + d - 1e-6); j++) out.push([i, j]);
  return out;
}
function depthOf(kind, item) {
  if (kind.place === 'wall') return -1;
  if (kind.place === 'rug') return -0.5;
  const [w, d] = placer(item.at).size(...sizeOf(kind, item));
  return item.at.i + w / 2 + item.at.j + d / 2 + (item.at.z || 0) * 0.01;
}
function screenBox(kind, item) {
  const pl = placer(item.at), [w, d] = sizeOf(kind, item), h = kind.place === 'wall' ? 0 : (kind.height ?? 1), pts = [];
  const hh = kind.place === 'wall' ? d : h, dd = kind.place === 'wall' ? 0.3 : d;
  for (const u of [0, w]) for (const v of [0, dd]) for (const z of [0, hh]) pts.push(HS.P.iso(...pl.W(u, v, z)));
  const [x0, y0, x1, y1] = bbox(pts), m = kind.reach || {}, pad = 10;
  return { x0: Math.floor(x0 - Math.max(pad, m.l || 0)), y0: Math.floor(y0 - Math.max(pad, m.t || 0)), x1: Math.ceil(x1 + Math.max(pad, m.r || 0)), y1: Math.ceil(y1 + Math.max(pad, m.b || 0)) };
}

HS.K = { SWATCH, SHAPES, PLANTS, PATTERNS, shapeType, placer, resolve, sizeOf, drawThing, footprint, depthOf, screenBox };
})(globalThis.HOUSE || (globalThis.HOUSE = {}));
