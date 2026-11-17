// Loading CelesTrak GP (general perturbations) element sets, politely.
//
// CelesTrak asks clients not to re-download data that has not changed (GP
// sets update a few times a day) and blocks IPs that poll aggressively. So:
//   1. a localStorage copy younger than CACHE_TTL is used as-is;
//   2. otherwise we fetch once from CelesTrak (CORS is allowed: ACAO *);
//   3. if that fails we fall back to a stale cached copy, and finally to the
//      snapshot committed in data/snapshot/ (its date is shown in the UI).
// I/O is injected (fetch, storage, clock) so the policy is unit-testable.

import { OMM_FIELDS } from './satellites.js';

export const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php';
export const CACHE_TTL_MS = 4 * 3600 * 1000;
export const CACHE_PREFIX = 'overhead:gp:';

export const GROUPS = {
  stations: { label: 'Stations', celestrak: 'stations' },
  visual: { label: 'Brightest', celestrak: 'visual' },
  starlink: { label: 'Starlink', celestrak: 'starlink' },
};

export function celestrakUrl(group) {
  return `${CELESTRAK_GP}?GROUP=${encodeURIComponent(GROUPS[group].celestrak)}&FORMAT=json`;
}

/** Keep only the OMM fields SGP4 needs, as a compact table (~3x smaller). */
export function compact(records) {
  return { fields: OMM_FIELDS, rows: records.map((r) => OMM_FIELDS.map((f) => r[f] ?? null)) };
}

export function expand(table) {
  return table.rows.map((row) => Object.fromEntries(table.fields.map((f, i) => [f, row[i]])));
}

/** A response is usable if it is a non-empty array of OMM-looking records. */
export function isValidGp(json) {
  return Array.isArray(json) && json.length > 0
    && json.every((r) => r && typeof r.NORAD_CAT_ID === 'number' && typeof r.EPOCH === 'string'
      && typeof r.MEAN_MOTION === 'number');
}

export function isFresh(entry, now, ttl = CACHE_TTL_MS) {
  return !!entry && typeof entry.fetchedAt === 'number' && now - entry.fetchedAt < ttl && now >= entry.fetchedAt;
}

function readCache(storage, group) {
  try {
    const raw = storage?.getItem(CACHE_PREFIX + group);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(storage, group, entry) {
  try {
    storage?.setItem(CACHE_PREFIX + group, JSON.stringify(entry));
    return true;
  } catch {
    return false; // quota exceeded or storage disabled: keep it in memory only
  }
}

/**
 * Load one group. Resolves to
 * { records, source: 'cache'|'celestrak'|'cache-stale'|'snapshot', fetchedAt, error? }.
 */
export async function loadGroup(group, {
  fetchFn = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  now = Date.now(),
  snapshotBase = 'data/snapshot/',
  force = false,
  snapshotOnly = false, // development / screenshots: never touch CelesTrak
} = {}) {
  if (snapshotOnly) return loadSnapshot(group, fetchFn, snapshotBase);
  const cached = readCache(storage, group);
  if (!force && isFresh(cached, now)) {
    return { records: expand(cached.data), source: 'cache', fetchedAt: cached.fetchedAt };
  }

  let error;
  try {
    const res = await fetchFn(celestrakUrl(group), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
    // When throttled CelesTrak answers with a plain-text notice, not JSON.
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`CelesTrak: ${text.slice(0, 120)}`); }
    if (!isValidGp(json)) throw new Error('CelesTrak returned no usable element sets');
    const data = compact(json);
    writeCache(storage, group, { fetchedAt: now, data });
    return { records: expand(data), source: 'celestrak', fetchedAt: now };
  } catch (e) {
    error = e;
  }

  if (cached?.data) {
    return { records: expand(cached.data), source: 'cache-stale', fetchedAt: cached.fetchedAt, error };
  }

  return loadSnapshot(group, fetchFn, snapshotBase, error);
}

async function loadSnapshot(group, fetchFn, snapshotBase, error) {
  const res = await fetchFn(`${snapshotBase}${group}.json`);
  if (!res.ok) throw new Error(`No data for ${group}: ${error?.message ?? ''} snapshot HTTP ${res.status}`);
  const snap = await res.json();
  return { records: expand(snap.data), source: 'snapshot', fetchedAt: Date.parse(snap.fetchedAt), error };
}

/**
 * Merge several loaded groups into one catalogue keyed by NORAD id, recording
 * group membership. Objects that share identical elements (e.g. ISS modules
 * listed separately under one element set) are collapsed onto the first name.
 */
export function mergeGroups(loaded) {
  const byId = new Map();
  const bySignature = new Map();
  for (const [group, records] of Object.entries(loaded)) {
    for (const r of records) {
      const sig = `${r.EPOCH}|${r.MEAN_ANOMALY}|${r.RA_OF_ASC_NODE}|${r.MEAN_MOTION}`;
      const existing = byId.get(r.NORAD_CAT_ID) ?? bySignature.get(sig);
      if (existing) { existing.groups.add(group); continue; }
      const entry = { id: r.NORAD_CAT_ID, name: r.OBJECT_NAME, intlId: r.OBJECT_ID, omm: r, groups: new Set([group]) };
      byId.set(r.NORAD_CAT_ID, entry);
      bySignature.set(sig, entry);
    }
  }
  return [...byId.values()];
}
