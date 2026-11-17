import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { satrecFromTle, satrecFromOmm, observe } from '../src/lib/satellites.js';
import { findPasses, sampleStepMs } from '../src/lib/passes.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/iss-wheretheiss.json', import.meta.url)));
const iss = satrecFromTle(...fx.tle);
const addis = { lat: 9.03, lon: 38.74, height: 2.355 };
const from = new Date(fx.positions[0].timestamp * 1000);

/** Brute force: scan at 5 s and collect [rise, set] intervals above 0 deg. */
function bruteForce(rec, start, hours, obs) {
  const out = [];
  let up = false, rise = null;
  for (let t = start.getTime(); t <= start.getTime() + hours * 3600e3; t += 5000) {
    const el = observe(rec, new Date(t), obs).el;
    if (el >= 0 && !up) { rise = t; up = true; }
    if (el < 0 && up) { out.push([rise, t]); up = false; }
  }
  return out;
}

test('ISS passes over Addis Ababa match a 5-second brute-force scan', () => {
  const { passes } = findPasses(iss, from, addis, { hours: 24, maxPasses: 50 });
  const brute = bruteForce(iss, from, 24, addis);
  assert.equal(passes.length, brute.length, 'same number of passes');
  passes.forEach((p, i) => {
    assert.ok(Math.abs(p.start - brute[i][0]) <= 6000, `rise ${i}`);
    assert.ok(Math.abs(p.end - brute[i][1]) <= 6000, `set ${i}`);
  });
});

test('pass geometry is self-consistent', () => {
  const { passes } = findPasses(iss, from, addis, { hours: 48, maxPasses: 50 });
  assert.ok(passes.length >= 4, 'ISS rises several times in 48 h at 9 deg N');
  for (const p of passes) {
    assert.ok(p.start < p.peak && p.peak < p.end, 'ordered');
    const dur = (p.end - p.start) / 60000;
    assert.ok(dur > 0 && dur < 12, `ISS pass lasts minutes, got ${dur}`);
    assert.ok(Math.abs(observe(iss, p.start, addis).el) < 0.05, 'AOS on the horizon');
    assert.ok(Math.abs(observe(iss, p.end, addis).el) < 0.05, 'LOS on the horizon');
    // The refined peak beats every 2 s sample of the pass.
    for (let t = p.start.getTime(); t <= p.end.getTime(); t += 2000) {
      assert.ok(observe(iss, new Date(t), addis).el <= p.maxEl + 1e-3);
    }
  }
  for (let i = 1; i < passes.length; i++) assert.ok(passes[i].start > passes[i - 1].end);
});

test('minimum elevation threshold filters low passes', () => {
  const all = findPasses(iss, from, addis, { hours: 48, maxPasses: 50 }).passes;
  const high = findPasses(iss, from, addis, { hours: 48, maxPasses: 50, minEl: 30 }).passes;
  assert.ok(high.length < all.length);
  for (const p of high) assert.ok(p.maxEl >= 30);
});

test('visibility flag respects the sun-altitude callback', () => {
  const day = findPasses(iss, from, addis, { hours: 24, sunAltitude: () => 30 }).passes;
  assert.ok(day.every((p) => p.visible === false), 'nothing is visible in daylight');
  const noFlag = findPasses(iss, from, addis, { hours: 24 }).passes;
  assert.ok(noFlag.every((p) => p.visible === undefined));
});

test('a geostationary satellite is reported as always up or never up', () => {
  // Synthetic GEO elements: circular, equatorial, 1.0027 rev/day.
  const geo = satrecFromOmm({
    OBJECT_NAME: 'GEO TEST', NORAD_CAT_ID: 99999, EPOCH: '2026-11-16T00:00:00',
    MEAN_MOTION: 1.00273791, ECCENTRICITY: 0.0001, INCLINATION: 0.05,
    RA_OF_ASC_NODE: 0, ARG_OF_PERICENTER: 0, MEAN_ANOMALY: 0, BSTAR: 0,
    MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
  });
  assert.ok(sampleStepMs(geo) >= 60000);
  const r = findPasses(geo, new Date('2026-11-17T00:00:00Z'), addis, { hours: 24 });
  assert.ok(r.alwaysUp !== r.neverUp, 'one of the two');
  assert.equal(r.passes.length, 0);
});
