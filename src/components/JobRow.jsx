import { memo } from 'react';
import { bridge } from '../lib/bridge';
import { formatDuration } from '../lib/format';
import { isActiveJob, isRemovableJob } from '../lib/jobStatus';
import { Icon } from './icons';
import { ActualSummary } from './MediaSummary';

function errorSummaryKey(message) {
  if (/\bspawn\b|failed to start/i.test(message)) return 'queue.errGeneric';
  if (/EACCES|EPERM|permission/i.test(message)) return 'queue.errPermission';
  if (/ENOENT|no such file/i.test(message)) return 'queue.errMissing';
  if (/moov atom|invalid data|demux/i.test(message)) return 'queue.errCorrupt';
  return 'queue.errGeneric';
}

function JobAction({ icon, primary = false, danger = false, describedBy, onClick, children }) {
  const style = primary ? 'btn-secondary' : 'btn-plain';
  return (
    <button type="button" className={`btn btn-sm ${style}${danger ? ' job-action-danger' : ''}`} aria-describedby={describedBy} onClick={onClick}>
      <Icon name={icon} size={15} /> {children}
    </button>
  );
}

export default memo(function JobRow({ job, t, revealLabel, canPause, onUnavailable, onDeleteRequest }) {
  const { status, inputNames } = job;
  const titleId = `title-${job.id}`;
  const sourceName = inputNames[0];
  const outputName = job.outputPath?.split(/[/\\]/).pop();
  const statusLabel = t(`common.${status}`);
  const finished = status === 'done';
  const paused = status === 'paused';
  const active = isActiveJob(job);
  const removable = isRemovableJob(job);
  const elapsed = job.startedAt ? ((job.endedAt || Date.now()) - job.startedAt) / 1000 : 0;
  const percent = finished ? 100 : job.expectedDuration > 0
    ? Math.max(0, Math.min(99, Math.round(job.progress * 100)))
    : undefined;
  const showProgress = finished || status === 'running' || (paused && percent !== undefined);
  const errorKey = status === 'error' && job.error ? errorSummaryKey(job.error) : null;

  const perform = (action) => async () => {
    try {
      if (!await action(job.id)) onUnavailable();
    } catch {
      onUnavailable();
    }
  };

  return (
    <article className="job-row" aria-labelledby={titleId} data-job-status={status}>
      <div className="job-media">
        <span className="job-icon"><Icon name={job.op.split('.')[0]} size={19} /></span>
        <div className="job-identity">
          <h2 id={titleId} className="job-title">
            <span title={sourceName}>{sourceName}</span>
            {inputNames.length > 1 && <span className="job-more">+{inputNames.length - 1}</span>}
          </h2>
          <div className="job-output">
            <span>{t(job.op)}</span>
            {outputName && <><Icon name="arrowRight" size={14} /><span title={job.outputPath}>{outputName}</span></>}
          </div>
          {finished && job.actual && <ActualSummary actual={job.actual} />}
        </div>
      </div>

      <div className="job-state">
        <div className="job-status-line">
          <span className={`job-status ${status}`}>
            {finished && <Icon name="check" size={14} />}
            {status === 'error' && <Icon name="warning" size={14} />}
            {statusLabel}
          </span>
          {showProgress && percent !== undefined && <span className="job-percent">{percent}%</span>}
        </div>
        {showProgress && (
          <div className={`progress-track ${status}`} role="progressbar" aria-label={t('queue.progress')} aria-valuenow={percent}>
            <div className={`progress-fill${percent === undefined ? ' indeterminate' : ''}`} style={percent === undefined ? undefined : { width: `${percent}%` }} />
          </div>
        )}
        <div className="job-telemetry">
          {status === 'running' && job.speed > 0 && <span>{job.speed.toFixed(1)}×</span>}
          {status === 'running' && job.cpuPercent > 0 && <span>CPU {job.cpuPercent}%</span>}
          {elapsed > 0 && <span>{t('queue.elapsed')} {formatDuration(elapsed)}</span>}
        </div>
      </div>

      <div className="job-actions">
        {(paused || (canPause && status === 'running')) && (
          <JobAction describedBy={titleId} icon={paused ? 'play' : 'pause'} primary onClick={perform(paused ? bridge.resumeJob : bridge.pauseJob)}>
            {t(paused ? 'common.continue' : 'common.pause')}
          </JobAction>
        )}
        {active && <JobAction describedBy={titleId} icon="stop" danger onClick={perform(bridge.cancelJob)}>{t('common.terminate')}</JobAction>}
        {!finished && removable && <JobAction describedBy={titleId} icon="rotate" primary onClick={perform(bridge.retryJob)}>{t('common.retry')}</JobAction>}
        {finished && job.hasOutput && <JobAction describedBy={titleId} icon="folder" primary onClick={perform(bridge.revealPath)}>{revealLabel}</JobAction>}
        {finished && removable && <JobAction describedBy={titleId} icon="rotate" onClick={perform(bridge.retryJob)}>{t('common.rerun')}</JobAction>}
        {removable && <JobAction describedBy={titleId} icon="trash" danger onClick={() => onDeleteRequest(job)}>{t('common.delete')}</JobAction>}
      </div>

      {job.settling && !finished && <p className="job-settling">{t('queue.finishingCancellation')}</p>}
      {errorKey && (
        <div className="job-error">
          <p>{t(errorKey)}</p>
          <details>
            <summary>{t('queue.errorDetails')}</summary>
            <div className="job-error-detail">{job.error}</div>
          </details>
        </div>
      )}
    </article>
  );
});
