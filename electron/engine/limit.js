// Bound subprocess-heavy work across all IPC callers, including large imports.
function createLimiter(concurrency) {
  const pending = [];
  let active = 0;
  const pump = () => {
    while (active < concurrency && pending.length) {
      const { task, resolve, reject } = pending.shift();
      active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; pump(); });
    }
  };
  return (task) => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject });
    pump();
  });
}

module.exports = { createLimiter };
