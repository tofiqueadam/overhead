// Module worker: owns the satrecs and answers frame requests.
import { buildEntries, computeFrame } from './frame.js';

let entries = [];

self.onmessage = ({ data: msg }) => {
  if (msg.type === 'catalog') {
    entries = buildEntries(msg.records);
    self.postMessage({ type: 'catalog', count: entries.length });
  } else if (msg.type === 'frame') {
    const started = performance.now();
    const f = computeFrame(entries, msg.enabledMask, msg.observer, msg.t0, msg.dt);
    self.postMessage(
      { type: 'frame', id: msg.id, ...f, ms: performance.now() - started },
      [f.ids.buffer, f.data.buffer],
    );
  }
};
