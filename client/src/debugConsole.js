// Lazy-loaded helpers around the eruda in-page console. Both functions
// short-circuit when the build is not a debug build, so it is safe to
// import unconditionally — the `import('eruda')` is only reached on a debug
// build, letting the production bundle drop eruda as dead code.

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
