export function isActiveJob(job) {
  return ['queued', 'running', 'paused'].includes(job.status);
}

export function isRemovableJob(job) {
  return !job.settling && ['done', 'error', 'canceled'].includes(job.status);
}
