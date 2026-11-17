import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGroup, compact, expand, isFresh, isValidGp, mergeGroups, CACHE_TTL_MS, CACHE_PREFIX, celestrakUrl,
} from '../src/lib/catalog.js';

const ISS = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544, EPOCH: '2026-11-16T21:11:37.723200',
  MEAN_MOTION: 15.49421361, ECCENTRICITY: 0.00073883, INCLINATION: 51.632, RA_OF_ASC_NODE: 264.4586,
  ARG_OF_PERICENTER: 33.7322, MEAN_ANOMALY: 326.4135, BSTAR: 0.00016897994, MEAN_MOTION_DOT: 9.012e-5,
  MEAN_MOTION_DDOT: 0, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
};
const POISK = { ...ISS, OBJECT_NAME: 'POISK', OBJECT_ID: '2009-060A', NORAD_CAT_ID: 36086 };

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    const [status, body] = hit[1];
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status === 200, status, text: async () => text, json: async () => JSON.parse(text) };
  };
  fn.calls = calls;
  return fn;
}

test('compact/expand round trip keeps SGP4 fields and drops the rest', () => {
  const back = expand(compact([ISS]))[0];
  assert.equal(back.MEAN_MOTION, ISS.MEAN_MOTION);
  assert.equal(back.EPOCH, ISS.EPOCH);
  assert.equal(back.CLASSIFICATION_TYPE, undefined);
});

test('freshness window', () => {
  assert.ok(isFresh({ fetchedAt: 1000 }, 1000 + CACHE_TTL_MS - 1));
  assert.ok(!isFresh({ fetchedAt: 1000 }, 1000 + CACHE_TTL_MS));
  assert.ok(!isFresh({ fetchedAt: 5000 }, 1000), 'clock went backwards: refetch');
  assert.ok(!isFresh(null, 0));
});

test('validates CelesTrak payloads', () => {
  assert.ok(isValidGp([ISS]));
  assert.ok(!isValidGp([]));
  assert.ok(!isValidGp({ error: 'x' }));
  assert.ok(!isValidGp([{ OBJECT_NAME: 'x' }]));
});

test('fetches once, then serves from cache until the TTL expires', async () => {
  const storage = new MemStorage();
  const fetchFn = fakeFetch({ 'celestrak.org': [200, [ISS]] });
  const a = await loadGroup('stations', { fetchFn, storage, now: 0 });
  assert.equal(a.source, 'celestrak');
  assert.equal(fetchFn.calls[0], celestrakUrl('stations'));
  const b = await loadGroup('stations', { fetchFn, storage, now: CACHE_TTL_MS - 1 });
  assert.equal(b.source, 'cache');
  assert.equal(fetchFn.calls.length, 1, 'no second network request');
  const c = await loadGroup('stations', { fetchFn, storage, now: CACHE_TTL_MS + 1 });
  assert.equal(c.source, 'celestrak');
  assert.equal(fetchFn.calls.length, 2);
});

test('throttled (plain-text) response falls back to the stale cache', async () => {
  const storage = new MemStorage();
  storage.setItem(CACHE_PREFIX + 'stations', JSON.stringify({ fetchedAt: 0, data: compact([ISS]) }));
  const fetchFn = fakeFetch({ 'celestrak.org': [200, 'GP data has not updated since your last successful download'] });
  const r = await loadGroup('stations', { fetchFn, storage, now: CACHE_TTL_MS * 3 });
  assert.equal(r.source, 'cache-stale');
  assert.equal(r.records[0].NORAD_CAT_ID, 25544);
  assert.match(r.error.message, /not updated/);
});

test('no network and no cache falls back to the committed snapshot', async () => {
  const snap = { fetchedAt: '2026-11-17T08:00:00Z', data: compact([ISS]) };
  const fetchFn = fakeFetch({ 'celestrak.org': [403, 'Forbidden'], 'snapshot/stations.json': [200, snap] });
  const r = await loadGroup('stations', { fetchFn, storage: new MemStorage(), now: 0 });
  assert.equal(r.source, 'snapshot');
  assert.equal(r.fetchedAt, Date.parse('2026-11-17T08:00:00Z'));
});

test('a storage that throws (private mode, quota) does not break loading', async () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  const r = await loadGroup('stations', { fetchFn: fakeFetch({ 'celestrak.org': [200, [ISS]] }), storage, now: 0 });
  assert.equal(r.source, 'celestrak');
});

test('merge collapses duplicate ids and identical element sets', () => {
  const merged = mergeGroups({ stations: [ISS, POISK], visual: [ISS] });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'ISS (ZARYA)');
  assert.deepEqual([...merged[0].groups].sort(), ['stations', 'visual']);
});

test('snapshotOnly never calls CelesTrak', async () => {
  const snap = { fetchedAt: '2026-11-17T08:00:00Z', data: compact([ISS]) };
  const fetchFn = fakeFetch({ 'celestrak.org': [200, [ISS]], 'snapshot/stations.json': [200, snap] });
  const r = await loadGroup('stations', { fetchFn, storage: new MemStorage(), now: 0, snapshotOnly: true });
  assert.equal(r.source, 'snapshot');
  assert.ok(fetchFn.calls.every((u) => !u.includes('celestrak.org')));
});
