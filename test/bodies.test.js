import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BODIES, allBodies, bodyPosition, sunAltitude, twilight, landmarkStars, nextRiseSet,
  moonPhaseName,
} from '../src/lib/bodies.js';

const addis = { lat: 9.03, lon: 38.74, height: 2.355 };

test('Sun is near the zenith at the equinox subsolar point', () => {
  // Near the March 2026 equinox the Sun's declination is ~0; at lon 0 local
  // apparent noon is ~12:07 UTC (equation of time ~ -7 min).
  const el = sunAltitude(new Date('2026-03-20T12:07:00Z'), { lat: 0, lon: 0 });
  assert.ok(el > 88, `got ${el}`);
});

test('apparent Sun is on the horizon at the predicted sunrise', () => {
  const sun = BODIES[0];
  const { rise } = nextRiseSet(sun, new Date('2026-11-17T00:00:00Z'), addis);
  const el = bodyPosition(sun, rise, addis).el;
  // Rise = upper limb on the apparent horizon, so the centre is one
  // semidiameter (~0.27 deg) below it. SearchRiseSet scales refraction by
  // air density at the observer's height (Addis is 2.3 km up) while
  // Horizon('normal') uses a sea-level model, so allow ~0.2 deg.
  assert.ok(Math.abs(el + 0.27) < 0.2, `got ${el}`);
});

test('Polaris altitude tracks the observer latitude', () => {
  for (const lat of [9.03, 40, 60]) {
    const p = landmarkStars(new Date('2026-11-17T20:00:00Z'), { lat, lon: 38.74 })
      .find((s) => s.name === 'Polaris');
    assert.ok(Math.abs(p.el - lat) < 1.2, `lat ${lat}: Polaris at ${p.el}`);
    assert.ok(p.az < 2 || p.az > 358, 'Polaris is due north');
  }
});

test('all bodies return finite positions and magnitudes', () => {
  const list = allBodies(new Date('2026-11-17T18:00:00Z'), addis);
  assert.equal(list.length, 9);
  for (const b of list) {
    for (const k of ['az', 'el', 'distKm', 'mag', 'phase']) assert.ok(Number.isFinite(b[k]), `${b.name}.${k}`);
    assert.ok(b.az >= 0 && b.az < 360);
  }
  const sun = list.find((b) => b.id === 'sun');
  assert.ok(Math.abs(sun.distKm / 149597870.7 - 0.989) < 0.01, 'Earth is near perihelion-ish in Nov');
});

test('twilight bands and phase names', () => {
  assert.equal(twilight(10), 'day');
  assert.equal(twilight(-3), 'civil twilight');
  assert.equal(twilight(-9), 'nautical twilight');
  assert.equal(twilight(-15), 'astronomical twilight');
  assert.equal(twilight(-30), 'night');
  assert.equal(moonPhaseName(0), 'New Moon');
  assert.equal(moonPhaseName(180), 'Full Moon');
  assert.equal(moonPhaseName(359), 'New Moon');
});
