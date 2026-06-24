// Lazy-loaded helpers around the eruda in-page console. Both functions
// short-circuit unless DEBUG_ENABLED, so a production build never *runs*
// eruda (the floating console never appears and eruda is never fetched).
//
// Caveat: eruda is still emitted as a lazy chunk in the production bundle.
// CRA/webpack splits `import('eruda')` into its own chunk regardless of the
// runtime gate (`process.env` is not const-folded at chunk-creation time), so
// the gate prevents loading, not bundling. Truly excluding eruda from the
// build would mean loading it from a CDN instead of `import()`. See
// skipbo-extra/issue-debug-console-toggle.md "Known limitation".

import { DEBUG_ENABLED } from './debugLog';

let erudaPromise = null;

function loadEruda() {
  if (!erudaPromise) {
    erudaPromise = import('eruda');
  }
  return erudaPromise;
}

export async function showDebugConsole() {
  if (!DEBUG_ENABLED) return;
  const { default: eruda } = await loadEruda();
  eruda.init();
}

export async function hideDebugConsole() {
  if (!DEBUG_ENABLED) return;
  const { default: eruda } = await loadEruda();
  // eruda.get() returns the active instance; only destroy if running.
  if (eruda.get()) eruda.destroy();
}
