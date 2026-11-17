// Instrument-panel rendering: the selected-object card, layer counts, the
// "up now" list and the clock block. Plain DOM, keyed updates.

import * as F from '../lib/format.js';
import { compassPoint } from '../lib/angles.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;

function timeHM(d) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function dayShort(d, ref) {
  const same = d.toDateString() === ref.toDateString();
  return same ? '' : `${d.toLocaleDateString('en-US', { weekday: 'short' })} `;
}

/** Card for a satellite. info comes from main.js (exact SGP4 state + passes). */
export function satelliteCard(info, now) {
  const s = info.state;
  const up = s.el >= 0;
  const groups = [...info.groups].map((g) => ({ stations: 'Station', visual: 'Bright', starlink: 'Starlink' })[g]).join(' · ');
  let passes = '';
  if (info.passes === null) {
    passes = '<p class="note">Computing passes…</p>';
  } else if (info.passes.alwaysUp) {
    passes = '<p class="note">Above the horizon for the whole next 24 h (high orbit).</p>';
  } else if (info.passes.neverUp || info.passes.passes.length === 0) {
    passes = '<p class="note">No passes above the horizon in the next 24 h from here.</p>';
  } else {
    passes = `<ul class="passes" aria-label="Upcoming passes">${info.passes.passes.slice(0, 3).map((p) => {
      const vis = p.visible === undefined ? '' : p.visible
        ? '<span class="tag vis" title="Sunlit while your sky is dark">Visible</span>'
        : '<span class="tag dim" title="In daylight or in Earth’s shadow">Not visible</span>';
      const when = p.inProgress ? 'In progress' : `${dayShort(p.start, now)}${timeHM(p.start)}`;
      const end = p.end ? `${timeHM(p.end)} set ${Math.round(p.endAz)}°` : 'beyond 24 h';
      return `<li><span class="when">${when} <small class="label">${p.inProgress ? '' : F.relative(p.start - now)}</small></span>${vis}
        <span class="meta">rise ${Math.round(p.startAz)}° → max ${F.deg(p.maxEl, 0)} at ${timeHM(p.peak)} → ${end}</span></li>`;
    }).join('')}</ul>`;
  }
  return `
    <h3 class="selected-name">${esc(info.name)}</h3>
    <p class="selected-sub label">NORAD ${info.id} · ${esc(info.intlId ?? '')} · ${groups}</p>
    <dl class="readout">
      ${row('Elevation', `<span class="${up ? 'accent' : ''}">${F.signedDeg(s.el)}</span>${up ? '' : ' <small>below horizon</small>'}`)}
      ${row('Azimuth', F.azimuth(s.az))}
      ${row('Range', F.km(s.range))}
      ${row('Range rate', `${F.kmPerS(s.rangeRate)} <small>${s.rangeRate < 0 ? 'closing' : 'opening'}</small>`)}
      ${row('Altitude', F.km(s.alt))}
      ${row('Speed', F.speed(s.speed))}
      ${row('Over', F.latLon(s.lat, s.lon, 2))}
      ${row('Lighting', info.lit ? 'Sunlit' : 'In Earth’s shadow')}
      ${row('Elements', `epoch ${F.ageDays(info.epoch, now.getTime())} old`)}
    </dl>
    <h4 class="label" style="margin:16px 0 0">Next passes · 24 h · from here</h4>
    ${passes}
  `;
}

/** Card for the Sun, Moon or a planet. */
export function bodyCard(b, extra, now) {
  const up = b.el >= 0;
  const rs = extra?.riseSet;
  const fmt = (d) => (d ? `${dayShort(d, now)}${timeHM(d)} <small>${F.relative(d - now)}</small>` : '—');
  return `
    <h3 class="selected-name">${esc(b.name)}</h3>
    <p class="selected-sub label">${b.id === 'sun' ? 'Star' : b.id === 'moon' ? `Moon · ${esc(extra?.phaseName ?? '')}` : 'Planet'}</p>
    <dl class="readout">
      ${row('Elevation', `<span class="${up ? 'accent' : ''}">${F.signedDeg(b.el)}</span>${up ? '' : ' <small>below horizon</small>'}`)}
      ${row('Azimuth', F.azimuth(b.az))}
      ${row('Distance', F.distance(b.distKm))}
      ${row('Magnitude', F.magnitude(b.mag))}
      ${b.id !== 'sun' ? row('Illuminated', `${Math.round(b.phase * 100)}%`) : ''}
      ${row('Rises', fmt(rs?.rise))}
      ${row('Sets', fmt(rs?.set))}
    </dl>
    <p class="note">Apparent position with standard refraction. Magnitudes from astronomy-engine.</p>
  `;
}

export function starCard(s) {
  return `
    <h3 class="selected-name">${esc(s.name)}</h3>
    <p class="selected-sub label">Landmark star · mag ${F.magnitude(s.mag)}</p>
    <dl class="readout">
      ${row('Elevation', F.signedDeg(s.el))}
      ${row('Azimuth', F.azimuth(s.az))}
      ${row('RA / Dec J2000', `${s.ra.toFixed(2)} h / ${F.signedDeg(s.dec, 1)}`)}
    </dl>
    <p class="note">One of 20 bright stars drawn for orientation (rounded J2000 coordinates).</p>
  `;
}

/** Keyed list of objects above the horizon. items: [{ key, name, el, az, onSelect }] */
export function renderObjectList(ul, items, selectedKey) {
  if (ul.contains(document.activeElement) && ul.dataset.keys === items.map((i) => i.key).join()) {
    // Same order and focus inside: update values in place.
    items.forEach((it, i) => {
      const btn = ul.children[i]?.firstElementChild;
      if (btn) {
        btn.querySelector('.o-el').textContent = F.deg(it.el, 0);
        btn.setAttribute('aria-current', String(it.key === selectedKey));
      }
    });
    return;
  }
  if (!items.length) {
    ul.innerHTML = '<li><p class="empty">Nothing in the enabled layers is above the horizon.</p></li>';
    ul.dataset.keys = '';
    return;
  }
  ul.innerHTML = items.map((it) => `
    <li><button type="button" data-key="${esc(it.key)}" aria-current="${it.key === selectedKey}">
      <span class="o-name">${esc(it.name)}</span>
      <span class="o-val">${compassPoint(it.az)}</span>
      <span class="o-val o-el">${F.deg(it.el, 0)}</span>
    </button></li>`).join('');
  ul.dataset.keys = items.map((i) => i.key).join();
}
