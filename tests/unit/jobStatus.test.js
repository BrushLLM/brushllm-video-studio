const assert = require('node:assert/strict');
const { test } = require('node:test');

test('queue cleanup only includes terminal jobs whose attempts have settled', async () => {
  const { isActiveJob, isRemovableJob } = await import('../../src/lib/jobStatus.js');
  const jobs = [
    { status: 'queued' },
    { status: 'running' },
    { status: 'paused' },
    { status: 'done' },
    { status: 'error' },
    { status: 'canceled' },
    { status: 'canceled', settling: true }
  ];

  assert.deepEqual(jobs.filter(isActiveJob), jobs.slice(0, 3));
  assert.deepEqual(jobs.filter(isRemovableJob), jobs.slice(3, 6));
});
