#!/usr/bin/env node
// Snapshot CelesTrak GP element sets into data/snapshot/ so the site still
// works if CelesTrak is unreachable from a visitor's browser.
//
//   node scripts/snapshot.mjs            # all groups
//   node scripts/snapshot.mjs stations   # one group
//   node scripts/snapshot.mjs --input dir starlink
//       # convert a GP JSON file you already downloaded (dir/starlink.json)
//       # instead of hitting CelesTrak again; its mtime is the snapshot time
//
// Please run this rarely. CelesTrak updates GP data a few times a day and
// blocks clients that re-download unchanged data too often.

import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { GROUPS, celestrakUrl, compact, isValidGp } from '../src/lib/catalog.js';

const outDir = new URL('../data/snapshot/', import.meta.url);
const args = process.argv.slice(2);
const inputIdx = args.indexOf('--input');
const inputDir = inputIdx >= 0 ? args.splice(inputIdx, 2)[1] : null;
const groups = args.length ? args : Object.keys(GROUPS);

/** Fetch from CelesTrak, or read a previously downloaded file with --input. */
async function obtain(group, url) {
  if (inputDir) {
    const file = join(inputDir, `${group}.json`);
    return { text: await readFile(file, 'utf8'), fetchedAt: (await stat(file)).mtime };
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'overhead-snapshot (static site; run manually)' } });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  return { text, fetchedAt: new Date() };
}

await mkdir(outDir, { recursive: true });
let failed = 0;
for (const group of groups) {
  if (!GROUPS[group]) { console.error(`unknown group: ${group}`); failed++; continue; }
  const url = celestrakUrl(group);
  try {
    const { text, fetchedAt } = await obtain(group, url);
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(text.slice(0, 160)); }
    if (!isValidGp(json)) throw new Error('no usable element sets');
    const snapshot = { source: url, fetchedAt: fetchedAt.toISOString(), count: json.length, data: compact(json) };
    await writeFile(new URL(`${group}.json`, outDir), JSON.stringify(snapshot));
    console.log(`${group}: ${json.length} objects`);
  } catch (e) {
    console.error(`${group}: kept previous snapshot (${e.message})`);
    failed++;
  }
}
process.exitCode = failed ? 1 : 0;
