// ===========================================================================
// the bot: a black ball with two white eyes, like Grok. it rolls, bounces,
// blinks and looks round; things it carries ride on top of it. drawn in its
// own space, ground at (0, 0), so the page moves it by moving the canvas.
//
// s = {t, face: 'se'|'sw'|'ne'|'nw', roll (tiles rolled), act, u (0..1 through
//      the act), mood: 'happy'|'think'|'sleep'|'', carry: true, look: [x, y]}
// acts: 'idle' 'roll' 'carry' 'lift' 'place' 'wave' 'cheer' 'think' 'browse'
// ===========================================================================
(function (HS) {
'use strict';
const { TAU, clamp, lerp, sm, circ, ell, arcPts, roundRect, rotPts, lerpP } = HS.P;
const { boxAt, twinkle } = HS.W;
const TAN = ['sun', 0.42, 'coral', 0.24];
const RAD = 16;          // the ball's radius, in px

// where the eyes sit on the ball for each way it faces: [x, y] from the centre, how wide they look (the sphere turns them), their tilt
const FACES = { se: [5, -4.5, 1, -0.2], sw: [-5, -4.5, 1, 0.2], ne: [7, -11, 0.6, -0.45], nw: [-7, -11, 0.6, 0.45] };

function drawBot(H, R, s) {
  const t = s.t || 0, face = FACES[s.face] ? s.face : 'se', act = s.act || 'idle', u = clamp(s.u ?? 0, 0, 1), fine = { fine: true };
  const rolling = act === 'roll' || act === 'carry';
  // bounce: a small hop while rolling, big ones when cheering; it squashes as it lands
  let hop = 0, sq = 0;
  if (rolling) { const p = ((s.roll || 0) * 1.6) % 1; hop = Math.abs(Math.sin(p * Math.PI)) * 2.2; sq = (1 - Math.abs(Math.sin(p * Math.PI))) * 0.05; }
  else if (act === 'cheer' || act === 'wave') { const p = (t * (act === 'cheer' ? 2.2 : 1.6)) % 1; hop = Math.abs(Math.sin(p * Math.PI)) * (act === 'cheer' ? 13 : 6); sq = hop < 1.5 ? 0.12 * (1 - hop / 1.5) : -0.04; }
  else if (act === 'lift') sq = u > 0.55 && u < 0.8 ? 0.14 * Math.sin((u - 0.55) / 0.25 * Math.PI) : 0;
  else sq = Math.sin(t * 2.4) * 0.015; // breathing
  const rx = RAD * (1 + sq), ry = RAD * (1 - sq), cx = 0, cy = -ry - hop;

  // the shadow shrinks as it hops
  const k = 1 - hop / 30; H.tint(ell(1.5, 0.5, 13 * k, 4.4 * k, 22), 'blue', 0.3 * k + 0.05, fine);
  const ball = ell(cx, cy, rx, ry, 36);
  H.fill(ball, 'black', 1, fine);
  // some volume: shade low on the right
  H.clip(ball, () => H.tint(ell(cx + rx * 0.62, cy + ry * 0.62, rx * 1.02, ry * 0.92, 30), 'blue', 0.3, fine));
  H.outline(R, ball, 'black', 1, { tone: 1, amp: 0.03, fine: true });

  // the eyes, on the ball's surface: turned away, they peek over its edge
  H.clip(ball, () => {
    if (s.mood === 'sleep' || act === 'sleep') eyesShut(H, R, face, cx, cy);
    else if (s.mood === 'happy' || act === 'cheer' || act === 'wave') eyesHappy(H, R, face, cx, cy);
    else eyesOpen(H, s, face, cx, cy, t, act);
  });

  // what it carries rides on top of it
  if (s.carry || act === 'lift' || act === 'place') {
    let bx = 0, by = cy - ry + 1, lean = 0;
    if (act === 'lift') by = lerp(cy - ry - 46, cy - ry + 1, sm(Math.min(1, u / 0.6))) - (u > 0.6 ? Math.sin((u - 0.6) / 0.4 * Math.PI) * 4 : 0);
    if (act === 'place') { const dir = face === 'se' || face === 'ne' ? 1 : -1, p = sm(Math.min(1, u / 0.7)); bx = dir * 22 * p; by = lerp(cy - ry + 1, 0, p) - Math.sin(p * Math.PI) * 10; }
    if (rolling) lean = Math.sin((s.roll || 0) * Math.PI * 3.2) * 1.2;
    if (!(act === 'place' && u > 0.95)) {
      const HB = HS.P.mkHand(H.ctx(), { ox: bx + lean, oy: by, seed: 7, fine: true });
      const b = boxAt(HB, R, -0.24, -0.24, 0.48, 0.48, 0, 0.4, TAN, { shadow: false, lw: 0.9, fine: true });
      HB.line(R, [lerpP(b.top[0], b.top[1], 0.5), lerpP(b.top[3], b.top[2], 0.5)], 'sun', 1.8, { tone: 0.7, amp: 0, fine: true });
    }
  }

  // moods round it
  const top = cy - ry;
  if (s.mood === 'happy' || act === 'cheer') for (let n = 0; n < 3; n++) { const a = t * 1.5 + n * TAU / 3, p = Math.sin(t * 4 + n) * 0.5 + 0.5; twinkle(H, R, cx + Math.cos(a) * (rx + 8), top + 4 + Math.sin(a) * 7, 2 + p * 2, n % 2 ? 'sun' : 'coral', 1); }
  if (s.mood === 'think' || act === 'browse' || act === 'think') {
    const ph = t * 3, side = face === 'sw' || face === 'nw' ? -1 : 1, bx = cx + side * 22, by = top - 16;
    for (const [x, y, r] of [[cx + side * 11, top - 2, 1.5], [cx + side * 15, top - 7, 2.3]]) { const P = circ(x, y, r, 12); H.fill(P, 'paper', 1); H.outline(R, P, 'blue', 0.6, { tone: 1, amp: 0, fine: true }); }
    const bub = ell(bx, by, 11, 7.5, 28); H.fill(bub, 'paper', 1); H.outline(R, bub, 'blue', 0.8, { tone: 1, amp: 0.05, fine: true });
    for (let n = 0; n < 3; n++) H.dot(bx + (n - 1) * 4.6, by, 1.25, 'blue', ((Math.floor(ph) % 3) === n) ? 1 : 0.35, fine);
  }
  if (s.mood === 'sleep' || act === 'sleep') for (let n = 0; n < 2; n++) { const p = (t * 0.4 + n * 0.5) % 1, x = cx + 10 + p * 9, y = top - 4 - p * 16, z = 2.6 + p * 2; H.line(R, [[x - z, y - z], [x + z, y - z], [x - z, y + z], [x + z, y + z]], 'blue', 1, { tone: 1 - p * 0.6, amp: 0, fine: true }); }
}

const eyeAt = (face, cx, cy, side) => { const [ex, ey, wide] = FACES[face]; return [cx + ex + side * 4.1 * (0.7 + 0.3 * wide), cy + ey]; };
// two white pills, set by which way it faces, glancing about, blinking now and then
function eyesOpen(H, s, face, cx, cy, t, act) {
  const [, , wide, tilt] = FACES[face];
  // a glance: every few seconds the eyes dart somewhere and rest there
  const g = Math.floor(t / 2.7), rnd = (v) => { const x = Math.sin(v) * 43758.5453; return x - Math.floor(x); };
  let lx = s.look ? s.look[0] : (rnd(g * 12.9898) - 0.5) * 2.6, ly = s.look ? s.look[1] : (rnd(g * 78.233) - 0.5) * 1.8;
  if (act === 'browse' || act === 'think' || s.mood === 'think') { lx = (face === 'sw' || face === 'nw' ? -1 : 1) * 2.2; ly = -2.6; }
  if (act === 'roll' || act === 'carry') { lx *= 0.3; ly = 0.6; }
  const blink = (t % 3.9) > 3.76 || (t % 11.3) > 11.18, h = blink ? 1.2 : 8.4, w = 3.6 * wide + 0.4;
  for (const side of [-1, 1]) {
    const [x0, y0] = eyeAt(face, cx, cy, side), x = x0 + lx, y = y0 + ly + side * (face === 'se' ? -0.4 : face === 'sw' ? 0.4 : 0);
    H.fill(rotPts(roundRect(x - w / 2, y - h / 2, x + w / 2, y + h / 2, w / 2, 4), x, y, tilt), 'paper', 1, { fine: true });
  }
}
// happy: two small arches
function eyesHappy(H, R, face, cx, cy) {
  const [, , wide, tilt] = FACES[face];
  for (const side of [-1, 1]) { const [x, y0] = eyeAt(face, cx, cy, side), y = y0 + 1; H.line(R, rotPts(arcPts(x, y + 1.5, 2.2 * wide + 0.6, 3.2, Math.PI * 1.05, Math.PI * 1.95, 10), x, y, tilt), 'paper', 2.2, { tone: 1, amp: 0, fine: true }); }
}
// asleep: two short lines
function eyesShut(H, R, face, cx, cy) {
  const [, , wide, tilt] = FACES[face];
  for (const side of [-1, 1]) { const [x, y0] = eyeAt(face, cx, cy, side), y = y0 + 2; H.line(R, rotPts([[x - 2 * wide - 0.4, y], [x + 2 * wide + 0.4, y + 0.6]], x, y, tilt), 'paper', 1.8, { tone: 1, amp: 0, fine: true }); }
}
// how far the drawing reaches round its ground point (for hit tests)
const BOT_BOX = { x0: -40, y0: -96, x1: 40, y1: 10 };
const SCALE = 1.15;      // how big the bot stands in a room

HS.B = { drawBot, BOT_BOX, SCALE, RAD };
})(globalThis.HOUSE || (globalThis.HOUSE = {}));
