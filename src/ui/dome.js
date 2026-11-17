// Canvas renderer for the sky dome (Fig. 01). Stateless apart from layout
// caches: give it a scene, it draws it and remembers hit targets.

import { domeProject } from '../lib/projection.js';
import { readTheme, alpha } from './theme.js';

const CARDINALS = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };

export class Dome {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.targets = [];
    this.theme = readTheme();
    this.resize();
  }

  refreshTheme() { this.theme = readTheme(); }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.size = Math.max(1, Math.min(rect.width, rect.height));
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cx = rect.width / 2;
    this.cy = rect.height / 2;
    // Leave room outside the horizon for the azimuth scale and labels.
    const margin = this.size < 420 ? 24 : 34;
    this.R = this.size / 2 - margin;
  }

  project(az, el) { return domeProject(az, el, this.cx, this.cy, this.R); }

  /** Nearest hit target to (x, y) within `slop` CSS px, or null. */
  hitTest(x, y, slop = 22) {
    let best = null, bestD = slop;
    for (const t of this.targets) {
      const d = Math.hypot(t.x - x, t.y - y) - t.r;
      if (d < bestD) { bestD = d; best = t.obj; }
    }
    return best;
  }

  draw(scene) {
    const { ctx, cx, cy, R, theme: T } = this;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.restore();
    this.targets = [];
    this.labels = [];
    this.reserved = []; // boxes of fixed chart text that labels must avoid

    this.drawSky(scene.sunEl);
    this.drawGrid();
    this.drawScale();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R + 0.5, 0, Math.PI * 2);
    ctx.clip();

    for (const s of scene.stars ?? []) this.drawStar(s);
    if (scene.track?.length) this.drawTrack(scene.track, scene.trackNow);
    for (const s of scene.swarm ?? []) this.drawSwarm(s);
    for (const s of scene.sats ?? []) this.drawSat(s);
    const sun = scene.bodies?.find((b) => b.id === 'sun');
    for (const b of scene.bodies ?? []) this.drawBody(b, scene.moonPhase, sun);
    ctx.restore();

    // Labels are drawn last so they sit above every marker.
    if (scene.selected) this.drawSelection(scene.selected);
    this.flushLabels();
  }

  // --- background -------------------------------------------------------

  drawSky(sunEl = -90) {
    const { ctx, cx, cy, R, theme: T } = this;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, T.sky);
    g.addColorStop(1, T.sky_rim);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    // Daylight / twilight wash: a faint glow of the accent from the horizon.
    const day = Math.max(0, Math.min(1, (sunEl + 12) / 18));
    if (day > 0) {
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
      glow.addColorStop(0, alpha(T.muted, 0.03 * day));
      glow.addColorStop(1, alpha(T.muted, 0.12 * day));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawGrid() {
    const { ctx, cx, cy, R, theme: T } = this;
    ctx.save();
    ctx.lineWidth = 1;
    // Altitude rings every 15 deg: 30/60 solid, others dotted.
    for (const alt of [15, 30, 45, 60, 75]) {
      const r = (R * (90 - alt)) / 90;
      ctx.strokeStyle = alt % 30 === 0 ? T.faint : alpha(T.muted, 0.18);
      ctx.setLineDash(alt % 30 === 0 ? [] : [1, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Meridians every 30 deg, faint; N-S and E-W slightly stronger.
    for (let az = 0; az < 360; az += 30) {
      const p = this.project(az, 0);
      const q = this.project(az, 75);
      ctx.strokeStyle = az % 90 === 0 ? T.faint : alpha(T.muted, 0.12);
      ctx.beginPath();
      ctx.moveTo(az % 90 === 0 ? cx : q.x, az % 90 === 0 ? cy : q.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    // Zenith mark
    ctx.strokeStyle = T.muted;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
    ctx.stroke();
    // Ring labels along the north meridian.
    ctx.fillStyle = T.muted;
    ctx.font = `10px ${T.mono}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const alt of [30, 60]) {
      const r = (R * (90 - alt)) / 90;
      ctx.fillText(`${alt}°`, cx + 4, cy - r - 7);
      this.reserve(cx + 4, cy - r - 7, ctx.measureText(`${alt}°`).width, 10);
    }
    ctx.restore();
  }

  drawScale() {
    const { ctx, cx, cy, R, theme: T } = this;
    const small = this.size < 420;
    ctx.save();
    // Horizon
    ctx.strokeStyle = T.ink;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    // Ticks outside the horizon
    ctx.lineWidth = 1;
    for (let az = 0; az < 360; az += 2) {
      const len = az % 30 === 0 ? 8 : az % 10 === 0 ? 5 : 2.5;
      if (small && len === 2.5) continue;
      const a = (az * Math.PI) / 180;
      const sx = -Math.sin(a), sy = -Math.cos(a);
      ctx.strokeStyle = az % 10 === 0 ? T.muted : alpha(T.muted, 0.5);
      ctx.beginPath();
      ctx.moveTo(cx + sx * (R + 1), cy + sy * (R + 1));
      ctx.lineTo(cx + sx * (R + 1 + len), cy + sy * (R + 1 + len));
      ctx.stroke();
    }
    // Labels: cardinals in ink (N in accent), every 30 deg in muted
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rl = R + (small ? 15 : 20);
    for (let az = 0; az < 360; az += 30) {
      const a = (az * Math.PI) / 180;
      const x = cx - Math.sin(a) * rl, y = cy - Math.cos(a) * rl;
      if (CARDINALS[az]) {
        ctx.fillStyle = az === 0 ? T.accent : T.ink;
        ctx.font = `600 ${small ? 11 : 12}px ${T.mono}`;
        ctx.fillText(CARDINALS[az], x, y);
        this.reserve(x - 6, y, 12, 12);
      } else if (!small || az % 90 !== 0) {
        ctx.fillStyle = T.muted;
        ctx.font = `${small ? 8.5 : 9.5}px ${T.mono}`;
        const txt = String(az).padStart(3, '0');
        ctx.fillText(txt, x, y);
        const w = ctx.measureText(txt).width;
        this.reserve(x - w / 2, y, w, 10);
      }
    }
    ctx.restore();
  }

  // --- objects ----------------------------------------------------------

  drawStar(s) {
    if (s.el < 0) return;
    const { ctx, theme: T } = this;
    const p = this.project(s.az, s.el);
    const r = Math.max(0.7, Math.min(2.2, 1.6 - 0.45 * s.mag));
    ctx.fillStyle = alpha(T.ink, 0.55);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (s.mag < 1.0 && this.size >= 340) this.queueLabel(p.x, p.y, r + 3, s.name, { color: alpha(T.muted, 0.75), size: 9, upper: false });
    this.targets.push({ x: p.x, y: p.y, r: 2, obj: s.ref });
  }

  drawSwarm(s) {
    const { ctx, theme: T } = this;
    const p = this.project(s.az, s.el);
    ctx.fillStyle = s.lit ? alpha(T.ink, 0.55) : alpha(T.muted, 0.35);
    ctx.fillRect(p.x - 0.9, p.y - 0.9, 1.8, 1.8);
    this.targets.push({ x: p.x, y: p.y, r: 1, obj: s.ref });
  }

  drawSat(s) {
    const { ctx, theme: T } = this;
    const p = this.project(s.az, s.el);
    if (s.kind === 'iss') {
      const r = 5.5;
      ctx.fillStyle = s.lit ? T.accent : T.bg;
      ctx.strokeStyle = T.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      this.queueLabel(p.x, p.y, r + 4, 'ISS', { color: T.accent, weight: 600, priority: 3 });
      this.targets.push({ x: p.x, y: p.y, r, obj: s.ref });
      return;
    }
    const r = s.kind === 'station' ? 3.4 : 2.4;
    ctx.lineWidth = 1;
    if (s.kind === 'station') {
      ctx.strokeStyle = T.ink;
      ctx.fillStyle = s.lit ? T.ink : T.sky;
      ctx.beginPath();
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
      this.queueLabel(p.x, p.y, r + 4, s.short ?? s.name, { color: T.ink, priority: 2 });
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (s.lit) { ctx.fillStyle = T.ink; ctx.fill(); } else { ctx.strokeStyle = T.muted; ctx.stroke(); }
    }
    this.targets.push({ x: p.x, y: p.y, r, obj: s.ref });
  }

  drawBody(b, moonPhase, sunPos) {
    if (b.el < -0.6) return;
    const { ctx, theme: T } = this;
    const p = this.project(b.az, b.el);
    ctx.save();
    if (b.id === 'sun') {
      ctx.strokeStyle = T.ink;
      ctx.fillStyle = T.sky;
      ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = T.ink;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * 10, p.y + Math.sin(a) * 10);
        ctx.lineTo(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14);
        ctx.stroke();
      }
      this.queueLabel(p.x, p.y, 16, 'Sun', { color: T.ink, priority: 4 });
      this.targets.push({ x: p.x, y: p.y, r: 10, obj: b.ref });
    } else if (b.id === 'moon') {
      const sun = sunPos ? this.project(sunPos.az, sunPos.el) : { x: p.x + 1, y: p.y };
      this.drawMoon(p.x, p.y, 7.5, moonPhase ?? 180, Math.atan2(sun.y - p.y, sun.x - p.x));
      this.queueLabel(p.x, p.y, 11, 'Moon', { color: T.ink, priority: 4 });
      this.targets.push({ x: p.x, y: p.y, r: 9, obj: b.ref });
    } else {
      const r = Math.max(2.2, Math.min(4.5, 3.2 - 0.35 * b.mag));
      ctx.strokeStyle = T.ink;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = T.ink;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      this.queueLabel(p.x, p.y, r + 6, b.name, { color: T.ink, priority: 3, suffix: magText(b.mag) });
      this.targets.push({ x: p.x, y: p.y, r: r + 3, obj: b.ref });
    }
    ctx.restore();
  }

  /**
   * Moon disc lit according to its phase angle (0 new, 180 full), rotated so
   * the bright limb faces the Sun's position on the chart.
   */
  drawMoon(x, y, r, phaseDeg, towardSun) {
    const { ctx, theme: T } = this;
    const k = Math.cos((phaseDeg * Math.PI) / 180); // 1 new .. -1 full
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(towardSun);
    ctx.fillStyle = T.faint;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    // Lit half on +x (towards the Sun), then the terminator: an ellipse that
    // bites into it for a crescent or bulges past the centre when gibbous.
    ctx.fillStyle = T.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, Math.max(0.01, Math.abs(k) * r), r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
    ctx.fill();
    ctx.strokeStyle = T.ink;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  drawTrack(track, nowIndex = 0) {
    const { ctx, theme: T } = this;
    ctx.save();
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    const pts = track.map((t) => ({ ...this.project(t.az, t.el), up: t.el >= 0 }));
    // past: dotted muted; future: solid accent
    const seg = (from, to, style, dash) => {
      ctx.strokeStyle = style;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let pen = false;
      for (let i = from; i <= to && i < pts.length; i++) {
        if (!pts[i].up) { pen = false; continue; }
        if (!pen) { ctx.moveTo(pts[i].x, pts[i].y); pen = true; } else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    };
    seg(0, nowIndex, alpha(T.muted, 0.8), [2, 3]);
    seg(nowIndex, pts.length - 1, T.accent, []);
    ctx.setLineDash([]);
    // minute ticks on the future track
    ctx.fillStyle = T.accent;
    for (let i = nowIndex + 1; i < pts.length; i++) {
      if (track[i].minuteMark && pts[i].up) {
        ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // direction arrow at the end of the visible future track
    let last = -1;
    for (let i = pts.length - 1; i > nowIndex; i--) if (pts[i].up) { last = i; break; }
    if (last > 0 && pts[last - 1]?.up) {
      const a = Math.atan2(pts[last].y - pts[last - 1].y, pts[last].x - pts[last - 1].x);
      ctx.strokeStyle = T.accent;
      ctx.beginPath();
      ctx.moveTo(pts[last].x - 7 * Math.cos(a - 0.45), pts[last].y - 7 * Math.sin(a - 0.45));
      ctx.lineTo(pts[last].x, pts[last].y);
      ctx.lineTo(pts[last].x - 7 * Math.cos(a + 0.45), pts[last].y - 7 * Math.sin(a + 0.45));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSelection(sel) {
    if (sel.el < -0.6) return;
    const { ctx, theme: T } = this;
    const p = this.project(sel.az, sel.el);
    ctx.save();
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 1.25;
    const r = 12;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      ctx.moveTo(p.x + dx * (r + 2), p.y + dy * (r + 2));
      ctx.lineTo(p.x + dx * (r + 7), p.y + dy * (r + 7));
    }
    ctx.stroke();
    ctx.restore();
    // Selected label takes priority over everything else.
    this.labels = this.labels.filter((l) => !(Math.abs(l.x - p.x) < 1 && Math.abs(l.y - p.y) < 1));
    this.queueLabel(p.x, p.y, r + 8, sel.name, { color: T.accent, weight: 600, priority: 10, boxed: true });
  }

  /** Mark a text box (left x, middle y) as occupied. */
  reserve(x, yMid, w, h) {
    this.reserved.push({ x: x - 1, y: yMid - h / 2 - 1, w: w + 2, h: h + 2 });
  }

  // --- labels: greedy placement avoiding overlaps --------------------------

  queueLabel(x, y, offset, text, opts = {}) {
    this.labels.push({ x, y, offset, text, ...opts, priority: opts.priority ?? 1 });
  }

  flushLabels() {
    const { ctx, theme: T } = this;
    const placed = [...this.reserved];
    const sorted = [...this.labels].sort((a, b) => b.priority - a.priority);
    for (const l of sorted) {
      const size = l.size ?? 10;
      const text = (l.upper === false ? l.text : l.text.toUpperCase()) + (l.suffix ? ` ${l.suffix}` : '');
      ctx.font = `${l.weight ?? 400} ${size}px ${T.mono}`;
      const tw = measure(ctx, text, l.upper !== false);
      const h = size + 4;
      const candidates = [
        [l.x + l.offset, l.y - l.offset * 0.6 - h / 2, 'left'],
        [l.x + l.offset, l.y + l.offset * 0.4, 'left'],
        [l.x - l.offset - tw, l.y - l.offset * 0.6 - h / 2, 'left'],
        [l.x - l.offset - tw, l.y + l.offset * 0.4, 'left'],
      ];
      for (const [bx, by] of candidates) {
        const box = { x: bx - 3, y: by - 1, w: tw + 6, h: h + 2 };
        if (box.x < 2 || box.x + box.w > this.cx * 2 - 2 || box.y < 2 || box.y + box.h > this.cy * 2 - 2) continue;
        if (placed.some((b) => overlap(b, box))) continue;
        placed.push(box);
        if (l.boxed) {
          ctx.fillStyle = alpha(T.bg, 0.85);
          ctx.fillRect(box.x, box.y, box.w, box.h);
          ctx.strokeStyle = l.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
        } else {
          ctx.fillStyle = alpha(T.sky, 0.6);
          ctx.fillRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
        }
        ctx.fillStyle = l.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        drawSpaced(ctx, text, bx, by + h / 2, l.upper !== false);
        break;
      }
    }
  }
}

function magText(m) {
  return `${m < 0 ? '−' : '+'}${Math.abs(m).toFixed(1)}`;
}

const TRACK = 0.6; // px letter-spacing for uppercase labels

function measure(ctx, text, spaced) {
  return ctx.measureText(text).width + (spaced ? TRACK * text.length : 0);
}

function drawSpaced(ctx, text, x, y, spaced) {
  if (!spaced) { ctx.fillText(text, x, y); return; }
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${TRACK}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
    return;
  }
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + TRACK; }
}

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
