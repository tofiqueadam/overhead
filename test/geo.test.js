import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  geodeticToEcef, ecefToGeodetic, lookAngles, azElToEnu, enuToAzEl, eciToEcef, WGS84_A,
} from '../src/lib/geo.js';
import { wrap360, wrap180, separation, compassPoint, angleDiff } from '../src/lib/angles.js';
import { ecfToLookAngles } from '../vendor/satellite.js-7.1.0/transforms.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

test('angle wrapping', () => {
  assert.equal(wrap360(-10), 350);
  assert.equal(wrap360(720), 0);
  assert.equal(wrap180(190), -170);
  assert.equal(angleDiff(10, 350), 20);
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(135), 'SE');
  close(separation(0, 0, 90, 0), 90, 1e-9);
  close(separation(123, 90, 7, 90), 0, 1e-6, 'zenith is one point');
});

test('geodetic -> ECEF reference points', () => {
  const eq = geodeticToEcef(0, 0, 0);
  close(eq.x, WGS84_A, 1e-9); close(eq.y, 0, 1e-9); close(eq.z, 0, 1e-9);
  const pole = geodeticToEcef(90, 0, 0);
  close(pole.z, 6356.7523142, 1e-6, 'polar radius');
  close(Math.hypot(pole.x, pole.y), 0, 1e-9);
});

test('ECEF <-> geodetic round trip', () => {
  for (const [lat, lon, h] of [[9.03, 38.74, 2.355], [-33.9, 151.2, 0], [51.5, -0.12, 420], [89.9, 10, 0]]) {
    const g = ecefToGeodetic(geodeticToEcef(lat, lon, h));
    close(g.lat, lat, 1e-9, 'lat'); close(g.lon, lon, 1e-9, 'lon'); close(g.height, h, 1e-6, 'h');
  }
});

test('look angles: straight up is the zenith, horizon directions are right', () => {
  const obs = { lat: 9.03, lon: 38.74, height: 0 };
  const up = lookAngles(obs, geodeticToEcef(9.03, 38.74, 400));
  close(up.el, 90, 1e-6, 'zenith'); close(up.range, 400, 1e-6, 'range');

  // A point far to the north on the same meridian is due north and below the
  // geometric horizon (Earth curvature).
  const north = lookAngles(obs, geodeticToEcef(20, 38.74, 0));
  close(north.az, 0, 1e-6, 'north az');
  assert.ok(north.el < 0, 'surface point beyond the horizon is below 0');

  const east = lookAngles({ lat: 0, lon: 0, height: 0 }, geodeticToEcef(0, 5, 2000));
  close(east.az, 90, 1e-6, 'east az');
  const west = lookAngles({ lat: 0, lon: 0, height: 0 }, geodeticToEcef(0, -5, 2000));
  close(west.az, 270, 1e-6, 'west az');
});

test('look angles agree with satellite.js ecfToLookAngles', () => {
  const obs = { lat: 9.03, lon: 38.74, height: 2.3 };
  const target = geodeticToEcef(14, 44, 550);
  const mine = lookAngles(obs, target);
  const theirs = ecfToLookAngles(
    { latitude: obs.lat * Math.PI / 180, longitude: obs.lon * Math.PI / 180, height: obs.height },
    target,
  );
  // satellite.js uses WGS-72 for the observer, so allow a small difference.
  close(mine.az, theirs.azimuth * 180 / Math.PI, 0.05, 'az');
  close(mine.el, theirs.elevation * 180 / Math.PI, 0.05, 'el');
  close(mine.range, theirs.rangeSat, 0.05, 'range');
});

test('az/el <-> ENU round trip', () => {
  for (const [az, el] of [[0, 0], [90, 45], [200, -10], [359, 89]]) {
    const r = enuToAzEl(azElToEnu(az, el));
    close(r.az, az, 1e-9); close(r.el, el, 1e-9); close(r.range, 1, 1e-12);
  }
});

test('ECI -> ECEF rotation by sidereal angle', () => {
  const v = eciToEcef({ x: 1, y: 0, z: 0 }, Math.PI / 2);
  close(v.x, 0, 1e-12); close(v.y, -1, 1e-12);
});
