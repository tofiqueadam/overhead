import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEntries, computeFrame, STRIDE } from '../src/engine/frame.js';
import { interpolate } from '../src/engine/sky-engine.js';
import { observe, satrecFromOmm } from '../src/lib/satellites.js';
import { enuToAzEl } from '../src/lib/geo.js';
import { separation } from '../src/lib/angles.js';
import { expand } from '../src/lib/catalog.js';

const snap = JSON.parse(readFileSync(new URL('../data/snapshot/visual.json', import.meta.url)));
const records = expand(snap.data).map((omm) => ({ id: omm.NORAD_CAT_ID, omm, mask: 1 }));
const obs = { lat: 9.03, lon: 38.74, height: 2.355 };
const t0 = Date.parse(snap.fetchedAt);

test('frame keeps only objects near or above the horizon', () => {
  const entries = buildEntries(records);
  assert.ok(entries.length > 100);
  const f = computeFrame(entries, 1, obs, t0, 1000);
  assert.equal(f.data.length, f.ids.length * STRIDE);
  assert.ok(f.ids.length > 0 && f.ids.length < entries.length);
  for (let i = 0; i < f.ids.length; i++) {
    assert.ok(f.data[i * STRIDE + 2] > -0.02 || f.data[i * STRIDE + 5] > -0.02);
  }
  assert.equal(computeFrame(entries, 2, obs, t0, 1000).ids.length, 0, 'group mask filters');
});

test('interpolated directions match exact propagation mid-frame', () => {
  const entries = buildEntries(records);
  const dt = 1000;
  const f = computeFrame(entries, 1, obs, t0, dt);
  for (let i = 0; i < f.ids.length; i++) {
    const rec = satrecFromOmm(records.find((r) => r.id === f.ids[i]).omm);
    const exact = observe(rec, new Date(t0 + dt / 2), obs);
    const p = enuToAzEl(interpolate(f, i, t0 + dt / 2));
    assert.ok(separation(p.az, p.el, exact.az, exact.el) < 0.01, `${f.ids[i]}`);
  }
});
