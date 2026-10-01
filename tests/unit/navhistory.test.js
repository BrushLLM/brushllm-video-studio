const { test } = require('node:test');
const assert = require('node:assert');

// navhistory.js is ESM — load dynamically from CJS tests.
let nav;
test.before(async () => {
  nav = await import('../../src/lib/navhistory.js');
});

test('push appends and current tracks the tip', () => {
  let h = nav.createHistory('video');
  assert.equal(nav.current(h), 'video');
  h = nav.push(h, 'audio');
  assert.equal(nav.current(h), 'audio');
  h = nav.push(h, 'queue');
  assert.equal(nav.current(h), 'queue');
  assert.equal(h.stack.length, 3);
});

test('pushing the current page is a no-op', () => {
  let h = nav.createHistory('video');
  h = nav.push(h, 'audio');
  const same = nav.push(h, 'audio');
  assert.equal(same.stack.length, 2, 'no duplicate history entries');
  assert.equal(nav.current(same), 'audio');
});

test('back/forward walk the history and clamp at the ends', () => {
  let h = nav.createHistory('video');
  h = nav.push(h, 'audio');
  h = nav.push(h, 'queue');
  h = nav.back(h);
  assert.equal(nav.current(h), 'audio');
  h = nav.back(h);
  assert.equal(nav.current(h), 'video');
  const clamped = nav.back(h);
  assert.equal(nav.current(clamped), 'video', 'back at the start is a no-op');
  h = nav.forward(h);
  assert.equal(nav.current(h), 'audio');
  h = nav.forward(h);
  assert.equal(nav.current(h), 'queue');
  const fwdClamped = nav.forward(h);
  assert.equal(nav.current(fwdClamped), 'queue', 'forward at the tip is a no-op');
});

test('navigating mid-history truncates the forward branch', () => {
  let h = nav.createHistory('video');
  h = nav.push(h, 'audio');
  h = nav.push(h, 'queue');
  h = nav.back(h); // on 'audio'
  h = nav.push(h, 'subtitle'); // forward branch ('queue') is discarded
  assert.equal(h.stack.length, 3);
  assert.equal(nav.current(h), 'subtitle');
  assert.equal(nav.canForward(h), false);
});

test('canBack / canForward reflect position', () => {
  let h = nav.createHistory('video');
  assert.equal(nav.canBack(h), false);
  assert.equal(nav.canForward(h), false);
  h = nav.push(h, 'audio');
  assert.equal(nav.canBack(h), true);
  assert.equal(nav.canForward(h), false);
  h = nav.back(h);
  assert.equal(nav.canBack(h), false);
  assert.equal(nav.canForward(h), true);
});
