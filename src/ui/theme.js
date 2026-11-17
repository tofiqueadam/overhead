// Reads design tokens from CSS so canvas drawing follows the active theme.

const TOKENS = ['bg', 'ink', 'muted', 'faint', 'accent', 'panel', 'sky', 'sky-rim', 'ok'];

export function readTheme(el = document.documentElement) {
  const cs = getComputedStyle(el);
  const t = {};
  for (const k of TOKENS) t[k.replace('-', '_')] = cs.getPropertyValue(`--${k}`).trim();
  t.mono = cs.getPropertyValue('--mono').trim();
  t.dark = cs.colorScheme !== 'light' && !cs.getPropertyValue('color-scheme').includes('light');
  return t;
}

/** Hex colour + alpha -> rgba() string. */
export function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
