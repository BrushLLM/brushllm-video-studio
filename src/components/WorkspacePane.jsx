import { useContext, useLayoutEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { JobQueue } from '../lib/jobQueue';
import { isActiveJob } from '../lib/jobStatus';
import QueuePage from '../pages/QueuePage';
import { Icon } from './icons';

export default function WorkspacePane({ section, platform, view, onViewChange, queueButton, children }) {
  const { t } = useI18n();
  const jobs = useContext(JobQueue);
  const scroll = useRef(null);
  const previewButton = useRef(null);
  useLayoutEffect(() => { scroll.current.scrollTop = 0; }, [view]);

  const showPreview = () => {
    onViewChange('preview');
    previewButton.current?.focus();
  };
  let active = 0;
  let failed = 0;
  for (const job of jobs) {
    if (isActiveJob(job)) active++;
    else if (job.status === 'error') failed++;
  }
  const showingQueue = view === 'queue';
  return (
    <section className="workspace-pane" aria-labelledby="workspace-title">
      <header className="workspace-heading">
        <h1 id="workspace-title">{t(`nav.${section}`)}</h1>
        <div className="workspace-switch" role="group" aria-label={t('nav.workspace')}>
          <button ref={previewButton} type="button" className="workspace-view" aria-pressed={!showingQueue} onClick={showPreview}>
            <Icon name="frames" size={17} /> {t('workspace.preview')}
          </button>
          <button ref={queueButton} type="button" className="workspace-view" aria-pressed={showingQueue} onClick={() => onViewChange('queue')}>
            <Icon name="queue" size={17} /> {t('nav.queue')}
            {jobs.length > 0 && <span className="workspace-count">{jobs.length}</span>}
            {active > 0 && <span className="visually-hidden">{t('queue.active')}: {active}</span>}
            {failed > 0 && <span className="queue-alert-count" title={t('queue.jobsFailed', { n: failed })}>
              <Icon name="warning" size={14} />
              <span className="visually-hidden">{t('queue.jobsFailed', { n: failed })}</span>
              <span aria-hidden="true">{failed}</span>
            </span>}
          </button>
        </div>
      </header>
      <div className="workspace-scroll" ref={scroll}>
        <div className="preview-content" hidden={showingQueue}>{children}</div>
        {showingQueue && <QueuePage jobs={jobs} platform={platform} onShowPreview={showPreview} />}
      </div>
    </section>
  );
}
