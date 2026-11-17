// Sun, Moon and planets for an observer, via astronomy-engine (pinned,
// vendored), plus a handful of bright "landmark" stars for orientation.

import * as A from '../../vendor/astronomy-engine-2.1.19/astronomy.js';

const AU_KM = 149597870.7;

/** Solar-system bodies Overhead draws, brightest-first-ish. */
export const BODIES = [
  { id: 'sun', name: 'Sun', body: A.Body.Sun },
  { id: 'moon', name: 'Moon', body: A.Body.Moon },
  { id: 'mercury', name: 'Mercury', body: A.Body.Mercury },
  { id: 'venus', name: 'Venus', body: A.Body.Venus },
  { id: 'mars', name: 'Mars', body: A.Body.Mars },
  { id: 'jupiter', name: 'Jupiter', body: A.Body.Jupiter },
  { id: 'saturn', name: 'Saturn', body: A.Body.Saturn },
  { id: 'uranus', name: 'Uranus', body: A.Body.Uranus },
  { id: 'neptune', name: 'Neptune', body: A.Body.Neptune },
];

function toObserver({ lat, lon, height = 0 }) {
  return new A.Observer(lat, lon, height * 1000);
}

/**
 * Apparent topocentric position of one body.
 * Returns { az, el, distKm, ra, dec, mag, phase } where el includes standard
 * atmospheric refraction, mag is the visual magnitude and phase the
 * illuminated fraction (0..1).
 */
export function bodyPosition(def, date, observer) {
  const obs = toObserver(observer);
  const eq = A.Equator(def.body, date, obs, true, true);
  const hor = A.Horizon(date, obs, eq.ra, eq.dec, 'normal');
  const ill = A.Illumination(def.body, date);
  return {
    az: hor.azimuth,
    el: hor.altitude,
    distKm: eq.dist * AU_KM,
    ra: eq.ra,
    dec: eq.dec,
    mag: ill.mag,
    phase: ill.phase_fraction,
  };
}

/** All bodies at once: [{ ...def, ...position }]. */
export function allBodies(date, observer) {
  return BODIES.map((def) => ({ ...def, ...bodyPosition(def, date, observer) }));
}

/** Altitude of the Sun's centre in degrees, refracted. */
export function sunAltitude(date, observer) {
  return bodyPosition(BODIES[0], date, observer).el;
}

/** Sky state from the Sun's altitude, using the standard twilight bands. */
export function twilight(sunEl) {
  if (sunEl > -0.833) return 'day';
  if (sunEl > -6) return 'civil twilight';
  if (sunEl > -12) return 'nautical twilight';
  if (sunEl > -18) return 'astronomical twilight';
  return 'night';
}

/** Moon phase angle in degrees (0 new, 90 first quarter, 180 full, 270 last quarter). */
export function moonPhaseAngle(date) {
  return A.MoonPhase(date);
}

export function moonPhaseName(angle) {
  const names = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(angle / 45) % 8];
}

/**
 * Next rise and set of a body after `date` (within ~2 days), or null.
 * Useful for the detail panel of planets.
 */
export function nextRiseSet(def, date, observer) {
  const obs = toObserver(observer);
  const rise = A.SearchRiseSet(def.body, obs, +1, date, 2);
  const set = A.SearchRiseSet(def.body, obs, -1, date, 2);
  return { rise: rise?.date ?? null, set: set?.date ?? null };
}

/**
 * Twenty of the brightest stars, J2000 right ascension (hours) and
 * declination (degrees), rounded, with approximate visual magnitudes. These
 * are orientation landmarks only, not an astrometric catalogue.
 */
export const LANDMARK_STARS = [
  ['Sirius', 6.7525, -16.716, -1.46], ['Canopus', 6.3992, -52.696, -0.74],
  ['Arcturus', 14.2610, 19.182, -0.05], ['Vega', 18.6156, 38.784, 0.03],
  ['Capella', 5.2782, 45.998, 0.08], ['Rigel', 5.2423, -8.202, 0.13],
  ['Procyon', 7.6550, 5.225, 0.34], ['Achernar', 1.6286, -57.237, 0.46],
  ['Betelgeuse', 5.9195, 7.407, 0.5], ['Hadar', 14.0637, -60.373, 0.61],
  ['Altair', 19.8464, 8.868, 0.77], ['Acrux', 12.4433, -63.099, 0.77],
  ['Aldebaran', 4.5987, 16.509, 0.85], ['Antares', 16.4901, -26.432, 0.96],
  ['Spica', 13.4199, -11.161, 0.97], ['Pollux', 7.7553, 28.026, 1.14],
  ['Fomalhaut', 22.9608, -29.622, 1.16], ['Deneb', 20.6905, 45.280, 1.25],
  ['Regulus', 10.1395, 11.967, 1.35], ['Polaris', 2.5303, 89.264, 1.98],
].map(([name, ra, dec, mag]) => ({ name, ra, dec, mag }));

/** Horizontal positions of the landmark stars (precession/nutation applied). */
export function landmarkStars(date, observer) {
  const time = A.MakeTime(date);
  const rot = A.Rotation_EQJ_HOR(time, toObserver(observer));
  return LANDMARK_STARS.map((s) => {
    const v = A.VectorFromSphere(new A.Spherical(s.dec, s.ra * 15, 1), time);
    const h = A.HorizonFromVector(A.RotateVector(rot, v), 'normal');
    return { ...s, az: h.lon, el: h.lat };
  });
}
