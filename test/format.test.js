import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/lib/format.js';
import { CITIES, DEFAULT_CITY } from '../src/lib/cities.js';

test('angles and distances', () => {
  assert.equal(f.azimuth(5.04), '005.0° N');
  assert.equal(f.azimuth(225), '225.0° SW');
  assert.equal(f.signedDeg(-3.25), '−3.3°'); // Intl rounds half-even-ish; display only
  assert.equal(f.km(421.37), '421 km');
  assert.equal(f.km(42.37), '42.4 km');
  assert.equal(f.km(35786.2), '35,786 km');
  assert.equal(f.distance(384400), '384,400 km');
  assert.equal(f.distance(149597870.7 * 5.2), '5.20 AU');
  assert.equal(f.kmPerS(-6.123), '−6.12 km/s');
  assert.equal(f.magnitude(-2.14), '−2.1');
  assert.equal(f.latLon(9.03, 38.74), '9.0300° N, 38.7400° E');
  assert.equal(f.latLon(-33.87, -46.6, 2), '33.87° S, 46.60° W');
});

test('relative times and offsets', () => {
  assert.equal(f.relative(10_000), 'now');
  assert.equal(f.relative(4 * 60_000), 'in 4 min');
  assert.equal(f.relative(65 * 60_000), 'in 1 h 05 min');
  assert.equal(f.relative(-3 * 60_000), '3 min ago');
  assert.equal(f.duration(272_000), '4m 32s');
  assert.equal(f.offset(0), 'Live');
  assert.equal(f.offset(125), 'T+2h 05m');
  assert.equal(f.offset(-30), 'T−0h 30m');
  assert.equal(f.ageDays(0, 86400000 * 0.42), '0.4 d');
});

test('city list is sane and defaults to Addis Ababa', () => {
  assert.equal(DEFAULT_CITY.name, 'Addis Ababa');
  assert.deepEqual([DEFAULT_CITY.lat, DEFAULT_CITY.lon], [9.03, 38.74]);
  assert.equal(new Set(CITIES.map((c) => c.id)).size, CITIES.length);
  for (const c of CITIES) assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180);
});
