// Overhead: application bootstrap and render loop.

import { Dome } from './ui/dome.js';
import { SkyEngine, interpolate, STRIDE } from './engine/sky-engine.js';
import { loadGroup, mergeGroups, GROUPS } from './lib/catalog.js';
import { satrecFromOmm, observe, isSunlit } from './lib/satellites.js';
import { findPasses } from './lib/passes.js';
import {
  allBodies, sunAltitude, twilight, moonPhaseAngle, moonPhaseName, landmarkStars, nextRiseSet,
} from './lib/bodies.js';
import { enuToAzEl } from './lib/geo.js';
import { CITIES, DEFAULT_CITY } from './lib/cities.js';
import * as F from './lib/format.js';
import { satelliteCard, bodyCard, starCard, renderObjectList, esc } from './ui/panel.js';

const MASK = { stations: 1, visual: 2, starlink: 4 };
const ISS_ID = 25544;
const FRAME_DT = 1000;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(`overhead:${k}`)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`overhead:${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------------------
// State

function initialObserver() {
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    return { lat, lon, height: 0, name: params.get('place') || 'Custom', id: 'custom' };
  }
  const saved = store.get('observer');
  if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)) return saved;
  return { ...DEFAULT_CITY };
}

function initialLayers() {
  const base = { stations: true, visual: true, starlink: false, planets: true, ...store.get('layers') };
  if (params.has('layers')) {
    const on = new Set(params.get('layers').split(','));
    for (const k of Object.keys(base)) base[k] = on.has(k);
  }
  return base;
}

const fixedT = params.has('t') ? Date.parse(params.get('t')) : NaN;
const state = {
  observer: initialObserver(),
  layers: initialLayers(),
  offsetMin: 0,
  baseShift: Number.isFinite(fixedT) ? fixedT - Date.now() : 0,
  selected: null, // { type: 'sat'|'body'|'star', id }
  catalog: new Map(),
  loaded: {},
  frame: null,
  frameDirty: true,
  bodies: [],
  stars: [],
  bodiesAt: 0,
  passCache: null,
  track: null,
  lastPanel: 0,
  lastList: 0,
};

const simNow = () => Date.now() + state.baseShift + state.offsetMin * 60000;
const enabledMask = () => Object.entries(MASK).reduce((m, [g, bit]) => (state.layers[g] ? m | bit : m), 0);

// ---------------------------------------------------------------------------
// Satellites: loading and classification

function kindOf(entry) {
  if (entry.id === ISS_ID) return 'iss';
  if (entry.groups.has('stations')) return 'station';
  if (entry.groups.has('visual')) return 'bright';
  return 'swarm';
}

function rebuildCatalog() {
  const merged = mergeGroups(Object.fromEntries(Object.entries(state.loaded).map(([g, r]) => [g, r.records])));
  state.catalog = new Map();
  for (const e of merged) {
    e.mask = [...e.groups].reduce((m, g) => m | MASK[g], 0);
    e.kind = kindOf(e);
    e.epoch = Date.parse(e.omm.EPOCH.endsWith('Z') ? e.omm.EPOCH : `${e.omm.EPOCH}Z`);
    state.catalog.set(e.id, e);
  }
  engine.setCatalog(merged.map((e) => ({ id: e.id, omm: e.omm, mask: e.mask })));
  state.frameDirty = true;
  updateDataStatus();
}

const loading = new Set();
async function ensureGroup(group) {
  if (state.loaded[group] || loading.has(group)) return;
  loading.add(group);
  if (group === 'starlink') toast('Loading Starlink elements (about 11,000 objects)…');
  try {
    state.loaded[group] = await loadGroup(group, { snapshotOnly: params.get('data') === 'snapshot' });
    rebuildCatalog();
    if (group === 'starlink') toast(null);
  } catch (e) {
    console.error(e);
    toast(`Could not load ${GROUPS[group].label}: ${e.message}`, 6000);
  } finally {
    loading.delete(group);
  }
}

function satrecFor(entry) {
  entry.satrec ??= satrecFromOmm(entry.omm);
  return entry.satrec;
}

// ---------------------------------------------------------------------------
// Engine + dome

const engine = new SkyEngine((frame) => {
  state.frame = frame;
  if (params.has('debug')) {
    document.documentElement.dataset.debug = `frame t0=${new Date(frame.t0).toISOString()} n=${frame.ids.length} ms=${frame.ms.toFixed(1)}`;
  }
});
const canvas = $('dome');
const dome = new Dome(canvas);
new ResizeObserver(() => { dome.resize(); draw(simNow()); }).observe($('dome-wrap'));

/**
 * One request in flight at a time: if inputs change meanwhile (frameDirty)
 * we ask again as soon as it lands. Re-requesting while busy would starve
 * the renderer whenever a frame takes longer than the clock moves.
 */
function needFrame(t) {
  if (engine.busy) return false;
  const f = state.frame;
  if (state.frameDirty || !f) return true;
  return t < f.t0 - 250 || t > f.t0 + FRAME_DT * 0.5;
}

function updateBodies(t) {
  if (Math.abs(t - state.bodiesAt) < 1000 && !state.frameDirty) return;
  const d = new Date(t);
  state.bodies = allBodies(d, state.observer);
  state.stars = landmarkStars(d, state.observer);
  state.moonPhase = moonPhaseAngle(d);
  state.bodiesAt = t;
}

/** Positions of every tracked satellite at time t, from the current frame. */
function satellitesAt(t) {
  const f = state.frame;
  const out = [];
  if (!f) return out;
  for (let i = 0; i < f.ids.length; i++) {
    const entry = state.catalog.get(f.ids[i]);
    if (!entry || !(entry.mask & enabledMask())) continue;
    const p = enuToAzEl(interpolate(f, i, t));
    if (p.el < 0) continue;
    out.push({ entry, az: p.az, el: p.el, lit: f.data[i * STRIDE + 7] === 1 });
  }
  return out;
}

function selectedSatState(t) {
  const sel = state.selected;
  if (sel?.type !== 'sat') return null;
  const entry = state.catalog.get(sel.id);
  const rec = entry && satrecFor(entry);
  if (!rec) return null;
  const d = new Date(t);
  const s = observe(rec, d, state.observer);
  return s && { entry, state: s, lit: isSunlit(s.eci, d) };
}

function trackFor(entry, t) {
  // Recompute the sky track every few seconds of simulated time.
  if (state.track && state.track.id === entry.id && Math.abs(t - state.track.t) < 4000) return state.track;
  const rec = satrecFor(entry);
  const pts = [];
  const step = 15000;
  let nowIndex = 0;
  for (let k = -16; k <= 48; k++) {
    const s = observe(rec, new Date(t + k * step), state.observer);
    if (!s) continue;
    if (k === 0) nowIndex = pts.length;
    pts.push({ az: s.az, el: s.el, minuteMark: k > 0 && k % 4 === 0 });
  }
  state.track = { id: entry.id, t, pts, nowIndex };
  return state.track;
}

function draw(t) {
  const sats = satellitesAt(t);
  const sel = state.selected;
  const scene = {
    sunEl: state.bodies.find((b) => b.id === 'sun')?.el ?? -90,
    stars: state.stars.map((s) => ({ ...s, ref: { type: 'star', id: s.name } })),
    bodies: state.layers.planets ? state.bodies.map((b) => ({ ...b, ref: { type: 'body', id: b.id } })) : [],
    moonPhase: state.moonPhase,
    swarm: [],
    sats: [],
  };
  for (const s of sats) {
    const item = { az: s.az, el: s.el, lit: s.lit, name: s.entry.name, kind: s.entry.kind, ref: { type: 'sat', id: s.entry.id } };
    if (s.entry.kind === 'swarm') scene.swarm.push(item); else scene.sats.push(item);
  }
  if (sel?.type === 'sat') {
    const st = selectedSatState(t);
    if (st) {
      const tr = trackFor(st.entry, t);
      scene.track = tr.pts;
      scene.trackNow = tr.nowIndex;
      scene.selected = { az: st.state.az, el: st.state.el, name: shortName(st.entry.name) };
    }
  } else if (sel?.type === 'body') {
    const b = state.bodies.find((x) => x.id === sel.id);
    if (b) scene.selected = { az: b.az, el: b.el, name: b.name };
  } else if (sel?.type === 'star') {
    const s = state.stars.find((x) => x.name === sel.id);
    if (s) scene.selected = { az: s.az, el: s.el, name: s.name };
  }
  dome.draw(scene);
  state.visibleSats = sats;
}

function shortName(name) {
  return name === 'ISS (ZARYA)' ? 'ISS' : name;
}

// ---------------------------------------------------------------------------
// Loop

let lastDraw = 0;
function tick(now) {
  const t = simNow();
  if (needFrame(t)) {
    engine.request(t, FRAME_DT, enabledMask(), state.observer);
    state.frameDirty = false;
  }
  updateBodies(t);
  // Reduced motion: redraw once a second instead of every animation frame.
  if (!reducedMotion.matches || now - lastDraw > 1000) {
    draw(t);
    lastDraw = now;
  }
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Panel

const clockFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
const tzName = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date())
  .find((p) => p.type === 'timeZoneName')?.value ?? '';

function updatePanel(t) {
  const d = new Date(t);
  $('clock').textContent = clockFmt.format(d);
  $('clock-offset').textContent = F.offset(state.offsetMin);
  $('clock-offset').classList.toggle('accent', state.offsetMin !== 0);
  $('date').textContent = dateFmt.format(d);
  $('tz').textContent = `Device time · ${tzName}`;
  const sun = state.bodies.find((b) => b.id === 'sun');
  const moon = state.bodies.find((b) => b.id === 'moon');
  if (sun) $('sun-state').textContent = `${F.signedDeg(sun.el)} · ${twilight(sun.el)}`;
  if (moon) $('moon-state').textContent = `${moonPhaseName(state.moonPhase)} · ${Math.round(moon.phase * 100)}%`;

  updateSelectedCard(t);
  if (performance.now() - state.lastList > 1500) {
    updateLists();
    state.lastList = performance.now();
  }
}

/**
 * The selection card refreshes every 500 ms. Rewrite it only when the markup
 * changes, so buttons inside it keep keyboard focus and clicks aren't lost.
 */
function setHtml(el, html) {
  if (el.dataset.html === html) return;
  el.innerHTML = html;
  el.dataset.html = html;
}

function updateSelectedCard(t) {
  const sel = state.selected;
  const box = $('selected');
  const now = new Date(t);
  if (!sel) {
    $('selected-kind').textContent = '';
    setHtml(box, `<p class="empty">Tap an object on the chart, or pick one from the list.</p>${issTeaser(t)}`);
    return;
  }
  if (sel.type === 'sat') {
    const st = selectedSatState(t);
    if (!st) { setHtml(box, '<p class="empty">No valid elements for this object.</p>'); return; }
    const passes = passesFor(st.entry, t);
    $('selected-kind').textContent = st.entry.kind === 'swarm' ? 'Starlink' : 'Satellite';
    setHtml(box, satelliteCard({
      id: st.entry.id, name: st.entry.name, intlId: st.entry.intlId, groups: st.entry.groups,
      state: st.state, lit: st.lit, epoch: st.entry.epoch, passes,
    }, now));
  } else if (sel.type === 'body') {
    const b = state.bodies.find((x) => x.id === sel.id);
    if (!b) return;
    $('selected-kind').textContent = sel.id === 'sun' ? 'Sun' : sel.id === 'moon' ? 'Moon' : 'Planet';
    setHtml(box, bodyCard(b, { riseSet: riseSetFor(b, t), phaseName: moonPhaseName(state.moonPhase) }, now));
  } else {
    const s = state.stars.find((x) => x.name === sel.id);
    if (!s) return;
    $('selected-kind').textContent = 'Star';
    setHtml(box, starCard(s));
  }
}

/** "Next ISS pass" card shown while nothing is selected. */
function issTeaser(t) {
  const iss = state.catalog.get(ISS_ID);
  if (!iss) return '';
  const result = passesFor(iss, t);
  if (!result) return '<div class="teaser"><span class="label">Next ISS pass</span><p class="meta">Computing…</p></div>';
  const p = result.passes[0];
  if (!p) return '<div class="teaser"><span class="label">Next ISS pass</span><p class="meta">None above the horizon in the next 24 h.</p></div>';
  const d = p.start;
  const when = p.inProgress ? 'Overhead now' : d.toLocaleTimeString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const vis = p.visible ? '<span class="accent">visible to the eye</span>' : 'not visible (daylight or Earth\u2019s shadow)';
  return `<div class="teaser">
    <span class="label">Next ISS pass · ${esc(state.observer.name)}</span>
    <div class="when">${when} <small class="label">${p.inProgress ? '' : F.relative(d - t)}</small></div>
    <p class="meta">max ${F.deg(p.maxEl, 0)} · ${vis}</p>
    <button type="button" class="btn" data-select-iss>Select ISS</button>
  </div>`;
}

/** Passes are expensive-ish: cache per object/observer and refresh lazily. */
function passesFor(entry, t) {
  const c = state.passCache;
  const fresh = c && c.id === entry.id && c.obsKey === obsKey()
    && t >= c.t && (c.result === null || t < c.validUntil);
  if (fresh) return c.result;
  state.passCache = { id: entry.id, obsKey: obsKey(), t, result: null, validUntil: Infinity };
  const job = state.passCache;
  setTimeout(() => {
    if (state.passCache !== job) return;
    const rec = satrecFor(entry);
    const obs = state.observer;
    job.result = findPasses(rec, new Date(t), obs, {
      hours: 24, maxPasses: 4, sunAltitude: (date) => sunAltitude(date, obs),
    });
    const first = job.result.passes[0];
    // Recompute once the first pass is over, or after 10 simulated minutes.
    job.validUntil = Math.min(first?.end?.getTime() ?? Infinity, t + 10 * 60000);
    updateSelectedCard(simNow());
  }, 0);
  return null;
}

function riseSetFor(b, t) {
  const key = `${b.id}|${obsKey()}`;
  const c = state.riseSet;
  if (c && c.key === key && t >= c.t && t < c.t + 30 * 60000) return c.value;
  const def = { id: b.id, name: b.name, body: b.body };
  state.riseSet = { key, t, value: nextRiseSet(def, new Date(t), state.observer) };
  return state.riseSet.value;
}

const obsKey = () => `${state.observer.lat.toFixed(4)},${state.observer.lon.toFixed(4)}`;

function upNowItems() {
  const items = [];
  if (state.layers.planets) {
    for (const b of state.bodies) if (b.el >= 0) items.push({ key: `body:${b.id}`, name: b.name, az: b.az, el: b.el });
  }
  for (const s of state.visibleSats ?? []) {
    if (s.entry.kind === 'swarm') continue;
    items.push({ key: `sat:${s.entry.id}`, name: s.entry.name, az: s.az, el: s.el });
  }
  items.sort((a, b) => b.el - a.el);
  return items;
}

function updateLists() {
  const sel = state.selected ? `${state.selected.type}:${state.selected.id}` : null;
  renderObjectList($('objects'), upNowItems().slice(0, 80), sel);
  // Layer counts
  const counts = { stations: 0, visual: 0, starlink: 0, planets: 0 };
  for (const s of state.visibleSats ?? []) for (const g of s.entry.groups) counts[g]++;
  counts.planets = state.bodies.filter((b) => b.el >= 0).length;
  for (const [g, n] of Object.entries(counts)) {
    const el = document.querySelector(`[data-count="${g}"]`);
    if (!el) continue;
    const loaded = g === 'planets' || state.loaded[g];
    el.textContent = !state.layers[g] ? 'off' : loaded ? `${n} up` : loading.has(g) ? 'loading' : '—';
  }
  const tracked = [...state.catalog.values()].filter((e) => e.mask & enabledMask()).length;
  const up = (state.visibleSats?.length ?? 0) + (state.layers.planets ? counts.planets : 0);
  $('fig-count').textContent = `${tracked.toLocaleString('en-US')} tracked · ${up.toLocaleString('en-US')} above horizon`;
}

function updateDataStatus() {
  const el = $('tb-data');
  const entries = Object.values(state.loaded);
  if (!entries.length) return;
  const snapshot = entries.find((e) => e.source === 'snapshot');
  const stale = entries.find((e) => e.source === 'cache-stale');
  const newest = Math.max(...entries.map((e) => e.fetchedAt));
  const when = new Date(newest).toISOString().slice(0, 16).replace('T', ' ');
  if (snapshot) {
    const day = new Date(snapshot.fetchedAt).toISOString().slice(0, 16).replace('T', ' ');
    el.textContent = snapshot.error ? `Snapshot ${day} UTC · CelesTrak unreachable` : `Snapshot ${day} UTC`;
    el.classList.add('warn');
  } else if (stale) {
    el.textContent = `CelesTrak · cached ${when} UTC (refresh failed)`;
    el.classList.add('warn');
  } else {
    el.textContent = `CelesTrak GP · ${when} UTC`;
    el.classList.remove('warn');
  }
  el.title = entries.map((e) => `${e.source}${e.error ? `: ${e.error.message}` : ''}`).join('\n');
}

// ---------------------------------------------------------------------------
// Selection

function select(ref, { announce = true } = {}) {
  state.selected = ref;
  state.track = null;
  state.lastList = 0;
  updatePanel(simNow());
  draw(simNow());
  if (announce && ref) {
    const label = ref.type === 'sat' ? state.catalog.get(ref.id)?.name : ref.type === 'body'
      ? state.bodies.find((b) => b.id === ref.id)?.name : ref.id;
    $('live').textContent = `${label} selected.`;
  }
}

function refFromKey(key) {
  const [type, id] = key.split(':');
  return { type, id: type === 'sat' ? Number(id) : id };
}

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const hit = dome.hitTest(e.clientX - r.left, e.clientY - r.top, e.pointerType === 'touch' ? 26 : 16);
  select(hit);
});

canvas.addEventListener('keydown', (e) => {
  const items = upNowItems();
  if (!items.length) return;
  const cur = state.selected ? items.findIndex((i) => i.key === `${state.selected.type}:${state.selected.id}`) : -1;
  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % items.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (cur - 1 + items.length) % items.length;
  else if (e.key === 'Escape') { select(null); e.preventDefault(); return; }
  else if (e.key === 'Enter' && state.selected) { $('selected-block').scrollIntoView({ block: 'nearest' }); return; }
  if (next === null) return;
  e.preventDefault();
  const it = items[next];
  select(refFromKey(it.key));
  $('live').textContent = `${it.name}, elevation ${Math.round(it.el)} degrees, azimuth ${Math.round(it.az)} degrees.`;
});

$('selected').addEventListener('click', (e) => {
  if (e.target.closest('[data-select-iss]')) select({ type: 'sat', id: ISS_ID });
});

$('objects').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-key]');
  if (btn) select(refFromKey(btn.dataset.key));
});

// ---------------------------------------------------------------------------
// Layers

const LAYER_INFO = {
  stations: ['Space stations', 'ISS and other crewed stations', '<svg class="glyph" width="10" height="10" aria-hidden="true"><path d="M5 0L10 5L5 10L0 5Z" fill="var(--accent)"/></svg>'],
  visual: ['Brightest', 'CelesTrak “visual”: ~150 naked-eye objects', '<svg class="glyph" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="2.5" fill="currentColor"/></svg>'],
  starlink: ['Starlink', '~11,000 satellites · 1.6 MB, loaded on demand', '<svg class="glyph" width="10" height="10" aria-hidden="true"><rect x="4" y="4" width="2" height="2" fill="currentColor"/></svg>'],
  planets: ['Sun, Moon & planets', 'astronomy-engine ephemeris', '<svg class="glyph" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor"/><circle cx="5" cy="5" r="2" fill="currentColor"/></svg>'],
};

function renderLayers() {
  $('layers').innerHTML = Object.entries(LAYER_INFO).map(([k, [name, sub, glyph]]) => `
    <li><label class="toggle">
      <input type="checkbox" data-layer="${k}" ${state.layers[k] ? 'checked' : ''}>
      <span class="box" aria-hidden="true"></span>
      <span class="name">${glyph}${name}<small>${sub}</small></span>
      <span class="count" data-count="${k}">—</span>
    </label></li>`).join('');
  $('layers').addEventListener('change', (e) => {
    const k = e.target.dataset.layer;
    if (!k) return;
    state.layers[k] = e.target.checked;
    store.set('layers', state.layers);
    if (k in MASK && state.layers[k]) ensureGroup(k);
    state.frameDirty = true;
    state.lastList = 0;
  });
}

// ---------------------------------------------------------------------------
// Time scrubber

const scrub = $('scrub');
scrub.addEventListener('input', () => {
  state.offsetMin = Number(scrub.value);
  state.frameDirty = true;
  state.track = null;
  updatePanel(simNow());
});
$('now-btn').addEventListener('click', () => {
  scrub.value = '0';
  state.offsetMin = 0;
  state.frameDirty = true;
  state.track = null;
  updatePanel(simNow());
});

// ---------------------------------------------------------------------------
// Observer location

function setObserver(obs, { persist = true } = {}) {
  state.observer = obs;
  if (persist) store.set('observer', obs);
  state.frameDirty = true;
  state.track = null;
  state.passCache = null;
  state.bodiesAt = 0;
  renderObserver();
}

function renderObserver() {
  const o = state.observer;
  $('place').textContent = o.name;
  $('coords').textContent = F.latLon(o.lat, o.lon, 2);
  $('fig-place').innerHTML = `${esc(o.name)}<span class="coords-part"> · ${F.latLon(o.lat, o.lon, 2)}</span>`;
  $('city').value = CITIES.some((c) => c.id === o.id) ? o.id : 'custom';
  $('lat').value = o.lat;
  $('lon').value = o.lon;
}

$('city').innerHTML = CITIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')
  + '<option value="custom" disabled>Custom location</option>';
$('city').addEventListener('change', (e) => {
  const c = CITIES.find((x) => x.id === e.target.value);
  if (c) setObserver({ ...c });
});

$('manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const lat = Number($('lat').value), lon = Number($('lon').value);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) { toast('Latitude must be within ±90°, longitude within ±180°.'); return; }
  setObserver({ id: 'custom', name: 'Custom', lat, lon, height: 0 });
});

$('locate').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { toast('Geolocation is not available in this browser.'); return; }
  $('locate').disabled = true;
  navigator.geolocation.getCurrentPosition((pos) => {
    $('locate').disabled = false;
    const { latitude, longitude, altitude } = pos.coords;
    setObserver({
      id: 'gps', name: 'My location',
      lat: Math.round(latitude * 1e4) / 1e4, lon: Math.round(longitude * 1e4) / 1e4,
      height: Number.isFinite(altitude) ? altitude / 1000 : 0,
    });
    toast('Location set. It stays in this browser only.', 3000);
  }, (err) => {
    $('locate').disabled = false;
    toast(err.code === 1 ? 'Location permission denied. Pick a city or enter coordinates.' : `Could not get location: ${err.message}`, 5000);
  }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
});

// ---------------------------------------------------------------------------
// Theme

const THEMES = ['system', 'dark', 'light'];
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('theme-toggle').setAttribute('aria-label', `Color theme: ${t === 'system' ? 'follow system' : t}. Click to change.`);
  $('theme-toggle').title = `Theme: ${t}`;
  dome.refreshTheme();
  draw(simNow());
}
let theme = document.documentElement.dataset.theme ?? 'system';
$('theme-toggle').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  store.set('theme', theme);
  try { localStorage.setItem('overhead:theme', theme); } catch { /* ignore */ }
  applyTheme(theme);
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme(theme));

// ---------------------------------------------------------------------------
// Toast

let toastTimer;
function toast(msg, ms = 0) {
  const el = $('toast');
  clearTimeout(toastTimer);
  if (!msg) { el.hidden = true; return; }
  el.textContent = msg;
  el.hidden = false;
  if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------------------------------------------------------------------------
// Boot

renderLayers();
renderObserver();
applyTheme(theme);
updateBodies(simNow());
requestAnimationFrame(tick);
// Panel readouts tick on a timer so they keep updating under reduced motion
// and when animation frames are throttled.
setInterval(() => updatePanel(simNow()), 500);

(async () => {
  const groups = Object.keys(MASK).filter((g) => state.layers[g]);
  await Promise.all(groups.map(ensureGroup));
  const sel = params.get('sel');
  if (sel) {
    const n = Number(sel);
    if (Number.isFinite(n) && state.catalog.has(n)) select({ type: 'sat', id: n }, { announce: false });
    else if (state.bodies.some((b) => b.id === sel)) select({ type: 'body', id: sel }, { announce: false });
  }
})();

export { state, select };
