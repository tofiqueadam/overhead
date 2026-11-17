# Vendored libraries

Third-party code is copied here verbatim so the site has no build step and no
runtime dependency on a CDN. Versions are pinned by directory name.

| Library | Version | Source | License |
|---|---|---|---|
| [satellite.js](https://github.com/shashwatak/satellite-js) | 7.1.0 | `npm pack satellite.js@7.1.0`, `dist/` | MIT (`satellite.js-7.1.0/LICENSE.md`) |
| [astronomy-engine](https://github.com/cosinekitty/astronomy) | 2.1.19 | `npm pack astronomy-engine@2.1.19`, `esm/astronomy.js` | MIT (`astronomy-engine-2.1.19/LICENSE`) |

Notes

- satellite.js: only the pure-JavaScript SGP4 modules are included. The
  optional WebAssembly bulk propagator (`dist/wasm/`, `wasm-build/`) and the
  barrel `dist/index.js` (which re-exports it) are omitted; Overhead imports
  `io.js`, `propagation.js` and `transforms.js` directly. No file was modified.
- astronomy-engine: the single ES module build, unmodified.

To upgrade, re-run `npm pack <name>@<version>`, copy the same files into a new
versioned directory, and update the import paths in `src/lib/`.
