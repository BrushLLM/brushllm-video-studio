import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { Icon } from './icons';

function OutputFolder({ outputDir, defaultOutputDir, setOutputDir, onError }) {
  const { t } = useI18n();
  const effectiveDir = outputDir ?? defaultOutputDir;
  const displayedDir = effectiveDir || t('common.sameFolder');

  const pickDirectory = async () => {
    try {
      const directory = await bridge.pickDirectory();
      if (directory) setOutputDir(directory);
    } catch (error) {
      onError(String(error.message || error));
    }
  };

  return (
    <div className="output-settings">
      <span className="param-label" id="output-label">{t('common.outputDirectory')}</span>
      <button
        type="button" className="btn btn-secondary output-directory"
        title={displayedDir} aria-labelledby="output-label output-path" onClick={pickDirectory}
      >
        <Icon name="folder" size={16} />
        <span id="output-path">{displayedDir}</span>
      </button>
      {(effectiveDir || outputDir != null) && (
        <div className="output-reset">
          {effectiveDir && (
            <button type="button" className="btn btn-plain btn-sm" onClick={() => setOutputDir('')}>{t('common.sameFolder')}</button>
          )}
          {outputDir != null && (
            <button type="button" className="btn btn-plain btn-sm" onClick={() => setOutputDir(null)}>{t('common.defaultOutput')}</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ToolFooter({ output, submitLabel, disabled, reason, notice, onSubmit, addedCount, onOpenQueue }) {
  const { t } = useI18n();
  return (
    <footer className="tool-footer">
      <div className="tool-footer-inner">
        {notice && (
          <p className={`tool-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            <Icon name={notice.kind === 'error' ? 'warning' : 'check'} size={16} /> {notice.msg}
          </p>
        )}
        {output && <OutputFolder {...output} />}
        <div className="tool-actions">
          {addedCount > 0 && (
            <div className="submission-result">
              <span role="status"><Icon name="check" size={16} /> {t('msg.jobsAdded', { n: addedCount })}</span>
              {onOpenQueue && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenQueue}>
                  {t('workspace.viewQueue')} <Icon name="arrowRight" size={16} />
                </button>
              )}
            </div>
          )}
          {reason && <span className="submit-note" id="submit-note">{reason}</span>}
          <button
            type="button" className="btn btn-primary submit-tool"
            disabled={disabled} aria-describedby={reason ? 'submit-note' : undefined} onClick={onSubmit}
          >
            <Icon name={output ? 'plus' : 'bolt'} size={17} /> {submitLabel}
          </button>
        </div>
      </div>
    </footer>
  );
}
