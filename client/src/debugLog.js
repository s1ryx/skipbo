// Lightweight debug logger gated by REACT_APP_DEBUG at build time. When the
// flag is unset (production build), every call short-circuits before reaching
// console.log so there is no runtime cost or noise.
//
// Output format mirrors the server's structured JSON line as closely as the
// browser console allows, so client and server logs can be sliced by the same
// fields (timestamp, scope, msg, data) when assembled into a single trace.

const ENABLED = process.env.REACT_APP_DEBUG === '1';

function debugLog(scope, msg, data) {
  if (!ENABLED) return;
  const entry = { timestamp: new Date().toISOString(), scope, msg };
  if (data !== undefined) entry.data = data;
  // eslint-disable-next-line no-console
  console.log(`[skipbo:${scope}]`, JSON.stringify(entry));
}

export default debugLog;
export { ENABLED as DEBUG_ENABLED };
