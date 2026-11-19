/**
 * dsh-usage-meter · loader bootstrap
 *
 * The Harness loader imports one module per plugin entry and keeps it in the
 * ESM registry for the lifetime of the process, so an edited host half would
 * keep running the *old* code until the whole app restarts. This file is
 * therefore a thin, deliberately boring bootstrap:
 *
 *  - `name` and `inject` are plain constants, readable without executing more.
 *  - `apply()` re-imports `./host.js` with a cache-busting query derived from
 *    the mtimes of the whole host-side closure (`host.js` + `store.js`).
 *    Unchanged files → same URL → cached modules; an edited file → new URL →
 *    fresh code, live, without restarting the app.
 *
 * The stamp must cover the closure, not just the entry: Node caches modules by
 * resolved URL, so busting `host.js` alone would still leave it importing a
 * stale `store.js`. `host.js` reads this stamp back off its own URL (`?v=…`)
 * and appends the same value when it imports `store.js`.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-usage-meter';
export const inject = ['tools', 'webServer'];

const HOST_URL = new URL('./host.js', import.meta.url);
/** Every host-side module whose content must invalidate the cached closure. */
const CLOSURE = ['host.js', 'store.js', 'backfill.js'];
let lastStamp = '';

/** `mtimeMs-size` of each closure file, joined; a missing file contributes 0. */
function closureStamp() {
  const parts = [];
  for (const relative of CLOSURE) {
    try {
      const stat = fs.statSync(fileURLToPath(new URL(`./${relative}`, import.meta.url)));
      parts.push(`${relative}:${Math.round(stat.mtimeMs)}:${stat.size}`);
    } catch {
      parts.push(`${relative}:missing`);
    }
  }
  return parts.join('|');
}

export async function apply(ctx, config) {
  const stamp = closureStamp();
  const target = new URL(HOST_URL.href);
  target.searchParams.set('v', encodeURIComponent(stamp));
  if (stamp !== lastStamp) {
    lastStamp = stamp;
    console.log('[usage-meter] host closure changed — reloading it from disk');
  }
  const host = await import(target.href);
  if (typeof host.activate !== 'function') {
    throw new Error('dsh-usage-meter: lib/host.js did not export activate()');
  }
  // `activate` installs its contributions through their own guards and returns
  // nothing: a plugin's apply may only hand back a disposer.
  await host.activate(ctx, config);
}