import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  domeProject, domeUnproject, deviceToWorld, aimAt, lookDirection, cameraProject, focalLength,
  alphaFromCompassHeading,
} from '../src/lib/projection.js';
import { separation } from '../src/lib/angles.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

test('dome: zenith at centre, horizon on the rim, north up, east left', () => {
  const z = domeProject(123, 90, 100, 100, 50);
  close(z.x, 100, 1e-9); close(z.y, 100, 1e-9);
  const n = domeProject(0, 0, 100, 100, 50);
  close(n.x, 100, 1e-9); close(n.y, 50, 1e-9);
  const e = domeProject(90, 0, 100, 100, 50);
  close(e.x, 50, 1e-9, 'east on the left'); close(e.y, 100, 1e-9);
  const s = domeProject(180, 45, 100, 100, 50);
  close(s.y, 125, 1e-9, '45 deg is half way out');
});

test('dome: unproject inverts project', () => {
  for (const [az, el] of [[10, 10], [200, 70], [300, 1], [90, 45]]) {
    const p = domeProject(az, el, 0, 0, 300);
    const q = domeUnproject(p.x, p.y, 0, 0, 300);
    close(q.az, az, 1e-9); close(q.el, el, 1e-9);
  }
});

test('device orientation: flat phone looks at the ground', () => {
  close(lookDirection(deviceToWorld(0, 0, 0)).el, -90, 1e-9);
});

test('device orientation: upright phone looks at the horizon in alpha direction', () => {
  const north = lookDirection(deviceToWorld(0, 90, 0));
  close(north.el, 0, 1e-9); assert.ok(north.az < 1e-6 || north.az > 360 - 1e-6);
  // alpha grows counter-clockwise, so alpha 90 means the top points west
  const west = lookDirection(deviceToWorld(90, 90, 0));
  close(west.az, 270, 1e-9);
  // tilting back 45 deg past vertical raises the view 45 deg
  close(lookDirection(deviceToWorld(0, 135, 0)).el, 45, 1e-9);
});

test('device orientation: landscape screen rotation keeps the view direction', () => {
  const a = lookDirection(deviceToWorld(30, 100, 0, 0));
  const b = lookDirection(deviceToWorld(30, 100, 0, 90));
  close(separation(a.az, a.el, b.az, b.el), 0, 1e-9);
});

test('iOS compass heading converts to absolute alpha', () => {
  assert.equal(alphaFromCompassHeading(0), 0);
  assert.equal(alphaFromCompassHeading(90), 270); // facing east
  const east = lookDirection(deviceToWorld(alphaFromCompassHeading(90), 90, 0));
  close(east.az, 90, 1e-9);
});

test('camera: aimAt round-trips and centres the target', () => {
  for (const [az, el] of [[0, 0], [75, 30], [250, -10], [180, 89.9]]) {
    const R = aimAt(az, el);
    const d = lookDirection(R);
    close(separation(d.az, d.el, az, el), 0, 1e-6, `look ${az},${el}`);
    const p = cameraProject(az, el, R, 500, 200, 300);
    assert.ok(p.front);
    close(p.x, 200, 1e-6); close(p.y, 300, 1e-6);
  }
});

test('camera: right is right, up is up, behind is flagged', () => {
  const R = aimAt(0, 20); // facing north
  const right = cameraProject(10, 20, R, 500, 0, 0);
  assert.ok(right.x > 0, 'something to the east appears to the right');
  const up = cameraProject(0, 30, R, 500, 0, 0);
  assert.ok(up.y < 0, 'higher elevation appears higher on screen');
  assert.equal(cameraProject(180, 0, R, 500, 0, 0).front, false);
});

test('camera: phone and drag matrices agree for an upright phone', () => {
  const phone = deviceToWorld(0, 90, 0);
  const drag = aimAt(0, 0);
  for (let i = 0; i < 9; i++) close(phone[i], drag[i], 1e-9, `m${i}`);
});

test('focal length from field of view', () => {
  close(focalLength(600, 90), 300, 1e-9);
});
