import { useLayoutEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import DropZone from './DropZone';
import FileList from './FileList';
import { Icon } from './icons';

const TRANSFER_TARGETS = { video: ['audio', 'subtitle'], audio: ['video'], subtitle: ['video'] };
const TRANSFER_LABELS = { video: 'shortcut.openVideo', audio: 'shortcut.openAudio', subtitle: 'shortcut.openSubtitle' };

export default function SourceFiles({ section, files, setFiles, onAdd, onTransfer, reorderable, clearedFiles, setClearedFiles }) {
  const { t } = useI18n();
  const clearButton = useRef(null);
  const undoButton = useRef(null);
  const focusAfterChange = useRef(null);
  const canUndoClear = clearedFiles.length > 0;

  useLayoutEffect(() => {
    focusAfterChange.current?.current?.focus();
    focusAfterChange.current = null;
  }, [files.length, canUndoClear]);

  const retryProbe = (path) => setFiles((previous) => previous.map((file) => file.path === path
    ? { ...file, probeFailed: false, probing: false, requestToken: Date.now() + Math.random() }
    : file));

  const clear = () => {
    focusAfterChange.current = undoButton;
    setClearedFiles(files);
    setFiles([]);
  };

  const restore = () => {
    focusAfterChange.current = clearButton;
    setFiles((current) => {
      const currentPaths = new Set(current.map((file) => file.path));
      // Start a fresh probe for any restored file that was still being read.
      const restored = clearedFiles.filter((file) => !currentPaths.has(file.path)).map((file) => file.probing
        ? { ...file, probing: false, requestToken: Date.now() + Math.random() }
        : file);
      return [...restored, ...current];
    });
    setClearedFiles([]);
  };

  return (
    <section className="source-panel" aria-labelledby="source-title">
      <div className="source-heading">
        <h2 id="source-title" className="section-title">{t('workspace.files')}</h2>
        {files.length > 0 && <span className="source-count" role="status">{t('workspace.fileCount', { n: files.length })}</span>}
      </div>
      <DropZone onFiles={onAdd} section={section} compact={files.length > 0} />
      <FileList
        files={files}
        onRemove={(path) => setFiles((previous) => previous.filter((file) => file.path !== path))}
        onRetry={retryProbe}
        onReorder={reorderable ? setFiles : null}
        reorderable={reorderable}
      />
      {(files.length > 0 || canUndoClear) && (
        <div className="source-actions">
          {files.length > 0 && TRANSFER_TARGETS[section].map((target) => (
            <button key={target} type="button" className="btn btn-plain btn-sm" onClick={() => onTransfer(target)}>
              <Icon name={target} size={15} />
              {t(TRANSFER_LABELS[target])}
            </button>
          ))}
          {!files.length && canUndoClear && <span className="source-count" role="status">{t('workspace.sourcesCleared')}</span>}
          {files.length > 0 && (
            <button ref={clearButton} className="btn btn-plain btn-sm source-clear" type="button" onClick={clear}>
              {t('common.clearAll')}
            </button>
          )}
          {canUndoClear && (
            <button ref={undoButton} className="btn btn-ghost btn-sm source-undo" type="button" onClick={restore}>
              {t('workspace.undoClear')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
