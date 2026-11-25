import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { isActiveJob, isRemovableJob } from '../lib/jobStatus';
import { Icon } from '../components/icons';
import EmptyState from '../components/EmptyState';
import JobRow from '../components/JobRow';
import { useModalFocus } from '../lib/useModalFocus';

const FILTERS = [
  { value: 'all', label: 'queue.all' },
  { value: 'active', label: 'queue.active' },
  { value: 'done', label: 'common.done' },
  { value: 'error', label: 'queue.failed' },
  { value: 'canceled', label: 'common.canceled' }
];

export default function QueuePage({ jobs, platform, onShowPreview }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [canPause, setCanPause] = useState(false);
  const toastTimer = useRef(null);
  const queueHeading = useRef(null);

  useEffect(() => {
    bridge.canPauseJobs().then((value) => setCanPause(Boolean(value))).catch(() => setCanPause(false));
    return () => clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((message, kind = 'error') => {
    setToast({ message, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  const showUnavailable = useCallback(() => showToast(t('queue.actionUnavailable')), [showToast, t]);
  const closeConfirmation = useCallback(() => setConfirmation(null), []);
  const requestDelete = useCallback((job) => setConfirmation({ job }), []);

  const removableJobs = jobs.filter(isRemovableJob);
  const clearFinished = async () => {
    try {
      const removed = await Promise.allSettled(confirmation.finishedIds.map((id) => bridge.removeJob(id)));
      if (removed.some((result) => result.status === 'rejected' || !result.value)) showUnavailable();
    } catch {
      showUnavailable();
    } finally {
      closeConfirmation();
    }
  };

  const counts = { all: jobs.length, active: 0, done: 0, error: 0, canceled: 0 };
  const visibleJobs = jobs.filter((job) => {
    const group = isActiveJob(job) ? 'active' : job.status;
    counts[group]++;
    return filter === 'all' || filter === group;
  });
  const revealLabel = t(platform === 'win32' ? 'common.revealWin' : 'common.reveal');

  return (
    <section className="queue-page" aria-labelledby="queue-heading">
      <header className="queue-heading">
        <h2 id="queue-heading" className="section-title" tabIndex={-1} ref={queueHeading}>{t('queue.title')}</h2>
        {removableJobs.length > 0 && (
          <button
            type="button" className="btn btn-secondary" aria-haspopup="dialog"
            onClick={() => setConfirmation({ finishedIds: removableJobs.map((job) => job.id) })}
          >
            {t('queue.clearFinished')}
          </button>
        )}
      </header>

      <p className="visually-hidden" role="status" aria-atomic="true">
        {t('queue.jobsDone', { n: counts.done })}, {t('queue.jobsFailed', { n: counts.error })}
      </p>

      {!jobs.length ? (
        <EmptyState icon="queue" title={t('queue.empty')}>
          <div className="empty-actions">
            <button type="button" className="btn btn-secondary" onClick={onShowPreview}>
              <Icon name="frames" size={16} /> {t('workspace.preview')}
            </button>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="queue-filters" role="group" aria-label={t('queue.filter')}>
            {FILTERS.map(({ value, label }) => (
              <button key={value} type="button" className="queue-filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {t(label)} <span className="filter-count">{counts[value]}</span>
              </button>
            ))}
          </div>
          {visibleJobs.length ? (
            <div className="queue-list">
              {visibleJobs.map((job) => (
                <JobRow
                  key={job.id} job={job} t={t} revealLabel={revealLabel} canPause={canPause}
                  onUnavailable={showUnavailable} onDeleteRequest={requestDelete}
                />
              ))}
            </div>
          ) : <EmptyState icon="queue" title={t('queue.noMatching')} />}
        </>
      )}

      {confirmation?.finishedIds && (
        <QueueConfirmDialog
          title={t('queue.clearFinished')} confirmLabel={t('queue.clearFinished')}
          onClose={closeConfirmation} onConfirm={clearFinished} fallbackFocus={queueHeading}
        >
          <p className="modal-note">{t('queue.clearSummary', { n: confirmation.finishedIds.length })}</p>
        </QueueConfirmDialog>
      )}
      {confirmation?.job && (
        <DeleteConfirmModal
          job={confirmation.job} onClose={closeConfirmation} fallbackFocus={queueHeading}
          onDeleted={(message, kind) => { closeConfirmation(); if (message) showToast(message, kind); }}
        />
      )}

      {toast && <div className={`toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.message}</div>}
    </section>
  );
}

function DeleteConfirmModal({ job, onClose, onDeleted, fallbackFocus }) {
  const { t } = useI18n();
  const [alsoDeleteFile, setAlsoDeleteFile] = useState(false);
  const hasOutput = Boolean(job.hasOutput) && job.status === 'done';

  const confirm = async () => {
    try {
      if (alsoDeleteFile && hasOutput) {
        const r = await bridge.deleteFile(job.id);
        if (!r?.ok) {
          onDeleted(t('msg.fileDeleteFailed'), 'error');
          return;
        }
      }
      if (!await bridge.removeJob(job.id)) {
        onDeleted(t('queue.actionUnavailable'), 'error');
        return;
      }
      onDeleted(alsoDeleteFile && hasOutput ? t('msg.fileDeleted') : null);
    } catch {
      onDeleted(t('queue.actionUnavailable'), 'error');
    }
  };

  return (
    <QueueConfirmDialog
      title={t('modal.deleteTitle')} confirmLabel={t('modal.confirmDelete')}
      onClose={onClose} onConfirm={confirm} fallbackFocus={fallbackFocus}
    >
      <p className="modal-text"><span className="modal-file">{job.outputPath?.split(/[/\\]/).pop()}</span></p>
      {!hasOutput && <p className="modal-note">{t('modal.deleteQueueOnly')}</p>}
      {hasOutput && (
        <label className="modal-check">
          <input type="checkbox" checked={alsoDeleteFile} onChange={(e) => setAlsoDeleteFile(e.target.checked)} />
          {t('modal.deleteFile')}
        </label>
      )}
    </QueueConfirmDialog>
  );
}

function QueueConfirmDialog({ title, confirmLabel, onClose, onConfirm, fallbackFocus, children }) {
  const { t } = useI18n();
  const inProgress = useRef(false);
  const confirmed = useRef(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => {
    if (!inProgress.current) onClose();
  }, [onClose]);
  const restoreFocus = useCallback((previous) => {
    if (confirmed.current || !previous?.isConnected || previous === document.body) return fallbackFocus.current;
    return previous;
  }, [fallbackFocus]);
  const modalRef = useModalFocus(close, restoreFocus);

  const confirm = async () => {
    if (inProgress.current) return;
    inProgress.current = true;
    confirmed.current = true;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      inProgress.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        ref={modalRef}
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="queue-confirm-title"
        aria-describedby="queue-confirm-body"
        aria-busy={busy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="queue-confirm-title">{title}</h3>
          <button type="button" className="icon-btn" aria-disabled={busy} title={t('common.close')} aria-label={t('common.close')} onClick={close}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="modal-body" id="queue-confirm-body"><fieldset disabled={busy}>{children}</fieldset></div>
        <div className="modal-foot">
          <button type="button" className="btn btn-secondary" aria-disabled={busy} onClick={close}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-terminate" aria-disabled={busy} onClick={confirm}>
            <Icon name="trash" size={14} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
