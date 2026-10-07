'use strict';

/** Returns { promise, resolve, reject } - a manually controllable Promise. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * Polls predicate() every `interval` ms until it returns truthy or `timeout` ms elapses.
 * Throws on timeout.
 */
async function waitFor(predicate, { timeout = 2000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

module.exports = { deferred, waitFor };
