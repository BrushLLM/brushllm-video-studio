import { useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { bridge } from '../lib/bridge';
import { Icon } from './icons';

export default function VideoPreview({ file }) {
  const { t } = useI18n();
  const [frame, setFrame] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const monitor = useRef(null);
  const load = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const image = await bridge.previewFrame(file.path);
      if (monitor.current?.contains(document.activeElement)) monitor.current.focus({ preventScroll: true });
      setFrame(image);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <figure className="frame-preview" aria-busy={busy}>
      <div className="frame-monitor" ref={monitor} tabIndex={-1}>
        {frame
          ? <img src={frame} alt={t('workspace.previewFrame')} />
          : <button type="button" className="btn btn-preview" disabled={busy} onClick={load}>
            <Icon name="frames" size={17} /> {t(busy ? 'common.preparing' : 'workspace.previewFrame')}
          </button>}
      </div>
      <figcaption className="frame-caption" title={file.name}>{file.name}</figcaption>
      {failed && <p className="frame-error" role="alert">{t('workspace.previewFailed')}</p>}
    </figure>
  );
}
