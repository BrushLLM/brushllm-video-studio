import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { formatDuration } from '../lib/format';
import { Icon } from '../components/icons';
import { ActualSummary } from '../components/MediaSummary';

export default function QueuePage({ jobs, setJobs, platform = 'darwin' }) {
  const { t } = useI18n();
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // job pending delete confirmation
  const [canPause, setCanPause] = useState(false);

  useEffect(() => {
    bridge.listJobs().then(setJobs);
    bridge.canPauseJobs?.().then((v) => setCanPause(Boolean(v))).catch(() => setCanPause(false));
    const off1 = bridge.onJobsUpdated((job) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === job.id);
        if (idx === -1) return [...prev, job];
        const next = [...prev];
        next[idx] = job;
        return next;
      });
    });
    const off2 = bridge.onJobsRemoved((id) => {
      setJobs((prev) => prev.filter((j) => j.id !== id));
    });
    return () => { off1(); off2(); };
  }, []);

  const showToast = (msg, kind = 'error') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  };

  const clearFinished = () => {
    jobs.filter((j) => ['done', 'error', 'canceled'].includes(j.status))
      .forEach((j) => bridge.removeJob(j.id));
    setJobs((prev) => prev.filter((j) => !['done', 'error', 'canceled'].includes(j.status)));
  };

  const pending = jobs.filter((j) => ['queued', 'running', 'paused'].includes(j.status)).length;
  const revealLabel = platform === 'win32' ? t('common.revealWin') : t('common.reveal');

  return (
    <div className="page-inner">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h1>{t('queue.title')}</h1>
          <p>{pending > 0 ? t('queue.jobsPending', { n: pending }) : t('app.tagline')}</p>
        </div>
        {jobs.some((j) => ['done', 'error', 'canceled'].includes(j.status)) && (
          <button className="btn btn-secondary" onClick={clearFinished}>{t('queue.clearFinished')}</button>
        )}
      </div>

      {!jobs.length ? (
        <div className="empty-state">
          <Icon name="queue" size={40} />
          <div className="es-title">{t('queue.empty')}</div>
          <div className="es-sub">{t('queue.emptyHint')}</div>
        </div>
      ) : (
        <div className="queue-list">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              t={t}
              revealLabel={revealLabel}
              canPause={canPause}
              onTerminateNoop={() => showToast(t('msg.jobAlreadyFinished'))}
              onDeleteRequest={() => setDeleteTarget(job)}
            />
          ))}
        </div>
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          job={deleteTarget}
          t={t}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(msg, kind) => { setDeleteTarget(null); if (msg) showToast(msg, kind); }}
        />
      )}

      {toast && <div className={`toast show ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}

function JobCard({ job, t, revealLabel, canPause, onTerminateNoop, onDeleteRequest }) {
  const statusKey = `common.${job.status}`;
  const elapsed = job.endedAt && job.startedAt
    ? (job.endedAt - job.startedAt) / 1000
    : job.startedAt
      ? (Date.now() - job.startedAt) / 1000
      : 0;

  const terminate = async () => {
    const ok = await bridge.cancelJob(job.id);
    if (!ok) onTerminateNoop();
  };

  const active = job.status === 'running' || job.status === 'queued' || job.status === 'paused';

  // Progress display: unknown duration or zero progress shows the sliding
  // indeterminate bar; running jobs never read as 100%.
  const showPercent = job.expectedDuration > 0 && job.progress > 0;
  const barWidth = showPercent ? `${Math.min(99, Math.round(job.progress * 100))}%` : null;

  return (
    <div className="card job-card">
      <div className="job-head">
        <span className={`chip ${job.status}`}>{t(statusKey)}</span>
        <span className="job-title">
          {t(job.op)} · {job.inputNames[0]}
          {job.inputNames.length > 1 && ` +${job.inputNames.length - 1}`}
        </span>
        <div className="job-actions">
          {job.status === 'running' && canPause && (
            <button className="icon-btn" title={t('common.pause')} aria-label={t('common.pause')} onClick={() => bridge.pauseJob(job.id)}>
              <Icon name="pause" size={14} />
            </button>
          )}
          {job.status === 'paused' && (
            <button className="icon-btn" title={t('common.continue')} aria-label={t('common.continue')} onClick={() => bridge.resumeJob(job.id)}>
              <Icon name="play" size={14} />
            </button>
          )}
          {active && (
            <button className="icon-btn danger" title={t('common.terminate')} aria-label={t('common.terminate')} onClick={terminate}>
              <Icon name="stop" size={13} />
            </button>
          )}
          {(job.status === 'canceled' || job.status === 'error') && (
            <button className="icon-btn" title={t('common.resume')} aria-label={t('common.resume')} onClick={() => bridge.retryJob(job.id)}>
              <Icon name="rotate" size={14} />
            </button>
          )}
          {job.status === 'done' && (
            <>
              <button className="icon-btn" title={revealLabel} aria-label={revealLabel} onClick={() => bridge.revealPath(job.outputPath)}>
                <Icon name="folder" size={14} />
              </button>
              <button className="icon-btn" title={t('common.rerun')} aria-label={t('common.rerun')} onClick={() => bridge.retryJob(job.id)}>
                <Icon name="rotate" size={14} />
              </button>
            </>
          )}
          {!active && (
            <button className="icon-btn danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={onDeleteRequest}>
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="job-sub">
        <span title={job.outputPath}>{job.outputPath?.split(/[/\\]/).pop()}</span>
        {job.status === 'running' && job.speed > 0 && <span>{job.speed.toFixed(1)}×</span>}
        {job.status === 'running' && job.cpuPercent > 0 && (
          <span title="CPU">CPU {job.cpuPercent}%</span>
        )}
        {elapsed > 0 && <span>{formatDuration(elapsed)}</span>}
        {job.status === 'running' && showPercent && (
          <span>{Math.min(99, Math.round(job.progress * 100))}%</span>
        )}
      </div>

      {active && (
        <div className="progress-track">
          <div
            className={`progress-fill${barWidth ? '' : ' indeterminate'}`}
            style={barWidth ? { width: barWidth } : undefined}
          />
        </div>
      )}

      {job.status === 'error' && job.error && (
        <div className="job-error">{job.error}</div>
      )}

      {job.actual && <ActualSummary actual={job.actual} />}
    </div>
  );
}

function DeleteConfirmModal({ job, t, onClose, onDeleted }) {
  const { t: _t } = useI18n();
  const [alsoDeleteFile, setAlsoDeleteFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasOutput = Boolean(job.outputPath) && job.status === 'done';

  const confirm = async () => {
    setBusy(true);
    try {
      if (alsoDeleteFile && hasOutput) {
        const r = await bridge.deleteFile(job.outputPath);
        if (r && r.ok === false) {
          onDeleted(t('msg.fileDeleteFailed'), 'error');
          return;
        }
      }
      await bridge.removeJob(job.id);
      onDeleted(alsoDeleteFile && hasOutput ? t('msg.fileDeleted') : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{t('modal.deleteTitle')}</h3>
          <button className="icon-btn" title={t('common.close')} aria-label={t('common.close')} onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-text">{job.outputPath?.split(/[/\\]/).pop()}</p>
          {hasOutput && (
            <label className="modal-check">
              <input
                type="checkbox"
                checked={alsoDeleteFile}
                onChange={(e) => setAlsoDeleteFile(e.target.checked)}
              />
              {t('modal.deleteFile')}
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-terminate" disabled={busy} onClick={confirm}>
            <Icon name="trash" size={12} /> {t('modal.confirmDelete')}
          </button>
        </div>
      </div>
    </div>
  );
}
